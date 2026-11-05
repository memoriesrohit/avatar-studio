"""Convert a Microsoft Rocketbox avatar (MIT licence) into an Avatar Studio GLB.

blender -b -P rb_build.py -- <avatar dir> <out.glb> [preview.png]
(build_all.sh builds every character in the app.)

<avatar dir> is a Rocketbox avatar folder (Export/<name>_facial.fbx and Textures/).
Steps: import the facial FBX, scale to metres and face -Y, rename the 3ds Max Biped skeleton to
Mixamo names (so the CMU mocap retarget and the web app work unchanged), rebuild the materials
(colour, normal map, roughness from the specular map, alpha for hair/lashes), split the mesh into
Body / Clothes / Hair, keep the 52 ARKit face shapes (renamed to ARKit's own names) plus combined
eye-look shapes, retarget the mocap moves, and export a GLB.
"""
import glob
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(os.path.dirname(HERE), "makehuman")  # CMU mocap tools (only used with RB_CMU=1)
sys.path.insert(0, WORK)
import anim  # noqa: E402
import mocap  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]
PREVIEW = args[2] if len(args) > 2 else None
NAME = os.path.basename(os.path.normpath(SRC))
P = mocap.P


def log(*a):
    print("[rb]", *a, flush=True)


BONES = {
    "Bip01 Pelvis": "Hips", "Bip01 Spine": "Spine", "Bip01 Spine1": "Spine1", "Bip01 Spine2": "Spine2",
    "Bip01 Neck": "Neck", "Bip01 Head": "Head", "Bip01 LEye": "LeftEye", "Bip01 REye": "RightEye",
}
for s, side in (("L", "Left"), ("R", "Right")):
    BONES.update({
        f"Bip01 {s} Clavicle": f"{side}Shoulder", f"Bip01 {s} UpperArm": f"{side}Arm",
        f"Bip01 {s} Forearm": f"{side}ForeArm", f"Bip01 {s} Hand": f"{side}Hand",
        f"Bip01 {s} Thigh": f"{side}UpLeg", f"Bip01 {s} Calf": f"{side}Leg",
        f"Bip01 {s} Foot": f"{side}Foot", f"Bip01 {s} Toe0": f"{side}ToeBase",
    })
    for i, finger in enumerate(("Thumb", "Index", "Middle", "Ring", "Pinky")):
        BONES[f"Bip01 {s} Finger{i}"] = f"{side}Hand{finger}1"
        BONES[f"Bip01 {s} Finger{i}1"] = f"{side}Hand{finger}2"
        BONES[f"Bip01 {s} Finger{i}2"] = f"{side}Hand{finger}3"


def import_avatar():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fbx = glob.glob(os.path.join(SRC, "Export", "*_facial.fbx")) or glob.glob(os.path.join(SRC, "Export", "*.fbx"))
    # native Biped bone axes (no automatic re-orientation): identical to the animation files' rig,
    # so animations transfer by copying orientations directly
    bpy.ops.import_scene.fbx(filepath=fbx[0], automatic_bone_orientation=False)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    # the FBX carries a "Take 001" action that keys the rig at its original centimetre scale; drop it
    for o in (arm, mesh):
        if o.animation_data:
            o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)

    def settle():
        """Apply the armature's transform (FBX centimetres -> metres), then bake the mesh's resulting
        world transform into its vertices and shape keys, so both sit at identity in metres."""
        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        world = mesh.matrix_world.copy()
        mesh.data.transform(world, shape_keys=True)
        mesh.matrix_parent_inverse = Matrix.Identity(4)
        mesh.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()

    settle()
    # face -Y like the mocap retarget expects: the nose bone is in front of the head bone
    nose, head = arm.data.bones["Bip01 MNose"].head_local, arm.data.bones["Bip01 Head"].head_local
    if nose.y > head.y:
        arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
        settle()
    zs = [v.co.z for v in mesh.data.vertices]
    log("height", round(max(zs) - min(zs), 3), "m")
    for b in arm.data.bones:
        if b.name in BONES:
            b.name = P + BONES[b.name]
    log("imported", os.path.basename(fbx[0]), len(mesh.data.vertices), "verts", len(arm.data.bones), "bones")
    return arm, mesh


