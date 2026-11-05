"""Render a smiling head-and-shoulders thumbnail for each person from their exported GLB.

Run: blender -b -P thumbs.py -- <models dir> <out dir> person1 person2 ...
Rendering the GLB (not the build scene) shows exactly what the browser gets.
"""
import glob
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
models, out_dir, people = argv[0], argv[1], argv[2:]
faces = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "expressions.json")))
os.makedirs(out_dir, exist_ok=True)

for pid in people:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # the first outfit the person has (formal if there is one)
    files = sorted(glob.glob(os.path.join(models, f"{pid}_*.glb")), key=lambda f: not f.endswith("_formal.glb"))
    bpy.ops.import_scene.gltf(filepath=files[0])
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == "ARMATURE")
    idle = bpy.data.actions.get("Idle")
    if idle:
        arm.animation_data_create()
        arm.animation_data.action = idle
        scene.frame_set(1)
    for o in scene.objects:
        if o.type == "MESH" and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = faces["Smile"].get(k.name, 0.0)
        if o.type == "MESH":
            strands = o.name.startswith(("Hair", "Eyebrows", "Eyelashes", "Eyes"))
            for slot in o.material_slots:
                m = slot.material
                if not m:
                    continue
                m.surface_render_method = "DITHERED"
                bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf and not strands:  # same as the web app: skin and clothes are solid
                    for link in list(bsdf.inputs["Alpha"].links):
                        m.node_tree.links.remove(link)
                    bsdf.inputs["Alpha"].default_value = 1.0
                if bsdf and o.name.startswith("Clothes"):  # same as the web app: fabric is matte
                    for socket in ("Roughness", "Metallic"):
                        for link in list(bsdf.inputs[socket].links):
                            m.node_tree.links.remove(link)
                    bsdf.inputs["Roughness"].default_value = 0.8
                    bsdf.inputs["Metallic"].default_value = 0.0
    head = arm.pose.bones.get("mixamorig:Head")
    z = (arm.matrix_world @ head.head).z if head else 1.6
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0.0, -1.45, z - 0.05)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.lens = 72
    for loc, energy in (((1.5, -2.5, 2.5), 500), ((-2.5, -1.5, 1.8), 220), ((0, 2.5, 2.5), 300)):
        light = bpy.data.objects.new("l", bpy.data.lights.new("l", "AREA"))
        light.data.energy, light.data.size = energy, 2.5
        light.location = loc
        light.rotation_euler = (Vector((0, 0, z)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(light)
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.09, 0.085, 0.13)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 85
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = os.path.join(out_dir, f"{pid}.jpg")
    bpy.ops.render.render(write_still=True)
    print("[thumb]", pid, flush=True)
