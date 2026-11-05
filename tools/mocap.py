"""Turn CMU motion-capture clips (ASF/AMC) into Blender actions on an MPFB Mixamo rig.

The CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu) is free to copy, modify and
redistribute. Each clip is real human movement recorded at 60/120 fps.

Retargeting: the source skeleton is posed with forward kinematics; then, frame by frame,
  - hips, spine, neck and head copy the performer's orientation (relative to standing),
  - arms and legs point each bone in the same direction as the performer's bone
    (so differences in rest pose, A-pose vs T-pose, don't matter),
  - collarbones copy how much the performer's collarbone moved from its rest direction,
  - the hips follow the performer's height (scaled to the character's leg length) and sway,
    with travel across the floor removed so moves play in place.
Each clip is trimmed to a window whose end matches its start, and the last fraction of a second
is blended back to the first frame, so it loops without a jump.
"""

import math
import re

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

UNIT = (1.0 / 0.45) * 2.54 / 100.0  # ASF length units -> metres
FPS = 30
P = "mixamorig:"
# CMU is Y-up, facing +Z; Blender is Z-up and our characters face -Y.
TO_BLENDER = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=float)

ORIENT = {"Hips": "root", "Spine": "lowerback", "Spine1": "upperback", "Spine2": "thorax", "Neck": "lowerneck", "Head": "head"}
DIRECT = {
    "LeftArm": "lhumerus", "LeftForeArm": "lradius", "LeftHand": "lhand",
    "RightArm": "rhumerus", "RightForeArm": "rradius", "RightHand": "rhand",
    "LeftUpLeg": "lfemur", "LeftLeg": "ltibia", "LeftFoot": "lfoot", "LeftToeBase": "ltoes",
    "RightUpLeg": "rfemur", "RightLeg": "rtibia", "RightFoot": "rfoot", "RightToeBase": "rtoes",
}
RELATIVE = {"LeftShoulder": "lclavicle", "RightShoulder": "rclavicle"}  # keep own rest, copy rotation
ORDER = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
         "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
         "RightShoulder", "RightArm", "RightForeArm", "RightHand",
         "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
         "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]


def euler_xyz(rx, ry, rz):
    """Rotation for ASF/AMC angles (degrees): x first, then y, then z, about fixed axes."""
    rx, ry, rz = np.radians([rx, ry, rz])
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


class Skeleton:
    def __init__(self, asf_path):
        text = open(asf_path).read()
        self.bones = {"root": {"dir": np.zeros(3), "len": 0.0, "C": np.eye(3), "dof": ["rx", "ry", "rz"]}}
        for block in re.findall(r"begin(.*?)end", text.split(":bonedata")[1].split(":hierarchy")[0], re.S):
            f = {}
            for line in block.strip().splitlines():
                parts = line.split()
                if parts:
                    f[parts[0]] = parts[1:]
            axis = [float(v) for v in f["axis"][:3]]
            self.bones[f["name"][0]] = {
                "dir": np.array([float(v) for v in f["direction"]]),
                "len": float(f["length"][0]),
                "C": euler_xyz(*axis),
                "dof": f.get("dof", []),
            }
        self.children = {}
        hier = text.split(":hierarchy")[1]
        for line in re.search(r"begin(.*?)end", hier, re.S).group(1).strip().splitlines():
            parent, *kids = line.split()
            self.children[parent] = kids
        self.order = []
        stack = ["root"]
        while stack:
            b = stack.pop(0)
            self.order.append(b)
            stack[0:0] = self.children.get(b, [])
        self.parent = {k: p for p, ks in self.children.items() for k in ks}

    def pose(self, frame):
        """World rotation matrix and start/end points of every bone for one AMC frame."""
        rot, start, end = {}, {}, {}
        for b in self.order:
            info = self.bones[b]
            vals = frame.get(b, [])
            if b == "root":
                pos = np.array(vals[:3]) if vals else np.zeros(3)
                ang = vals[3:6] if vals else [0, 0, 0]
                R = euler_xyz(*ang)
                rot[b], start[b], end[b] = R, pos, pos
                continue
            ang = {"rx": 0.0, "ry": 0.0, "rz": 0.0}
            for name, v in zip(info["dof"], vals):
                ang[name] = v
            C = info["C"]
            M = rot[self.parent[b]] @ C @ euler_xyz(ang["rx"], ang["ry"], ang["rz"]) @ C.T
            rot[b] = M
            start[b] = end[self.parent[b]]
            end[b] = start[b] + info["len"] * (M @ info["dir"])
        return rot, start, end


def read_amc(path):
    frames, cur = [], None
    for line in open(path):
        line = line.strip()
        if not line or line.startswith(("#", ":")):
            continue
        if line.isdigit():
            cur = {}
            frames.append(cur)
        elif cur is not None:
            name, *vals = line.split()
            cur[name] = [float(v) for v in vals]
    return frames


def to_b(v):
    return Vector(TO_BLENDER @ v)


def mat_b(M):
    return Matrix((TO_BLENDER @ M @ TO_BLENDER.T).tolist())