def load(path, colorspace="sRGB"):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def roughness_from_specular(spec_path):
    """Rocketbox ships a specular (shininess) map; glTF wants roughness. Shiny -> smooth."""
    spec = load(spec_path, "Non-Color")
    w, h = spec.size
    px = np.empty(w * h * 4, np.float32)
    spec.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    g = px[:, :3].mean(1)
    rough = np.clip(0.92 - 0.75 * g, 0.3, 0.95)
    out = np.stack([rough, rough, rough, np.ones_like(rough)], 1)
    img = bpy.data.images.new(os.path.basename(spec_path).replace("specular", "rough"), w, h)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(out.ravel())
    img.pack()
    return img


def rebuild_materials(mesh):
    tex = os.path.join(SRC, "Textures")
    for slot in mesh.material_slots:
        mat = slot.material
        part = mat.name.split("_")[-1]  # body / head / opacity
        prefix = mat.name.rsplit("_", 1)[0]
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        color = nt.nodes.new("ShaderNodeTexImage")
        color.image = load(os.path.join(tex, f"{prefix}_{part}_color.tga"))
        nt.links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
        if part == "opacity":
            nt.links.new(color.outputs["Alpha"], bsdf.inputs["Alpha"])
            bsdf.inputs["Roughness"].default_value = 0.6
            mat.surface_render_method = "DITHERED"
            continue
        normal_path = os.path.join(tex, f"{prefix}_{part}_normal.tga")
        if os.path.exists(normal_path):
            nimg = nt.nodes.new("ShaderNodeTexImage")
            nimg.image = load(normal_path, "Non-Color")
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(nimg.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        spec_path = os.path.join(tex, f"{prefix}_{part}_specular.tga")
        if os.path.exists(spec_path):
            r = nt.nodes.new("ShaderNodeTexImage")
            r.image = roughness_from_specular(spec_path)
            nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = 0.0
        log("material", mat.name)


ARKIT_EYES = {
    "eyes-look-left": ("AK_15_EyeLookOutLeft", "AK_14_EyeLookInRight"),
    "eyes-look-right": ("AK_13_EyeLookInLeft", "AK_16_EyeLookOutRight"),
    "eyes-look-up": ("AK_17_EyeLookUpLeft", "AK_18_EyeLookUpRight"),
    "eyes-look-down": ("AK_11_EyeLookDownLeft", "AK_12_EyeLookDownRight"),
}


def face_shapes(obj):
    """Keep ARKit shapes (renamed to ARKit names, e.g. mouthSmileLeft) and add combined eye-look keys."""
    keys = obj.data.shape_keys
    if not keys:
        return
    kb = keys.key_blocks
    # (Rocketbox's ARKit eye-look shapes roll the eyes white when combined; the app aims the eye
    # bones instead, so no combined eye-look keys are made)
    for name, (a, b) in ({} if True else ARKIT_EYES).items():
        if a in kb and b in kb:
            for k in kb:
                k.value = 0.0
            kb[a].value = kb[b].value = 1.0
            new = obj.shape_key_add(name=name, from_mix=True)
            new.value = 0.0
            kb[a].value = kb[b].value = 0.0
    for k in list(kb)[1:]:
        if k.name.startswith("AK_"):
            n = k.name.split("_", 2)[2]
            k.name = n[0].lower() + n[1:]
        else:
            obj.shape_key_remove(k)
    obj.active_shape_key_index = 0
    log("shapes", obj.name, len(obj.data.shape_keys.key_blocks) - 1)


def split_parts(mesh):
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = {}
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        part = o.material_slots[0].material.name.split("_")[-1]
        o.name = {"head": "Body", "body": "Clothes_outfit", "opacity": "Hair"}[part]
        parts[o.name] = o
    # the hands share the outfit's texture: split them off as skin so outfit recolouring skips them
    clothes = parts["Clothes_outfit"]
    hand_groups = {g.index for g in clothes.vertex_groups if "Hand" in g.name or "Finger" in g.name}
    def top_group(v):
        return max(v.groups, key=lambda g: g.weight).group if v.groups else None
    hand_verts = {v.index for v in clothes.data.vertices if top_group(v) in hand_groups}
    for poly in clothes.data.polygons:
        poly.select = all(i in hand_verts for i in poly.vertices)
    bpy.ops.object.select_all(action="DESELECT")
    clothes.select_set(True)
    bpy.context.view_layer.objects.active = clothes
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    for poly in clothes.data.polygons:
        poly.select = all(i in hand_verts for i in poly.vertices)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    hands = next(o for o in bpy.context.selected_objects if o is not clothes)
    hands.name = "Body_hands"
    parts["Body_hands"] = hands
    log("hands split", len(hands.data.vertices), "verts")
    return parts


def bake_moves(arm):
    moves = json.load(open(os.path.join(WORK, "moves.json"), encoding="utf-8-sig"))
    only = [m for m in os.environ.get("AVATAR_MOVES", "").split(",") if m]
    for m in moves:
        if only and m["name"] not in only:
            continue
        subject = m["clip"].split("_")[0].lstrip("0")
        clip = mocap.Clip(os.path.join(WORK, "mocap", f"{subject}.asf"), os.path.join(WORK, "mocap", f"{m['clip']}.amc"),
                          m["fps"], m.get("start", 0), m.get("length"), m.get("inplace", "fixed"))
        if m.get("loop"):
            a, b = mocap.best_loop(clip, int(m["loop"][0] * mocap.FPS), int(m["loop"][1] * mocap.FPS))
            clip.trim(a, b)
        mocap.retarget(arm, clip, m["name"], finger_pose=anim.relaxed_hands(), stance=m.get("stance"),
                       keep_rest=("LeftFoot", "RightFoot"))
        log("move", m["name"], f"{len(clip) / mocap.FPS:.1f}s")


# Rocketbox's own motion capture, made for this skeleton (root motion already removed)
NATIVE_MOVES = [  # (move, male clip, female clip)
    ("Idle", "m_idle_neutral_01", "f_idle_neutral_01"), ("Walk", "m_walk_neutral_01", "f_walk_neutral_01"),
    ("Wave", "m_wave_01", "f_wave_01"), ("Talk", "m_gestic_talk_neutral_01", "f_gestic_talk_neutral_01"),
    ("Confident", "m_gestic_talk_self_assured_01", "f_gestic_talk_self-assured_01"),
    ("Argue", "m_gestic_talk_angry_01", "f_gestic_talk_angry_01"), ("Cheer", "m_cheer_01", "f_cheer_01"),
    ("Laugh", "m_gestic_laugh_loud", "f_gestic_laugh_loud"), ("Drink", "m_drink_drinking", "f_drink_drinking"),
    ("Clap", "m_claphands_01", "f_claphands_01"), ("Think", "m_gestic_thoughtful_01", "f_gestic_thoughtful_01"),
    ("Shrug", "m_gestic_shrug_01", "f_gestic_shrug_01"), ("Phone", "m_cell_phone_talk_01", "f_cell_phone_talk_01"),
]
ANIM_DIR = os.environ.get("RB_ANIMS", os.path.join(HERE, "rocketbox", "anims"))
BACK = {v: k for k, v in BONES.items()}  # Mixamo name -> original Biped name


def bake_native(arm):
    """Transfer each Rocketbox animation (same Biped skeleton) onto our rig and bake it as a move.

    Both are imported with their native Biped bone axes, so per frame each of our bones takes the
    source bone's world orientation (turned to our facing) and keeps its own length; the hips also
    take the source's translation from rest. Independent of the files' units and of their
    reference poses. Computed with matrices only: each bone's pose follows from its parent's.
    """
    scene = bpy.context.scene
    only = [m for m in os.environ.get("AVATAR_MOVES", "").split(",") if m]
    bones = sorted(arm.data.bones, key=lambda b: len(b.parent_recursive))
    our_rest = {b.name: b.matrix_local.copy() for b in bones}
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    female = os.path.basename(glob.glob(os.path.join(SRC, "Textures", "*_head_color.tga"))[0]).startswith("f")
    for move, male_clip, female_clip in NATIVE_MOVES:
        clip = female_clip if female else male_clip
        if only and move not in only:
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=os.path.join(ANIM_DIR, clip + ".fbx"), automatic_bone_orientation=False)
        new = [o for o in bpy.data.objects if o not in before]
        src = next(o for o in new if o.type == "ARMATURE")
        act = src.animation_data.action
        start, end = (int(round(v)) for v in act.frame_range)
        sw = src.matrix_world.copy()
        smap = {}
        for b in bones:
            name = b.name[len(P):] if b.name.startswith(P) else b.name
            sname = BACK.get(name, b.name)
            if sname in src.data.bones:
                smap[b.name] = sname
        src_rest = {sn: (sw @ src.data.bones[sn].matrix_local) for sn in smap.values()}
        hips = P + "Hips"
        facing = our_rest[hips].to_quaternion() @ src_rest[smap[hips]].to_quaternion().inverted()
        hips_rest_src = src_rest[smap[hips]].to_translation()
        frames = []
        for f in range(start, end + 1):
            scene.frame_set(f)
            ev = src.evaluated_get(bpy.context.evaluated_depsgraph_get())  # the animated copy
            pose, basis = {}, {}
            for b in bones:
                rest = our_rest[b.name]
                parent_pose = pose[b.parent.name] if b.parent else Matrix.Identity(4)
                rel = (our_rest[b.parent.name].inverted() @ rest) if b.parent else rest
                base = parent_pose @ rel
                sn = smap.get(b.name)
                if sn:
                    # same skeleton, same bone axes: take the source bone's orientation as is,
                    # turned to our facing
                    sworld = ev.matrix_world @ ev.pose.bones[sn].matrix
                    rot = facing @ sworld.to_quaternion()
                    loc = base.to_translation()
                    if b.name == hips:
                        loc = rest.to_translation() + facing @ (sworld.to_translation() - hips_rest_src)
                    pose[b.name] = Matrix.Translation(loc) @ rot.to_matrix().to_4x4()
                else:
                    pose[b.name] = base
                basis[b.name] = rel.inverted() @ parent_pose.inverted() @ pose[b.name]
            if os.environ.get("RB_DEBUG") and f == start + 40:
                n = P + "RightArm"
                d = (ev.matrix_world @ ev.pose.bones[smap[n]].matrix).to_quaternion() @ src_rest[smap[n]].to_quaternion().inverted()
                log("debug", move, f, "delta deg", round(math.degrees(d.angle), 1), "basis deg", round(math.degrees(basis[n].to_quaternion().angle), 1),
                    "ev basis", [round(v, 2) for v in ev.pose.bones[smap[n]].matrix_basis.to_quaternion()])
            frames.append(basis)
        action = bpy.data.actions.new(move)
        arm.animation_data_create()
        arm.animation_data.action = action
        for fi, basis in enumerate(frames):
            for pb in arm.pose.bones:
                m = basis[pb.name]
                pb.rotation_quaternion = m.to_quaternion()
                pb.keyframe_insert("rotation_quaternion", frame=fi)
                if pb.name == hips:
                    pb.location = m.to_translation()
                    pb.keyframe_insert("location", frame=fi)
        action.use_fake_user = True
        track = arm.animation_data.nla_tracks.new()
        track.name = move
        track.strips.new(move, 0, action)
        arm.animation_data.action = None
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        log("move", move, clip, f"{len(frames) / scene.render.fps:.1f}s", "mapped", len(smap))


