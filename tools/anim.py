"""Author body moves and facial expressions as Blender actions, so they export as GLB animation clips.

Poses are described in plain terms: rotate a bone about a world axis (as seen on the character:
X = to the character's left, Y = backwards, Z = up) by some degrees. That keeps the moves readable
and independent of each bone's own axis orientation.
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
P = "mixamorig:"  # Mixamo bone prefix used by MPFB's mixamo rig

# Shorthand for world axes on the character (Blender: -Y is the character's front).
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def rotate_world(arm, bone_name, axis, degrees):
    pb = arm.pose.bones.get(P + bone_name)
    if pb is None:
        return
    head = pb.matrix.to_translation()
    rot = Matrix.Translation(head) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = rot @ pb.matrix
    bpy.context.view_layer.update()


def side(bone, s):
    return bone.replace("{S}", "Left" if s > 0 else "Right")


def wave(t, period, lo=0.0, hi=1.0):
    return lo + (hi - lo) * (0.5 + 0.5 * math.sin(2 * math.pi * t / period))


# --- moves -------------------------------------------------------------------------------
# Each returns a list of (bone, axis, degrees). Arms start from MakeHuman's rest pose (an A-pose),
# so "arms down" is a rotation that brings them to the sides. s = +1 left side, -1 right side.

# Sign conventions (checked against renders): for an arm, rotating about Y by -s*deg RAISES it
# outwards and +s*deg LOWERS it; about X, negative swings it FORWARD. For a forearm, -X bends the
# elbow forward and -s*deg about Y bends it up when the arm is held out sideways. For legs, -X lifts
# the thigh forward and +X bends the knee (shin goes back).

LOCAL = "local"  # marks a rotation about the bone's own axis (used for finger and thumb curls)


def arms_down(extra=0):
    out = []
    for s in (1, -1):
        out.append((side("{S}Arm", s), Y, s * (41 + extra)))
        out.append((side("{S}Arm", s), X, 9))  # rest pose holds the arms slightly forward
        out.append((side("{S}ForeArm", s), X, -7))
    return out


def fist(s, thumb_up=False):
    out = []
    for f in ("Index", "Middle", "Ring", "Pinky"):
        for j in (1, 2, 3):
            out.append((side(f"{{S}}Hand{f}{j}", s), LOCAL, 75 if j == 1 else 85))
    if not thumb_up:
        out.append((side("{S}HandThumb2", s), LOCAL, 40))
        out.append((side("{S}HandThumb3", s), LOCAL, 40))
    return out


def relaxed_hands():
    out = []
    for s in (1, -1):
        for f in ("Index", "Middle", "Ring", "Pinky"):
            for j in (1, 2, 3):
                out.append((side(f"{{S}}Hand{f}{j}", s), LOCAL, 5 + 3 * j))
    return out


def move_idle(t):
    sway = wave(t, 4.0, -1, 1)
    return arms_down() + relaxed_hands() + [
        ("Hips", Y, 1.5 * sway), ("Spine", Y, -1.2 * sway), ("Spine2", X, -3),
        ("Head", Z, 6 * wave(t, 6.0, -1, 1)), ("Neck", X, 3),
    ]


def move_walk(t):
    ph = 2 * math.pi * t / 1.1
    leg = 26 * math.sin(ph)
    out = arms_down() + relaxed_hands()
    out += [("LeftUpLeg", X, -leg), ("RightUpLeg", X, leg),
            ("LeftLeg", X, 40 * max(0, math.cos(ph + 1.2))), ("RightLeg", X, 40 * max(0, -math.cos(ph + 1.2))),
            ("LeftArm", X, 20 * math.sin(ph)), ("RightArm", X, -20 * math.sin(ph)),
            ("Hips", Z, 5 * math.sin(ph)), ("Spine2", Z, -7 * math.sin(ph)), ("Spine2", X, -3)]
    return out


def move_wave(t):
    out = [("LeftArm", Y, 41), ("LeftForeArm", X, -12)] + relaxed_hands()
    out += [("RightArm", Y, 85), ("RightArm", X, -15), ("RightForeArm", Y, 35 + 25 * math.sin(2 * math.pi * t / 0.7)),
            ("Head", Y, 6), ("Head", Z, -8)]
    return out


def move_thumbs(t):
    out = [("LeftArm", Y, 18), ("LeftForeArm", Y, 55), ("LeftForeArm", X, -10)] + fist(1)  # hand on hip
    out += [("RightArm", Y, -30), ("RightArm", X, -60), ("RightForeArm", X, -75)] + fist(-1, thumb_up=True)
    out += [("Head", X, 6 * wave(t, 0.8, -1, 1)), ("Head", Z, -8), ("Spine2", X, -4)]
    return out


def move_flex(t):
    pump = 8 * wave(t, 1.6, -1, 1)
    out = []
    for s in (1, -1):
        out += [(side("{S}Arm", s), Y, -s * 42), (side("{S}ForeArm", s), Y, -s * (105 + pump))] + fist(s)
    return out + [("Spine2", X, -6), ("Head", Z, 12), ("Head", X, -4)]


def move_celebrate(t):
    ph = (t % 1.1) / 1.1
    air = math.sin(min(1, ph / 0.8) * math.pi)
    out = []
    for s in (1, -1):
        out += [(side("{S}Arm", s), Y, -s * 100), (side("{S}ForeArm", s), Y, -s * 15)] + fist(s, thumb_up=True)
    out += [("LeftUpLeg", X, -60 * air), ("LeftLeg", X, 100 * air), ("RightUpLeg", X, 10 * air), ("RightLeg", X, 105 * air),
            ("Spine2", X, -8 * air), ("Head", X, -10 * air)]
    return out


def move_think(t):
    out = [("RightArm", Y, -41), ("RightForeArm", X, -12)] + relaxed_hands()
    out += [("LeftArm", Y, 34), ("LeftArm", X, -50), ("LeftForeArm", X, -135)] + fist(1)
    out += [("Head", Y, -8), ("Head", Z, 10), ("Neck", X, 6)]
    return out

MOVES = {
    "Idle": (move_idle, 12.0), "Walk": (move_walk, 1.1), "Wave": (move_wave, 2.1),
    "Thumbs up": (move_thumbs, 1.6), "Flex": (move_flex, 1.6), "Celebrate": (move_celebrate, 1.1),
    "Think": (move_think, 6.0),
}


def apply_move(arm, rotations):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for bone, axis, deg in rotations:
        if axis is LOCAL:
            continue
        rotate_world(arm, bone, axis, deg)
    for bone, axis, deg in rotations:  # finger curls, about each bone's own X axis
        pb = arm.pose.bones.get(P + bone)
        if axis is LOCAL and pb is not None:
            pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion((1, 0, 0), math.radians(deg))
    # Hips can also rise for jumps
    return arm


def bake_moves(arm, step=2):
    """One action per move, keyed every `step` frames, ready for glTF export as separate clips."""
    actions = []
    for name, (fn, length) in MOVES.items():
        action = bpy.data.actions.new(name)
        arm.animation_data_create()
        arm.animation_data.action = action
        frames = max(2, int(length * FPS))
        for f in range(0, frames + 1, step):
            t = f / FPS
            apply_move(arm, fn(t))
            if name == "Celebrate":
                ph = (t % 1.1) / 1.1
                arm.pose.bones[P + "Hips"].location = (0, 0.32 * math.sin(min(1, ph / 0.8) * math.pi), 0)
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f)
                if pb.name == P + "Hips":
                    pb.keyframe_insert("location", frame=f)
        action.use_fake_user = True
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        arm.animation_data.action = None
        actions.append(action)
    apply_move(arm, [])
    return actions