class Clip:
    """Source motion resampled to 30 fps, in Blender coordinates, facing the camera, in place."""

    def __init__(self, asf, amc, src_fps, start=0.0, length=None, inplace="smooth"):
        self.skel = Skeleton(asf)
        raw = read_amc(amc)
        step = src_fps / FPS
        first = int(start * src_fps)
        last = len(raw) - 1 if length is None else min(len(raw) - 1, first + int(length * src_fps))
        idx = [int(round(i)) for i in np.arange(first, last, step)]
        self.poses = [self.skel.pose(raw[i]) for i in idx]
        self.rest = self.skel.pose({})

        # Face the camera. Facing comes from the body itself (hip and shoulder lines), and slow
        # turning is taken out (a moving average over ~1.5 s) while quick turns are kept, so a
        # performer who drifts round to face someone else still faces the viewer.
        yaws = []
        for _, s, e in self.poses:
            across = sum((TO_BLENDER @ (e[a] - e[b]) for a, b in (("lhipjoint", "rhipjoint"), ("lhumerus", "rhumerus"))), np.zeros(3))
            fwd = np.cross(across, [0, 0, 1])  # left-right line x up = facing
            yaws.append(math.atan2(fwd[0], -fwd[1]))
        yaws = np.unwrap(np.array(yaws))
        k = max(1, int(FPS * 1.5))
        slow = np.convolve(np.pad(yaws, (k // 2, k - 1 - k // 2), mode="edge"), np.ones(k) / k, "valid")
        self.turns = [Matrix.Rotation(-y, 3, "Z") for y in slow]
        self.turn = self.turns[0]

        roots = np.array([TO_BLENDER @ s["root"] for _, s, _ in self.poses]) * UNIT
        if inplace == "smooth":  # keep sway, drop travel
            k = max(1, int(FPS * 1.0))
            kernel = np.ones(k) / k
            trend = np.stack([np.convolve(np.pad(roots[:, i], (k // 2, k - 1 - k // 2), mode="edge"), kernel, "valid") for i in (0, 1)], 1)
            roots[:, :2] -= trend
        else:  # "fixed": only remove the starting offset
            roots[:, :2] -= roots[0, :2]
        self.roots = [t @ Vector(r) for t, r in zip(self.turns, roots)]

        _, rs, re_ = self.rest
        lowest = min((TO_BLENDER @ re_[b])[2] for b in ("ltoes", "rtoes", "lfoot", "rfoot"))
        self.leg = (0 - lowest) * UNIT  # standing hip height of the performer, metres

    def __len__(self):
        return len(self.poses)

    def trim(self, a, b):
        self.poses = self.poses[a:b + 1]
        self.roots = self.roots[a:b + 1]
        self.turns = self.turns[a:b + 1]
        return self

    def orient(self, i, bone):
        return self.turns[i] @ mat_b(self.poses[i][0][bone])

    def direction(self, i, bone):
        _, s, e = self.poses[i]
        return (self.turns[i] @ to_b(e[bone] - s[bone])).normalized()

    def rest_direction(self, bone):
        _, s, e = self.rest
        return to_b(e[bone] - s[bone]).normalized()


def fit(clip, hips_rest):
    """Scale from performer to character (leg length) and the performer's standing hip height."""
    heights = sorted(r.z for r in clip.roots)
    standing = heights[int(0.9 * (len(heights) - 1))]
    ratio = hips_rest.z / clip.leg if clip.leg > 0 else 1.0
    return ratio, standing


def source_points(clip, i, hips_rest):
    """Where the performer's joints are at frame i, scaled and placed like the character's hips."""
    ratio, standing = fit(clip, hips_rest)
    _, s, e = clip.poses[i]
    r = clip.roots[i]
    base = Vector((hips_rest.x + r.x * ratio, hips_rest.y + r.y * ratio, hips_rest.z + (r.z - standing) * ratio))
    pts = {"root": base}
    for b, p in e.items():
        if b != "root":
            pts[b] = base + (clip.turns[i] @ to_b(p - s["root"])) * UNIT * ratio
    return pts


def _rotate_bone_to(arm, pb, desired):
    """Swing a pose bone about its head so it points along `desired` (armature space)."""
    m = pb.matrix.copy()
    cur = Vector(m.col[1][:3]).normalized()
    q = cur.rotation_difference(desired)
    head = m.to_translation()
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m


def retarget(arm, clip, name, finger_pose=None, blend=0.4):
    """Bake `clip` onto `arm` as a new action called `name`.

    1. Put the character in the performer's rest pose (T-pose): every limb bone is pointed the way
       the performer's bone points at rest. Spine, neck, head and collarbones keep their own rest.
    2. Each frame, every bone takes the performer's rotation-from-rest on top of that matched rest,
       so direction AND twist (palms, feet, head turns) carry over.
    """
    bones = {n: arm.pose.bones.get(P + n) for n in ORDER}
    bones = {n: b for n, b in bones.items() if b is not None}
    source = {**ORIENT, **DIRECT, **RELATIVE}

    def reset():
        for pb in arm.pose.bones:
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        bpy.context.view_layer.update()

    reset()
    hips_rest = bones["Hips"].matrix.to_translation().copy()
    feet = [(bones[s + "Foot"], bones[s + "ToeBase"]) for s in ("Left", "Right") if s + "Foot" in bones and s + "ToeBase" in bones]
    rest_contact = [(f.head.z, t.tail.z) for f, t in feet]  # ankle and toe-tip heights when standing
    for n in ORDER:
        if n in DIRECT and n in bones:
            _rotate_bone_to(arm, bones[n], clip.rest_direction(DIRECT[n]))
            bpy.context.view_layer.update()
    matched = {n: b.matrix.to_3x3().copy() for n, b in bones.items()}
    reset()

    # hip height: performer's standing height maps to the character's standing height
    ratio, standing = fit(clip, hips_rest)
    print("[mocap]", name, f"{len(clip)} frames, leg ratio {ratio:.2f}", flush=True)

    frames = []
    for i in range(len(clip)):
        reset()
        for n in ORDER:
            pb = bones.get(n)
            if pb is None:
                continue
            rot = clip.orient(i, source[n]) @ matched[n]
            loc = pb.matrix.to_translation()
            if n == "Hips":
                r = clip.roots[i]
                loc = Vector((hips_rest.x + r.x * ratio, hips_rest.y + r.y * ratio, hips_rest.z + (r.z - standing) * ratio))
            pb.matrix = Matrix.Translation(loc) @ rot.to_4x4()
            bpy.context.view_layer.update()
        # grounding: keep the lowest heel or toe on the floor (no floating, no sinking)
        if feet:
            drop = min(min(f.head.z - a, t.tail.z - b) for (f, t), (a, b) in zip(feet, rest_contact))
            if abs(drop) < 0.25:
                hb = bones["Hips"]
                hb.matrix = Matrix.Translation((0, 0, -drop)) @ hb.matrix
                bpy.context.view_layer.update()
        if finger_pose:
            for bone_name, _axis, deg in finger_pose:
                fb = arm.pose.bones.get(P + bone_name)
                if fb is not None:
                    fb.rotation_quaternion = fb.rotation_quaternion @ Quaternion((1, 0, 0), math.radians(deg))
        frames.append({pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones})

    smooth(frames)

    # loop: ease the last `blend` seconds back into the first frame
    k = min(len(frames) - 1, int(blend * FPS))
    for j in range(k):
        f = len(frames) - k + j
        w = (j + 1) / k
        w = w * w * (3 - 2 * w)
        for bn, (q, loc) in frames[f].items():
            q0, l0 = frames[0][bn]
            frames[f][bn] = (q.slerp(q0, w), loc.lerp(l0, w))

    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    for fi, pose in enumerate(frames):
        for pb in arm.pose.bones:
            q, loc = pose[pb.name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert("rotation_quaternion", frame=fi)
            if pb.name == P + "Hips":
                pb.keyframe_insert("location", frame=fi)
    action.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    arm.animation_data.action = None
    reset()
    return action

def smooth(frames, sigma=1.2):
    """Gentle Gaussian filter over time on every bone's rotation and the hip position.

    Raw capture data carries marker jitter; real people don't vibrate."""
    radius = int(3 * sigma)
    weights = [math.exp(-(d * d) / (2 * sigma * sigma)) for d in range(-radius, radius + 1)]
    n = len(frames)
    if n < 3:
        return
    names = list(frames[0])
    out = []
    for i in range(n):
        pose = {}
        for bn in names:
            q0 = frames[i][bn][0]
            acc = np.zeros(4)
            loc = Vector((0, 0, 0))
            total = 0.0
            for w, d in zip(weights, range(-radius, radius + 1)):
                j = min(n - 1, max(0, i + d))
                q, l = frames[j][bn]
                v = np.array(q)
                if np.dot(v, np.array(q0)) < 0:  # same hemisphere so averaging works
                    v = -v
                acc += w * v
                loc += l * w
                total += w
            q = Quaternion(acc / np.linalg.norm(acc))
            pose[bn] = (q, loc / total)
        out.append(pose)
    frames[:] = out


def best_loop(clip, min_len, max_len):
    """Pick the window (start, end) whose last pose best matches its first, for clean looping."""
    feats = []
    for rot, s, e in clip.poses:
        f = []
        for b in ("lhumerus", "lradius", "rhumerus", "rradius", "lfemur", "ltibia", "rfemur", "rtibia", "thorax", "head"):
            f.extend((TO_BLENDER @ (e[b] - s[b])) / (np.linalg.norm(e[b] - s[b]) + 1e-9))
        feats.append(np.array(f))
    feats = np.array(feats)
    best, pair = 1e9, (0, len(feats) - 1)
    a_max = max(1, len(feats) - min_len)
    for a in range(0, a_max, 3):
        for b in range(a + min_len, min(len(feats), a + max_len), 2):
            d = np.linalg.norm(feats[a] - feats[b])
            if d < best:
                best, pair = d, (a, b)
    return pair
