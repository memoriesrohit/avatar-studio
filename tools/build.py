"""Build realistic, rigged avatars with MPFB (MakeHuman for Blender) and export them as GLB.

Run:  blender -b -P build.py -- <characters.json> <output dir> [only_id]

Each character gets: a MakeHuman body shaped by its macro settings (gender, age, muscle, weight,
height, ethnicity), a skin texture, eyes, eyebrows, eyelashes, teeth, tongue, hair, clothes, shoes,
a Mixamo-compatible skeleton, and the MakeHuman face units as morph targets so the browser can make
real facial expressions.
"""

import importlib
import json
import math
import os
import sys
import zipfile

import bpy
import numpy as np
from mathutils import Vector

BASE = "bl_ext.user_default.mpfb"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import mocap  # noqa: E402


def svc(module, cls):
    return getattr(importlib.import_module(f"{BASE}.services.{module}"), cls)


HumanService = svc("humanservice", "HumanService")
TargetService = svc("targetservice", "TargetService")
AssetService = svc("assetservice", "AssetService")
ExportService = svc("exportservice", "ExportService")
LocationService = svc("locationservice", "LocationService")
ClothesService = svc("clothesservice", "ClothesService")

MPFB_DATA = LocationService.get_mpfb_data()
USER_DATA = LocationService.get_user_data()
TEXTURE_LIMIT = int(os.environ.get("AVATAR_TEXTURES", "2048"))  # skin and clothes; WebP keeps this small


def log(*a):
    print("[build]", *a, flush=True)


def install_packs(zips):
    for z in zips:
        marker = os.path.join(USER_DATA, ".installed_" + os.path.basename(z))
        if os.path.exists(marker):
            continue
        log("installing pack", z)
        with zipfile.ZipFile(z) as f:
            f.extractall(USER_DATA)
        open(marker, "w").close()
    AssetService.update_all_asset_lists()


def find_asset(subdir, name, ext):
    """Find an asset file by its folder/file name anywhere in the asset roots."""
    for root in AssetService.get_asset_roots(subdir):
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f.lower() == f"{name}.{ext}".lower():
                    return os.path.join(dirpath, f)
    raise FileNotFoundError(f"{subdir}/{name}.{ext}")


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.node_groups):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def load_face_units(human, ethnicity):
    """Add every MakeHuman face unit (eye closure, brow raise, smile, jaw open, ...) as a shape key."""
    folder = os.path.join(MPFB_DATA, "targets", "expression", "units", ethnicity)
    names = []
    for f in sorted(os.listdir(folder)):
        if f.endswith(".target.gz"):
            name = f.replace(".target.gz", "")
            TargetService.load_target(human, os.path.join(folder, f), weight=0.0, name=name)
            names.append(name)
    return names


def _gltf_output_group():
    """Node group the glTF exporter reads extra maps from; its 'Occlusion' input becomes occlusionTexture."""
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return group


def _base_color_size(mat, fallback=2048):
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image is not None and node.image.size[0] > 0:
            return max(node.image.size[0], node.image.size[1])
    return fallback


def _use_gpu():
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
        except TypeError:
            continue
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            return kind
    return "CPU"


