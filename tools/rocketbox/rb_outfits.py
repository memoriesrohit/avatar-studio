"""Build an Avatar Studio character with swappable clothes from the Microsoft Rocketbox library.

blender -b -P rb_outfits.py -- <person dir> <m|f> <out.glb> [preview.png]

The person keeps their own head, hair, face shapes and original outfit. On top of that the GLB
carries a modular outfit taken from two "donor" Rocketbox characters of the same sex:

  Top_shirt + Skin_shirt   white shirt (with its hands)          from the shirt donor
  Top_tee   + Skin_tee     white T-shirt (with bare arms, hands) from the T-shirt donor
  Trousers, Shoes          formal trousers and shoes             from the shirt donor
  Outfit_original + Skin_original   the person's own clothes

How a donor garment is fitted to the person:
  1. Its head and hair faces are removed; every vertex is moved by how far its bones (weighted)
     sit from the same bones on the person's skeleton, and it is re-bound to the person's rig.
  2. Faces are sorted into top / trousers / shoes / skin by their dominant bone, refined by the
     colour of the texture under them (a shirt over the hips is not trousers, a bare arm is skin).
  3. Its texture is neutralised: the top becomes plain white and the trousers light grey, keeping
     only soft fold shading, so the app can tint them any colour (prints are blurred away).
  4. The neck ring is snapped onto the person's head, and the T-shirt hem onto the trousers.
  5. Its bare skin is tinted to match the person's own skin colour.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rb_build as rb  # noqa: E402

DONORS = {  # shirt, T-shirt and trousers (+ shoes) come from these Rocketbox characters
    "m": {"shirt": "Business_Male_06", "tee": "Male_Adult_09", "trousers": "Business_Male_06"},
    "f": {"shirt": "Female_Adult_15", "tee": "Female_Adult_17", "trousers": "Female_Adult_01"},
}
log = rb.log
DONORS_SHARE = {}  # trouser donor folder -> True when the same character also gives the shirt
P = rb.P


def mat_part(mat):
    return mat.name.split(".")[0].split("_")[-1]


def pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def colour_image(obj):
    mat = obj.material_slots[0].material
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    node = bsdf.inputs["Base Color"].links[0].from_node
    while node.type != "TEX_IMAGE":
        node = next(s for s in node.inputs if s.is_linked).links[0].from_node
    return node


def face_uv_tris(obj, faces):
    uv = obj.data.uv_layers.active.data
    tris = []
    for f in faces:
        loops = list(obj.data.polygons[f].loop_indices)
        for i in range(1, len(loops) - 1):
            tris.append([uv[loops[0]].uv[:], uv[loops[i]].uv[:], uv[loops[i + 1]].uv[:]])
    return np.array(tris, np.float32).reshape(-1, 3, 2)


def raster(tris, w, h, grow=2):
    """Boolean texture-space mask covered by UV triangles (grown a few pixels against seams)."""
    mask = np.zeros((h, w), bool)
    for t in tris:
        p = t * [w, h]
        x0, y0 = np.floor(p.min(0)).astype(int) - grow
        x1, y1 = np.ceil(p.max(0)).astype(int) + grow
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        l3 = 1 - l1 - l2
        e = grow / max(abs(d) ** 0.5, 1)
        inside = (l1 >= -e) & (l2 >= -e) & (l3 >= -e)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def face_colours(obj, px):
    """Mean texture colour under each face (sampled at its UV corners and centre)."""
    h, w = px.shape[:2]
    uv = obj.data.uv_layers.active.data
    out = np.zeros((len(obj.data.polygons), 3), np.float32)
    for f in obj.data.polygons:
        pts = [uv[i].uv for i in f.loop_indices]
        c = sum((Vector(p) for p in pts), Vector((0, 0))) / len(pts)
        samples = [c] + [c.lerp(Vector(p), 0.6) for p in pts]
        cols = [px[min(int(s.y * h), h - 1), min(int(s.x * w), w - 1), :3] for s in samples]
        out[f.index] = np.mean(cols, 0)
    return out


def blur(m, r):
    for axis in (0, 1):
        for _ in range(3):
            pad = [(r + 1, r) if a == axis else (0, 0) for a in (0, 1)]
            c = np.cumsum(np.pad(m, pad, mode="edge"), axis=axis)
            n = c.shape[axis]
            m = (np.take(c, range(2 * r + 1, n), axis=axis) - np.take(c, range(0, n - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return m


def top_group_names(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    return [names.get(max(v.groups, key=lambda g: g.weight).group) if v.groups else None for v in obj.data.vertices]


def category(bone):
    b = (bone or "")[len(P):] if (bone or "").startswith(P) else (bone or "")
    if "Hand" in b:
        return "hand"
    if "Foot" in b or "Toe" in b:
        return "foot"
    if "UpLeg" in b or b.endswith("Leg"):
        return "leg"
    if b == "Hips":
        return "hips"
    return "top"


def separate(obj, faces, name):
    """Split the given faces of obj into a new object called name."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for f in obj.data.polygons:
        f.select = f.index in faces
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = next(o for o in bpy.context.selected_objects if o is not obj)
    new.name = name
    return new