def render_preview(path, arm):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 900, 1200
    scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.35, 0.38, 1)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = (0.0, -4.2, 1.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), math.radians(15), math.radians(20))
    scene.collection.objects.link(sun)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("preview", path)


def main():
    arm, mesh = import_avatar()
    rebuild_materials(mesh)
    parts = split_parts(mesh)
    for o in parts.values():
        face_shapes(o)
    arm.name = "Rig"
    if not os.environ.get("AVATAR_NOANIM"):
        if os.environ.get("RB_CMU"):
            bake_moves(arm)  # CMU mocap, retargeted
        else:
            bake_native(arm)
    if PREVIEW:
        if arm.animation_data:
            for t in arm.animation_data.nla_tracks:
                t.mute = True
            idle = arm.animation_data.nla_tracks.get("Idle")
            if idle:
                idle.mute = False
                bpy.context.scene.frame_set(30)
        render_preview(PREVIEW, arm)
        if arm.animation_data:
            for t in arm.animation_data.nla_tracks:
                t.mute = False
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB", use_selection=False, export_morph=True, export_morph_normal=False,
        export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_image_format="WEBP", export_image_quality=85, export_optimize_animation_size=True, export_frame_step=2,
        export_apply=True, export_yup=True,
    )
    log("EXPORTED", OUT, round(os.path.getsize(OUT) / 1e6, 2), "MB")


main()