def bake_ao(objects, hide=(), distance=0.07, samples=96):
    """Bake ambient occlusion (eye sockets, nostrils, ears, lips, collars, cuffs, folds) per object.

    Following the texture-workflow rule "AO: multiply in shader, not base colour", each AO map is wired
    into the glTF 'Occlusion' slot, so engines apply it to ambient light only and colours stay clean.
    Hair, brows and lashes are hidden while baking: their see-through cards would otherwise darken the
    scalp and forehead like solid helmets.
    """
    scene = bpy.context.scene
    old_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    device = _use_gpu()
    scene.cycles.device = "GPU" if device != "CPU" else "CPU"
    scene.cycles.samples = samples
    scene.world = scene.world or bpy.data.worlds.new("w")
    scene.world.light_settings.distance = distance
    hidden = [(o, o.hide_render) for o in hide]
    for o in hide:
        o.hide_render = True
    for obj in objects:
        mats = [s.material for s in obj.material_slots if s.material and s.material.node_tree]
        if not mats or not obj.data.uv_layers:
            continue
        size = min(2048, _base_color_size(mats[0]))
        img = bpy.data.images.new(f"{obj.name}_ao", size, size)
        img.colorspace_settings.name = "Non-Color"
        targets = []
        for m in mats:
            node = m.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            m.node_tree.nodes.active = node
            targets.append((m, node))
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO", margin=16, use_clear=True)
        img.pack()
        for m, node in targets:
            group = m.node_tree.nodes.new("ShaderNodeGroup")
            group.node_tree = _gltf_output_group()
            sep = m.node_tree.nodes.new("ShaderNodeSeparateColor")
            m.node_tree.links.new(node.outputs["Color"], sep.inputs["Color"])
            m.node_tree.links.new(sep.outputs["Red"], group.inputs["Occlusion"])
        log("ao", obj.name, f"{size}px", device)
    for o, was in hidden:
        o.hide_render = was
    scene.render.engine = old_engine


def _srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def _blur(m, radius):
    """Three box-blur passes each way, close to a Gaussian."""
    for axis in (0, 1):
        for _ in range(3):
            c = np.cumsum(np.pad(m, [(radius + 1, radius) if a == axis else (0, 0) for a in (0, 1)], mode="edge"), axis=axis)
            m = (np.take(c, range(2 * radius + 1, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - 2 * radius - 1), axis=axis)) / (2 * radius + 1)
    return m


def _texture_feeding(mat, socket="Base Color"):
    """The image texture node behind a material's base colour, looking through the tint Mix node."""
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    node = bsdf.inputs[socket].links[0].from_node if bsdf and bsdf.inputs[socket].is_linked else None
    while node is not None and node.type != "TEX_IMAGE":
        linked = [s for s in node.inputs if s.is_linked]
        node = linked[0].links[0].from_node if linked else None
    return node


