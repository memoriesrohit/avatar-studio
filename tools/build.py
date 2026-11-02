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
from mathutils import Vector

BASE = "bl_ext.user_default.mpfb"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402


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
TEXTURE_LIMIT = 1024  # keep GLBs small enough for the web


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


def obj_name(o):
    return o.name


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
        cam.location = (0.0, -0.75, 1.62)
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


def build(spec, out_dir):
    clear_scene()
    macros = {**TargetService.get_default_macro_info_dict(), **spec["macros"]}
    human = HumanService.create_human(macro_detail_dict=macros)
    human.name = spec["id"]

    # extra face/body details, e.g. a stronger jaw
    for target, weight in spec.get("targets", {}).items():
        TargetService.set_target_value(human, target, weight)

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
        obj = HumanService.add_mhclo_asset(mhclo, human, asset_type=kind, subdiv_levels=0, material_type="MAKESKIN")
        if kind in ("Eyebrows", "Eyelashes", "Teeth", "Tongue"):
            face_parts.append(obj)
        named.append((obj, kind if kind != "Clothes" else f"Clothes_{name}"))

    # bake the body shape into the mesh, then add the face units as fresh morph targets
    TargetService.bake_targets(human)
    units = load_face_units(human, spec.get("face_units", "caucasian"))
    transfer_face_units(human, face_parts, units)
    ExportService.bake_modifiers_remove_helpers(human, bake_masks=True, bake_subdiv=False, remove_helpers=True)
    shrink_textures()
    if spec.get("skin_tint"):
        tint_skin(human, spec["skin_tint"])
    for obj, label in named:
        if label in ("Hair", "Eyebrows") and spec.get("hair_tint"):
            tint_hair(obj, spec["hair_tint"])

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
    if spec.get("animations", True):
        anim.bake_moves(arm)

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
        export_apply=False, export_yup=True,
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