def delete_faces(obj, faces):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in faces], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def border_verts(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    pts = [obj.matrix_world @ v.co for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    bm.free()
    return pts


def snap(obj, targets, select, limit):
    """Move obj's open-border vertices that pass `select` onto the nearest target point within limit."""
    if not targets:
        return 0
    tree = kdtree.KDTree(len(targets))
    for i, p in enumerate(targets):
        tree.insert(p, i)
    tree.balance()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    moved = 0
    for v in bm.verts:
        if any(e.is_boundary for e in v.link_edges) and select(v.co):
            co, _, d = tree.find(v.co)
            if d < limit:
                v.co = co
                moved += 1
    bm.to_mesh(obj.data)
    bm.free()
    return moved


def tint(obj, rgb):
    """Multiply a part's texture by a colour (exported as glTF baseColorFactor)."""
    mat = obj.material_slots[0].material
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = bsdf.inputs["Base Color"].links[0].from_socket
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    sock = lambda coll, n: next(s for s in coll if s.name == n and s.type == "RGBA")
    nt.links.new(src, sock(mix.inputs, "A"))
    sock(mix.inputs, "B").default_value = (*rgb, 1.0)
    nt.links.new(sock(mix.outputs, "Result"), bsdf.inputs["Base Color"])


def own_material(obj, image=None):
    mat = obj.material_slots[0].material.copy()
    mat.name = obj.name
    obj.material_slots[0].material = mat
    if image is not None:
        colour_image(obj).image = image
    return mat


def srgb_to_lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def skin_colour(obj, px):
    cols = face_colours(obj, px)
    return srgb_to_lin(np.median(cols, 0))


def cheek_skin(mesh, eye, faces=None):
    """Linear skin colour of the cheeks: front-facing faces a few cm under the eyes."""
    px = pixels(colour_image_for(mesh, faces).image)
    pick = [f.index for f in mesh.data.polygons
            if (faces is None or f.index in faces) and eye.z - 0.09 < f.center.z < eye.z - 0.03
            and f.center.y < eye.y + 0.01 and abs(f.center.x) < 0.06]
    cols = face_colours(mesh, px)[pick]
    return srgb_to_lin(np.median(cols, 0))


def colour_image_for(mesh, faces):
    """The colour image of the material used by the given faces (or the first material)."""
    idx = mesh.data.polygons[next(iter(faces))].material_index if faces else 0
    mat = mesh.material_slots[idx].material
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    node = bsdf.inputs["Base Color"].links[0].from_node
    while node.type != "TEX_IMAGE":
        node = next(s for s in node.inputs if s.is_linked).links[0].from_node
    return node


def fit_donor(kind, folder, arm, head, waist_top=None, cut_hem=False):
    """Import a donor, strip its head, move it onto the person's skeleton, split it into parts."""
    darm, dmesh = rb.import_avatar(folder, reset=False)
    rb.rebuild_materials(dmesh, folder)
    if dmesh.data.shape_keys:
        dmesh.shape_key_clear()
    # head + hair faces go; remember which kept vertices touched them (the neck ring)
    drop = {i for i, s in enumerate(dmesh.material_slots) if mat_part(s.material) in ("head", "opacity")}
    head_faces = [f.index for f in dmesh.data.polygons if f.material_index in drop]
    head_mat = {i for i, s in enumerate(dmesh.material_slots) if mat_part(s.material) == "head"}
    donor_cheek = None
    if kind != "trousers" and P + "LeftEye" in darm.data.bones:
        eye = (darm.data.bones[P + "LeftEye"].head_local + darm.data.bones[P + "RightEye"].head_local) / 2
        donor_cheek = cheek_skin(dmesh, eye, {f.index for f in dmesh.data.polygons if f.material_index in head_mat})
    delete_faces(dmesh, head_faces)
    # move each vertex by the weighted offset between the donor's bones and the person's
    offs = {}
    for g in dmesh.vertex_groups:
        if g.name in darm.data.bones and g.name in arm.data.bones:
            offs[g.index] = arm.data.bones[g.name].head_local - darm.data.bones[g.name].head_local
    for v in dmesh.data.vertices:
        tot, d = 0.0, Vector()
        for g in v.groups:
            if g.group in offs:
                d += offs[g.group] * g.weight
                tot += g.weight
        if tot > 0:
            v.co += d / tot
    # re-bind to the person's rig
    mod = next(m for m in dmesh.modifiers if m.type == "ARMATURE")
    mod.object = arm
    dmesh.parent = arm
    dmesh.matrix_parent_inverse = Matrix.Identity(4)
    dmesh.matrix_basis = Matrix.Identity(4)
    bpy.data.objects.remove(darm, do_unlink=True)

    # a clean horizontal cut at the ankle, so trousers end in a straight hem above the shoes
    ankle = arm.data.bones[P + "LeftFoot"].head_local.z
    bm = bmesh.new()
    bm.from_mesh(dmesh.data)
    low = [e for e in bm.edges if min(v.co.z for v in e.verts) < ankle + 0.05]
    geom = list({v for e in low for v in e.verts}) + low + list({f for e in low for f in e.link_faces})
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, ankle), plane_no=(0, 0, 1))
    # (tops from a different character than the trousers) a clean horizontal hem at the top's own
    # hem (where its colour gives way to the donor's bottoms), always overlapping the waistband
    hem_z = arm.data.bones[P + "Hips"].head_local.z - 0.04
    # (trousers) a clean horizontal waistband just above the hip joint; the tops overlap below it
    waist_cut = arm.data.bones[P + "Hips"].head_local.z + 0.02
    if kind == "trousers" and DONORS_SHARE.get(folder) is None:
        band = [e for e in bm.edges if min(v.co.z for v in e.verts) < waist_cut + 0.03 and max(v.co.z for v in e.verts) > waist_cut - 0.03]
        geom = list({v for e in band for v in e.verts}) + band + list({f for e in band for f in e.link_faces})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, waist_cut), plane_no=(0, 0, 1))
    if cut_hem:
        pxs = pixels(colour_image(dmesh).image)
        fc = face_colours(dmesh, pxs)
        zs = np.array([f.center.z for f in dmesh.data.polygons])
        xs = np.array([abs(f.center.x) for f in dmesh.data.polygons])
        torso = (xs < 0.15) & (zs > 0.85) & (zs < 1.3)
        chest = torso & (zs > 1.15)
        legs_ref = np.median(fc[(xs < 0.15) & (zs > 0.6) & (zs < 0.8)], 0)
        top_ref = np.median(fc[chest], 0)
        is_top = np.linalg.norm(fc - top_ref, axis=1) < np.linalg.norm(fc - legs_ref, axis=1)
        sel = torso & is_top & (zs > 0.9)
        colour_hem = float(np.percentile(zs[sel], 5)) if sel.any() else hem_z
        # cut 5 cm under the waistband: overlaps it, and leaves out the donor's own waist
        hem_z = max(colour_hem, (waist_top or colour_hem) - 0.05)
        if waist_top:
            hem_z = min(hem_z, waist_top - 0.03)  # always at least 3 cm over the waistband
        log(kind, "hem: colour", round(colour_hem, 3), "waistband", waist_top and round(waist_top, 3), "-> cut at", round(hem_z, 3))
        band = [e for e in bm.edges if min(v.co.z for v in e.verts) < hem_z + 0.03 and max(v.co.z for v in e.verts) > hem_z - 0.03]
        geom = list({v for e in band for v in e.verts}) + band + list({f for e in band for f in e.link_faces})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, hem_z), plane_no=(0, 0, 1))
    bm.to_mesh(dmesh.data)
    bm.free()

    # sort faces: dominant bone, then texture colour
    img_node = colour_image(dmesh)
    px = pixels(img_node.image)
    cols = face_colours(dmesh, px)
    tops = top_group_names(dmesh)
    cat = []
    for f in dmesh.data.polygons:
        votes = [category(tops[i]) for i in f.vertices]
        cat.append(max(set(votes), key=votes.count))
    cat = np.array(cat)
    skin = np.median(cols[cat == "hand"], 0)
    trousers = np.median(cols[cat == "leg"], 0)
    tc = cols[cat == "top"]
    far = np.linalg.norm(tc - skin, axis=1) > 0.12
    cloth = np.median(tc[far] if far.any() else tc, 0)
    # trousers end and shoes begin at the ankle cut (the texture boundary there is jagged)
    zc = np.array([f.center.z for f in dmesh.data.polygons])
    sole_top = ankle * 0.45
    shoe = np.median(cols[(cat == "foot") & (zc < sole_top)], 0) if ((cat == "foot") & (zc < sole_top)).any() else trousers
    distinct = lambda a, b: np.linalg.norm(a - b) > 0.15
    jacket_low = arm.data.bones[P + "Hips"].head_local.z - 0.15  # how far down a jacket's hem can reach
    parts = {}
    near = lambda i, opts: min(opts.items(), key=lambda o: np.linalg.norm(cols[i] - o[1]))[0]
    for i, c in enumerate(cat):
        z = dmesh.data.polygons[i].center.z
        bones_here = [tops[v] or "" for v in dmesh.data.polygons[i].vertices]
        if c == "hand":
            k = near(i, {"skin": skin, "top": cloth})  # shirt cuffs reach over the wrist
        elif c in ("foot", "leg"):
            k = "shoes" if z < ankle else "trousers"
            if kind == "trousers":
                # a jacket's hem over the thighs is not trousers; a trouser cuff just below the ankle is
                is_tr = np.linalg.norm(cols[i] - trousers) < 0.25
                if k == "shoes" and z > sole_top and is_tr and distinct(trousers, shoe):
                    k = "trousers"
        elif kind == "trousers" and c == "top" and DONORS_SHARE.get(folder) is None and z < waist_cut:
            k = "trousers"
        elif cut_hem and c in ("hips", "top") and z < hem_z:
            k = "trousers"  # below the top's new hem: the donor's own bottoms (dropped)
        elif kind == "tee" and any("ForeArm" in b for b in bones_here):
            k = "skin"  # a T-shirt's sleeves stop above the elbow (wristbands etc. are not tee)
        elif kind == "tee" and not any(n in b for b in bones_here for n in ("Arm", "Neck", "Head")):
            k = "top"  # torso: T-shirt (jeans can be closer in colour to skin than a dark tee is)
        elif c == "hips":
            if cut_hem:
                k = "top"
            elif kind == "trousers":
                # below the waistband cut: trousers (whatever covered them there is hidden under the top)
                k = "trousers" if (DONORS_SHARE.get(folder) is None and z < waist_cut) or                     (DONORS_SHARE.get(folder) is not None and np.linalg.norm(cols[i] - trousers) < 0.18) else "top"
            else:
                k = near(i, {"top": cloth, "trousers": trousers})
        else:
            k = near(i, {"top": cloth, "skin": skin})
        parts.setdefault(k, set()).add(i)
    log(kind, "faces", {k: len(v) for k, v in parts.items()})

    # neutralise the texture: top -> white, trousers -> light grey, soft fold shading only
    h, w = px.shape[:2]
    out = px.copy()
    lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    soft = blur(lum, max(3, w // 256))
    # texture areas that skin or shoes also use stay untouched (UV islands can share pixels)
    protect = np.zeros((h, w), bool)
    for k in ("skin", "shoes"):
        if k in parts:
            protect |= raster(face_uv_tris(dmesh, parts[k]), w, h, grow=0)
    for k, level in (("top", 0.95), ("trousers", 0.8)):
        if k not in parts or (k == "trousers") != (kind == "trousers"):
            continue
        mask = raster(face_uv_tris(dmesh, parts[k]), w, h) & ~protect
        ref = np.median(soft[mask]) + 1e-4
        shade = np.clip(soft / ref, 0.55, 1.15) ** 0.6
        out[mask, :3] = np.clip(level * shade[mask], 0, 1)[:, None]
    neutral = bpy.data.images.new(f"{kind}_neutral", w, h, alpha=True)
    neutral.pixels.foreach_set(out.ravel())
    neutral.pack()

    # split into objects
    objs = {}
    keep = ("trousers", "shoes") if kind == "trousers" else ("top", "skin")
    main_part = keep[0]
    drop_faces = set().union(*(v for k, v in parts.items() if k not in keep)) if any(k not in keep for k in parts) else set()
    # vertices on the edge of dropped faces (the tee's hem above the jeans)
    hem = {vi for f in drop_faces for vi in dmesh.data.polygons[f].vertices}
    names = {"top": f"Top_{kind}", "skin": f"Skin_{kind}", "trousers": "Trousers", "shoes": "Shoes"}
    for k in keep:
        if k in parts and k != main_part:
            # indices shift after each separate, so match by face centre
            objs[k] = parts[k]
    centres = {i: dmesh.data.polygons[i].center.copy() for i in range(len(dmesh.data.polygons))}
    hem_pos = [dmesh.data.vertices[i].co.copy() for i in hem]
    if drop_faces:
        delete_faces(dmesh, drop_faces)
    result = {}
    for k in ("skin", "trousers", "shoes"):
        if k not in objs or k == main_part:
            continue
        want = {tuple(round(x, 5) for x in centres[i]) for i in objs[k]}
        faces = {f.index for f in dmesh.data.polygons if tuple(round(x, 5) for x in f.center) in want}
        result[k] = separate(dmesh, faces, names[k])
    dmesh.name = names[main_part]
    result[main_part] = dmesh

    # materials: tops/trousers get the neutral texture, each part its own material for tinting
    for k, o in result.items():
        own_material(o, neutral if k in ("top", "trousers") else None)

    # seams: neck ring onto the person's head, (tee) hem onto the trousers
    head_border = border_verts(head)
    neck_z = min(p.z for p in head_border) - 0.06
    for o in ([] if kind == "trousers" else result.values()):
        n = snap(o, head_border, lambda co: co.z > neck_z, 0.08)
        if n:
            log(kind, o.name, "neck verts snapped", n)
    result["hem"] = hem_pos
    result["skin_ref"] = donor_cheek if donor_cheek is not None else srgb_to_lin(skin)
    return result


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    person, sex, out = args[0], args[1], args[2]
    preview = args[3] if len(args) > 3 else None
    root = os.path.dirname(os.path.normpath(person))
    rb.SRC = person

    arm, mesh = rb.import_avatar(person)
    rb.rebuild_materials(mesh, person)
    parts = rb.split_parts(mesh)
    parts["Clothes_outfit"].name = "Outfit_original"
    parts["Body_hands"].name = "Skin_original"
    parts = {o.name: o for o in parts.values()}
    for o in list(parts.values()):
        rb.face_shapes(o)
    head = parts["Body"]
    eye = (arm.data.bones[P + "LeftEye"].head_local + arm.data.bones[P + "RightEye"].head_local) / 2
    person_skin = cheek_skin(head, eye)
    arm.name = "Rig"

    folders = {k: os.path.join(root, v) for k, v in DONORS[sex].items()}
    if folders["shirt"] == folders["trousers"]:
        DONORS_SHARE[folders["trousers"]] = True
    trousers = fit_donor("trousers", folders["trousers"], arm, head)
    waist = border_verts(trousers["trousers"])
    top_z = max(p.z for p in waist if abs(p.x) < 0.2)
    tops = {}
    for kind in ("shirt", "tee"):
        # a top from the trousers' own character is already tucked into them; others get a clean hem
        cut = folders[kind] != folders["trousers"]
        tops[kind] = fit_donor(kind, folders[kind], arm, head, waist_top=top_z, cut_hem=cut)
        if not cut:
            continue
        # the top hangs over the trousers: drop faces well below the waistband, then push every lower
        # vertex that is inside or touching the trousers out to just outside them
        top = tops[kind]["top"]
        low = {f.index for f in top.data.polygons if f.center.z < top_z - 0.15}
        if low:
            delete_faces(top, low)
        bvh = BVHTree.FromObject(trousers["trousers"], bpy.context.evaluated_depsgraph_get(), deform=False)
        for o in (top, tops[kind]["skin"]):
            o.data.update()
            pushed = 0
            for v in o.data.vertices:
                if v.co.z > top_z + 0.1:
                    continue
                hit, normal, _, dist = bvh.find_nearest(v.co)
                if hit is None or dist > 0.08:
                    continue
                # push outward horizontally only (near the waistband's top edge the surface faces up,
                # and pushing along that would fold the hem into flaps)
                n = Vector((normal.x, normal.y, 0))
                if n.length < 0.3:
                    continue
                n.normalize()
                gap = (v.co - hit).dot(n)
                if gap < 0.01:
                    v.co += n * (0.01 - gap)
                    pushed += 1
            log(kind, o.name, "dropped", len(low) if o is top else 0, "low faces; pushed out", pushed)
    shirt, tee = tops["shirt"], tops["tee"]
    # donor skin takes the person's skin colour
    for d in (shirt, tee):
        ratio = np.clip(person_skin / np.maximum(d["skin_ref"], 1e-3), 0.25, 2.5)
        tint(d["skin"], tuple(float(x) for x in ratio))
        log("skin tint", d["skin"].name, [round(float(x), 2) for x in ratio])

    if not os.environ.get("AVATAR_NOANIM"):
        rb.bake_native(arm, female=(sex == "f"))
    if preview:
        shown = {"Body", "Hair", "Top_shirt", "Skin_shirt", "Trousers", "Shoes"}
        hidden = [o for o in bpy.data.objects if o.type == "MESH" and o.name not in shown]
        for o in hidden:
            o.hide_render = True
        if arm.animation_data:
            for t in arm.animation_data.nla_tracks:
                t.mute = t.name != "Idle"
            bpy.context.scene.frame_set(30)
        rb.render_preview(preview, arm)
        # second preview: T-shirt
        for o in bpy.data.objects:
            if o.type == "MESH":
                o.hide_render = o.name not in {"Body", "Hair", "Top_tee", "Skin_tee", "Trousers", "Shoes"}
        bpy.context.scene.render.filepath = preview.replace(".png", "_tee.png")
        bpy.ops.render.render(write_still=True)
        cam = bpy.context.scene.camera
        cam.location, cam.data.lens = (0.0, -1.6, 0.95), 50
        bpy.context.scene.render.filepath = preview.replace(".png", "_tee_waist.png")
        bpy.ops.render.render(write_still=True)
        for o in bpy.data.objects:
            o.hide_render = False
        if arm.animation_data:
            for t in arm.animation_data.nla_tracks:
                t.mute = False
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=False, export_morph=True, export_morph_normal=False,
        export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_image_format="WEBP", export_image_quality=85, export_optimize_animation_size=True, export_frame_step=2,
        export_apply=True, export_yup=True,
    )
    log("EXPORTED", out, round(os.path.getsize(out) / 1e6, 2), "MB",
        sorted(o.name for o in bpy.data.objects if o.type == "MESH"))


main()