def bake_scalp(human, layers, skin_tint=None):
    """Shade the skin under hair and eyebrows with their colour, fading out at the edges.

    Real hair thins out into the scalp, so a hairline is a soft gradient, not the hard edge of a
    cut-out hair shell. Cycles projects each layer's coverage (its texture alpha) onto the body's
    skin texture (selected-to-active bake, rays only within a few cm of the skin), the coverage is
    blurred, and the skin is blended towards the layer's root colour by it.
    layers: [(object, strength, hair_tint or None)]
    """
    scene = bpy.context.scene
    old_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU" if _use_gpu() != "CPU" else "CPU"
    scene.cycles.samples = 16
    body_mat = human.material_slots[0].material
    skin_node = _texture_feeding(body_mat)
    if skin_node is None:
        log("WARNING no skin texture for scalp shading")
        scene.render.engine = old_engine
        return
    w, h = skin_node.image.size
    skin = _pixels(skin_node.image).copy()
    rgb = _srgb_to_lin(skin[..., :3])
    tint = np.array(skin_tint or (1, 1, 1), np.float32)
    for obj, strength, hair_tint in layers:
        tex = next((_texture_feeding(s.material) for s in obj.material_slots if s.material), None)
        if tex is None:
            continue
        # root colour: the hair texture's solid strands, darkened a little (roots and shadow)
        hp = _pixels(tex.image)
        solid = hp[..., 3] > 0.6
        root = _srgb_to_lin(hp[solid][:, :3]).mean(0) * np.array(hair_tint or (1, 1, 1)) * 0.75
        # temporary emission material: alpha -> white coverage
        cover = bpy.data.materials.new("coverage")
        cover.use_nodes = True
        nt = cover.node_tree
        nt.nodes.clear()
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = tex.image
        em = nt.nodes.new("ShaderNodeEmission")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(t.outputs["Alpha"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        saved = [s.material for s in obj.material_slots]
        for s in obj.material_slots:
            s.material = cover
        mask_img = bpy.data.images.new(f"{obj.name}_cover", w, h)
        mask_img.colorspace_settings.name = "Non-Color"
        target = body_mat.node_tree.nodes.new("ShaderNodeTexImage")
        target.image = mask_img
        body_mat.node_tree.nodes.active = target
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        human.select_set(True)
        bpy.context.view_layer.objects.active = human
        bpy.ops.object.bake(type="EMIT", use_selected_to_active=True, cage_extrusion=0.07,
                            max_ray_distance=0.075, margin=8, use_clear=True)
        mask = _pixels(mask_img)[..., 0]
        # feather about 1 cm past the hair edge: dense inside, thinning out onto the skin
        soft = _blur(mask, max(3, w // 180))
        mask = np.clip(np.maximum(mask, soft * 1.8), 0, 1) * strength
        target_lin = np.clip(root / np.maximum(tint, 1e-3), 0, 1)
        rgb = rgb * (1 - mask[..., None]) + target_lin * mask[..., None]
        for s, m in zip(obj.material_slots, saved):
            s.material = m
        body_mat.node_tree.nodes.remove(target)
        bpy.data.materials.remove(cover)
        bpy.data.images.remove(mask_img)
        log("scalp", obj.name, f"coverage {float((mask > 0.05).mean()):.3f}", f"mean {float(mask[mask > 0.05].mean()):.2f}")
    skin[..., :3] = _lin_to_srgb(rgb)
    new = bpy.data.images.new(f"{human.name}_skin_scalp", w, h, alpha=True)
    new.pixels.foreach_set(skin.ravel())
    new.pack()
    skin_node.image = new
    scene.render.engine = old_engine


EYE_LOOK = {  # shape key: (axis, degrees) - the character faces -Y, its left is +X
    "eyes-look-left": ("Z", 25), "eyes-look-right": ("Z", -25),
    "eyes-look-up": ("X", -20), "eyes-look-down": ("X", 20),
}


def add_eye_look(eyes):
    """Shape keys that turn both eyeballs (each about its own centre), so the app can aim the gaze."""
    from mathutils import Matrix
    if not eyes.data.shape_keys:
        eyes.shape_key_add(name="Basis", from_mix=False)
    rest = [v.co.copy() for v in eyes.data.vertices]
    centres = {}
    for side in (1, -1):
        pts = [c for c in rest if c.x * side > 0]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        centres[side] = (lo + hi) / 2
    for name, (axis, deg) in EYE_LOOK.items():
        rot = Matrix.Rotation(math.radians(deg), 3, axis)
        key = eyes.shape_key_add(name=name, from_mix=False)
        for i, c in enumerate(rest):
            centre = centres[1 if c.x > 0 else -1]
            key.data[i].co = centre + rot @ (c - centre)
    log("eye look keys", list(EYE_LOOK))


def obj_name(o):
    return o.name


def set_eye_texture(eyes, path):
    """Swap the iris/sclera image of the eye material for one of our natural eye textures."""
    img = bpy.data.images.load(path, check_existing=True)
    swapped = 0
    for slot in eyes.material_slots:
        if slot.material and slot.material.node_tree:
            for node in slot.material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image is not None and "eye" in node.image.name.lower():
                    node.image = img
                    swapped += 1
    log("eyes", os.path.basename(path), "swapped", swapped)


def tint_skin(human, rgb):
    """Multiply the skin texture by a colour (exports as glTF baseColorFactor)."""
    for slot in human.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf or not bsdf.inputs["Base Color"].is_linked:
            continue
        src = bsdf.inputs["Base Color"].links[0].from_socket
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        sock = lambda coll, name: next(s for s in coll if s.name == name and s.type == "RGBA")
        links.new(src, sock(mix.inputs, "A"))
        sock(mix.inputs, "B").default_value = (*rgb, 1.0)
        links.new(sock(mix.outputs, "Result"), bsdf.inputs["Base Color"])


def tint_hair(obj, rgb):
    """Darken/recolour hair: its material already multiplies the texture by a 'diffuseIntensity' colour."""
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        node = nodes.get("diffuseIntensity")
        tex = nodes.get("diffuseTexture")
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if node is not None and tex is not None and bsdf is not None:
            # bypass the legacy colour node (glTF can't export it) so the tint below lands on the texture
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            nodes.remove(node)
    tint_skin(obj, rgb)  # texture x colour, exported as baseColorFactor


def transfer_face_units(human, proxies, units):
    """Give eyebrows, eyelashes, teeth and tongue the same face-unit shape keys as the body.

    MPFB refits an asset to the body's current shape, so we switch each unit on, refit, and record
    where the asset's vertices end up. Then they blink, frown and open the mouth with the face.
    """
    keys = human.data.shape_keys.key_blocks
    shapes = {obj.name: {} for obj in proxies}
    for unit in units:
        for k in units:
            keys[k].value = 1.0 if k == unit else 0.0
        for obj in proxies:
            ClothesService.fit_clothes_to_human(obj, human)
            shapes[obj.name][unit] = [v.co.copy() for v in obj.data.vertices]
    for k in units:
        keys[k].value = 0.0
    for obj in proxies:
        ClothesService.fit_clothes_to_human(obj, human)
        obj.shape_key_add(name="Basis", from_mix=False)
        for unit in units:
            sk = obj.shape_key_add(name=unit, from_mix=False)
            for i, co in enumerate(shapes[obj.name][unit]):
                sk.data[i].co = co


def shrink_textures():
    """Skin and clothes stay sharp; small parts (eyes, teeth, shoes, lashes) get smaller textures."""
    small = ("teeth", "tongue", "eye", "shoes", "lash", "brow")
    for img in bpy.data.images:
        limit = 512 if any(s in img.name.lower() for s in small) else TEXTURE_LIMIT
        w, h = img.size
        if max(w, h) > limit:
            k = limit / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))


def render_preview(path, focus="body"):
    """Quick EEVEE render so the result can be checked without opening Blender."""
    scene = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    if focus == "face":
        rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        z = (rig.matrix_world @ rig.pose.bones["mixamorig:Head"].head).z + 0.09
        cam.location = (0.0, -0.75, z)
        cam.data.lens = 85
    elif focus == "bust":
        head = next(o for o in bpy.data.objects if o.type == "ARMATURE").pose.bones["mixamorig:Head"]
        z = (next(o for o in bpy.data.objects if o.type == "ARMATURE").matrix_world @ head.head).z
        cam.location = (0.0, -1.5, z - 0.06)
        cam.data.lens = 70
    else:
        cam.location = (0.0, -4.2, 1.0)
        cam.data.lens = 50
    cam.rotation_euler = (math.radians(90), 0, 0)
    for loc, energy in (((2, -3, 3), 900), ((-3, -2, 2), 400), ((0, 3, 3), 500)):
        light = bpy.data.objects.new("light", bpy.data.lights.new("light", "AREA"))
        light.data.energy = energy
        light.data.size = 3
        light.location = loc
        light.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(light)
    scene.world = scene.world or bpy.data.worlds.new("w")
    scene.world.color = (0.18, 0.18, 0.2)
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = (600, 900) if focus == "body" else (512, 512)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in [cam] + [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)


HERE = os.path.dirname(os.path.abspath(__file__))
MOCAP_DIR = os.environ.get("AVATAR_MOCAP", os.path.join(HERE, "mocap"))


def bake_mocap(arm, spec):
    """Retarget each motion-capture clip in moves.json onto the character's skeleton."""
    moves = json.load(open(os.path.join(HERE, "moves.json"), encoding="utf-8-sig"))
    only = [m for m in os.environ.get("AVATAR_MOVES", "").split(",") if m]
    clips = {}
    for m in moves:
        if only and m["name"] not in only:
            continue
        subject = m["clip"].split("_")[0].lstrip("0")
        clip = mocap.Clip(os.path.join(MOCAP_DIR, f"{subject}.asf"), os.path.join(MOCAP_DIR, f"{m['clip']}.amc"),
                          m["fps"], m.get("start", 0), m.get("length"), m.get("inplace", "fixed"))
        if m.get("loop"):
            a, b = mocap.best_loop(clip, int(m["loop"][0] * mocap.FPS), int(m["loop"][1] * mocap.FPS))
            clip.trim(a, b)
        mocap.retarget(arm, clip, m["name"], finger_pose=anim.relaxed_hands(), stance=m.get("stance"))
        clips[m["name"]] = clip
        log(spec["id"], "move", m["name"], f"{len(clip) / mocap.FPS:.1f}s")
    return clips


def verify_moves(arm, clips, out_dir, sid, samples=4):
    """Render each move next to the performer's own skeleton (stick figure), front and side, and
    log how far the torso leans in each, so retargeting errors are visible and measurable."""
    import bmesh
    scene = bpy.context.scene
    tracks = list(arm.animation_data.nla_tracks)
    for t in tracks:
        t.mute = True
    bpy.context.view_layer.update()
    hips_rest = arm.pose.bones["mixamorig:Hips"].bone.head_local.copy()
    stick = bpy.data.objects.new("stick", bpy.data.meshes.new("stick"))
    scene.collection.objects.link(stick)
    skin = stick.modifiers.new("skin", "SKIN")
    stick.modifiers.new("sub", "SUBSURF").levels = 1
    mat = bpy.data.materials.new("stickmat")
    mat.diffuse_color = (0.9, 0.8, 0.3, 1)
    stick.data.materials.append(mat)
    offset = Vector((0.85, 0, 0))
    report = {}
    for track in tracks:
        name = track.name
        clip = clips[name]
        action = bpy.data.actions[name]
        arm.animation_data.action = action
        end = len(clip) - 1
        leans = []
        for k in range(samples):
            f = int(k * end / max(1, samples - 1))
            scene.frame_set(f)
            pts = mocap.source_points(clip, f, hips_rest)
            names = list(pts)
            bm = bmesh.new()
            layer = bm.verts.layers.skin.verify()
            verts = {n: bm.verts.new(pts[n] + offset) for n in names}
            for v in bm.verts:
                v[layer].radius = (0.022, 0.022)
            verts["root"][layer].use_root = True
            for child, parent in clip.skel.parent.items():
                if child in verts and parent in verts:
                    bm.edges.new((verts[parent], verts[child]))
            bm.to_mesh(stick.data)
            bm.free()
            # torso lean (degrees from vertical, + = backwards) for performer and character
            def lean(a, b):
                d = (b - a).normalized()
                return math.degrees(math.atan2(d.y, d.z))  # +Y is behind the character
            src = lean(pts["root"], pts["lowerneck"])
            pb = arm.pose.bones
            tgt = lean((arm.matrix_world @ pb["mixamorig:Hips"].head), (arm.matrix_world @ pb["mixamorig:Neck"].head))
            leans.append((round(src, 1), round(tgt, 1)))
            for view in ("front", "side"):
                render_compare(os.path.join(out_dir, "verify", f"{sid}_{name.replace(' ', '_')}_{k}_{view}.png"), view)
        report[name] = leans
        log("VERIFY", name, "lean performer/character per sample:", leans)
        arm.animation_data.action = None
    bpy.data.objects.remove(stick, do_unlink=True)
    for t in tracks:
        t.mute = False
    return report


def render_compare(path, view):
    scene = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 40
    if view == "front":
        cam.location, cam.rotation_euler = (0.42, -5.2, 1.0), (math.radians(90), 0, 0)
    else:
        cam.location, cam.rotation_euler = (5.6, 0.0, 1.0), (math.radians(90), 0, math.radians(90))
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    scene.world = scene.world or bpy.data.worlds.new("w")
    scene.world.color = (0.2, 0.2, 0.22)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 420, 460
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)


def render_moves(arm, out_dir, sid):
    """Contact sheet frames: each move at a few moments, to check the retargeting."""
    tracks = list(arm.animation_data.nla_tracks)
    for t in tracks:
        t.mute = True
    for track in tracks:
        action = bpy.data.actions[track.name]
        arm.animation_data.action = action
        end = int(action.frame_range[1])
        for k, f in enumerate((0, end // 3, 2 * end // 3)):
            bpy.context.scene.frame_set(f)
            head = arm.pose.bones["mixamorig:Head"]
            log("pose", track.name, f, tuple(round(v, 2) for v in (arm.matrix_world @ head.head)))
            render_preview(os.path.join(out_dir, "moves", f"{sid}_{track.name.replace(' ', '_')}_{k}.png"))
        arm.animation_data.action = None
    for t in tracks:
        t.mute = False


def build(spec, out_dir):
    clear_scene()
    macros = {**TargetService.get_default_macro_info_dict(), **spec["macros"]}
    human = HumanService.create_human(macro_detail_dict=macros)
    human.name = spec["id"]

    # extra face/body details, e.g. a stronger jaw
    for target, weight in spec.get("targets", {}).items():
        path = TargetService.target_full_path(target)
        if path:
            TargetService.load_target(human, path, weight=weight, name=target)
        else:
            log("WARNING unknown face target", target)

    HumanService.add_builtin_rig(human, "mixamo")
    try:
        HumanService.set_character_skin(find_asset("skins", spec["skin"], "mhmat"), human, skin_type="GAMEENGINE")
    except FileNotFoundError as e:
        log("WARNING missing skin", e)

    parts = [("eyes", spec.get("eyes", "high-poly"), "Eyes"), ("eyebrows", spec["eyebrows"], "Eyebrows"),
             ("eyelashes", spec.get("eyelashes", "Eyelashes01"), "Eyelashes"), ("teeth", "teeth_base", "Teeth"),
             ("tongue", "tongue01", "Tongue")]
    if spec.get("hair"):
        parts.append(("hair", spec["hair"], "Hair"))
    for c in spec.get("clothes", []):
        parts.append(("clothes", c, "Clothes"))
    face_parts = []
    named = []
    for subdir, name, kind in parts:
        log(spec["id"], "adding", kind, name)
        try:
            mhclo = find_asset(subdir, name, "mhclo")
        except FileNotFoundError as e:
            log("WARNING missing asset", e)
            continue
        obj = HumanService.add_mhclo_asset(mhclo, human, asset_type=kind, subdiv_levels=1 if kind in ("Clothes", "Hair") else 0,
                                           material_type="MAKESKIN")
        if kind in ("Eyebrows", "Eyelashes", "Teeth", "Tongue"):
            face_parts.append(obj)
        if kind == "Eyes" and spec.get("eye_texture"):
            set_eye_texture(obj, os.path.join(HERE, "eyes", spec["eye_texture"]))
        named.append((obj, kind if kind != "Clothes" else f"Clothes_{name}"))

    # bake the body shape into the mesh, then add the face units as fresh morph targets
    TargetService.bake_targets(human)
    units = load_face_units(human, spec.get("face_units", "caucasian"))
    transfer_face_units(human, face_parts, units)
    # one level of subdivision smooths the face and body silhouette (baked so the face shapes survive)
    sub = human.modifiers.new("Smooth", "SUBSURF")
    sub.levels = sub.render_levels = 1
    ExportService.bake_modifiers_remove_helpers(human, bake_masks=True, bake_subdiv=True, remove_helpers=True)
    shrink_textures()
    if spec.get("skin_tint"):
        tint_skin(human, spec["skin_tint"])
    for obj, label in named:
        if label in ("Hair", "Eyebrows") and spec.get("hair_tint"):
            tint_hair(obj, spec["hair_tint"])
    for obj, label in named:
        if label == "Eyes":
            add_eye_look(obj)
    if not os.environ.get("AVATAR_NO_SCALP"):
        layers = [(o, 0.9 if label == "Hair" else 0.45, spec.get("hair_tint"))
                  for o, label in named if label in ("Hair", "Eyebrows")]
        bake_scalp(human, layers, spec.get("skin_tint"))
    if not os.environ.get("AVATAR_NO_AO"):
        strands = [o for o, label in named if label in ("Hair", "Eyebrows", "Eyelashes")]
        bake_ao([human] + [o for o, label in named if label.startswith("Clothes")], hide=strands)

    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    if os.environ.get("AVATAR_BONES"):
        log("BONES", [b.name for b in arm.pose.bones])
    if os.environ.get("AVATAR_PREVIEW"):
        render_preview(os.path.join(out_dir, f"{spec['id']}_body.png"))
        faces = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "expressions.json")))
        wanted = os.environ.get("AVATAR_FACES", "Neutral").split(",")
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys]
        for name in wanted:
            for o in meshes:
                for k in o.data.shape_keys.key_blocks[1:]:
                    k.value = faces[name].get(k.name, 0.0)
            render_preview(os.path.join(out_dir, f"{spec['id']}_face_{name.replace(' ', '_')}.png"), focus="face")
        for o in meshes:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = 0.0
    for move in filter(None, os.environ.get("AVATAR_POSES", "").split(",")):
        fn, length = anim.MOVES[move]
        anim.apply_move(arm, fn(length * 0.3))
        render_preview(os.path.join(out_dir, f"{spec['id']}_pose_{move.replace(' ', '_')}.png"))
    anim.apply_move(arm, [])
    if spec.get("thumb"):
        faces = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "expressions.json")))
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys]
        for o in meshes:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = faces["Smile"].get(k.name, 0.0)
        anim.apply_move(arm, anim.arms_down())
        render_preview(os.path.join(out_dir, "thumbs", f"{spec['id'].split('_')[0]}.png"), focus="bust")
        for o in meshes:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = 0.0
        anim.apply_move(arm, [])
    if spec.get("animations", True) and not os.environ.get("AVATAR_NOANIM"):
        clips = bake_mocap(arm, spec)
        if os.environ.get("AVATAR_VERIFY"):
            verify_moves(arm, clips, out_dir, spec["id"])
        if os.environ.get("AVATAR_MOVE_PREVIEW"):
            render_moves(arm, out_dir, spec["id"])

    # clear names so the web app can tell skin, hair and clothes apart
    for obj, label in named:
        obj.name = label
    human.name = "Body"
    arm.name = "Rig"

    path = os.path.join(out_dir, f"{spec['id']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False, export_morph=True, export_morph_normal=False,
        export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_image_format="WEBP", export_image_quality=80, export_optimize_animation_size=True, export_frame_step=2,
        export_apply=True, export_yup=True,
    )
    log("EXPORTED", path, round(os.path.getsize(path) / 1e6, 2), "MB", len(units), "face units")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    specs_file, out_dir = argv[0], argv[1]
    only = argv[2] if len(argv) > 2 else None
    cfg = json.load(open(specs_file, encoding="utf-8-sig"))
    install_packs(cfg.get("packs", []))
    os.makedirs(out_dir, exist_ok=True)
    characters = cfg.get("characters", [])
    # "people" form: one character per person and outfit
    for pid, person in cfg.get("people", {}).items():
        for outfit, clothes in person["outfits"].items():
            spec = {k: v for k, v in person.items() if k != "outfits"}
            characters.append({**spec, "id": f"{pid}_{outfit}", "clothes": clothes, "thumb": outfit == "formal"})
    for spec in characters:
        if only and spec["id"] != only:
            continue
        build(spec, out_dir)


main()
