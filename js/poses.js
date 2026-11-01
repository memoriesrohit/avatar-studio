// Poses and moves. Each pose is a function of time that returns joint angles; the stage eases
// the rig towards them every frame, and the exporter samples them into animation clips.
//
// Conventions: arm angles are "outwards" for both sides, elbows bend forward with negative x,
// knees bend backward with positive x, `curl` closes the fingers (0 open, 1.6 fist) and
// `thumb` is the thumb angle (0.9 resting, 0 = thumbs up).

import * as THREE from 'three';

// [id, label, loop length in seconds]
export const POSES = [
  ['idle', 'Idle', 4 * Math.PI],
  ['walk', 'Walk', 1.2],
  ['wave', 'Wave', (2 * Math.PI) / 9 * 4],
  ['thumbs', 'Thumbs up', 2 * Math.PI / 2.5],
  ['flex', 'Flex', 2 * Math.PI / 3],
  ['celebrate', 'Celebrate', 1 / 0.9],
  ['dance', 'Dance', (2 * Math.PI) / 2.5],
  ['think', 'Think', 4 * Math.PI],
];

const fist = (p, side) => {
  p['curl' + side] = 1.6;
  p['thumb' + side] = 0;
};

export function poseAt(pose, t) {
  const sway = 0.02 * Math.sin(t * 1.4);
  const p = {
    armL: 0.07 + sway, armR: 0.07 + sway, armLx: 0, armRx: 0,
    elbowL: -0.15, elbowR: -0.15, elbowLz: 0, elbowRz: 0,
    curlL: 0.3, curlR: 0.3, thumbL: 0.9, thumbR: 0.9,
    legL: 0, legR: 0, kneeL: 0, kneeR: 0,
    hipY: 0.92, hipX: 0, hipTurn: 0, hipTilt: 0, chest: 0,
    headY: 0.15 * Math.sin(t * 0.5), headX: 0, headZ: 0.02 * Math.sin(t * 0.8),
  };

  if (pose === 'idle') {
    // weight on one leg, chest up
    p.hipX = 0.012 * Math.sin(t * 0.5);
    p.hipTilt = 0.03 * Math.sin(t * 0.5);
    p.kneeL = 0.06 + 0.06 * Math.sin(t * 0.5);
    p.chest = -0.03;
  } else if (pose === 'walk') {
    const w = (t / 1.2) * Math.PI * 2;
    p.legL = 0.45 * Math.sin(w);
    p.legR = -0.45 * Math.sin(w);
    p.kneeL = 0.15 + 0.5 * Math.max(0, -Math.cos(w));
    p.kneeR = 0.15 + 0.5 * Math.max(0, Math.cos(w));
    p.armLx = -0.4 * Math.sin(w);
    p.armRx = 0.4 * Math.sin(w);
    p.elbowL = p.elbowR = -0.35;
    p.hipY = 0.92 - 0.02 * Math.abs(Math.cos(w));
    p.hipTurn = 0.08 * Math.sin(w);
    p.chest = -0.04;
    p.headY = -0.06 * Math.sin(w);
    p.curlL = p.curlR = 0.7;
  } else if (pose === 'wave') {
    p.armR = 2.5;
    p.elbowR = 0;
    p.elbowRz = -(0.5 + 0.4 * Math.sin(t * 9));
    p.curlR = 0.05;
    p.thumbR = 0.5;
    p.headZ = -0.08;
    p.headY = 0.1;
  } else if (pose === 'thumbs') {
    // right arm forward with a thumbs up, left hand on the hip
    p.armR = 0.2;
    p.armRx = -0.9;
    p.elbowR = -1.25;
    fist(p, 'R');
    p.armL = 0.55;
    p.elbowL = -0.4;
    p.elbowLz = -1.5;
    p.curlL = 1.2;
    p.headY = 0.12;
    p.headX = 0.06 * Math.sin(t * 2.5); // nod
    p.headZ = -0.06;
    p.chest = -0.05;
  } else if (pose === 'flex') {
    // double biceps
    const pump = 0.12 * Math.sin(t * 3);
    p.armL = p.armR = 1.45;
    p.elbowLz = 1.85 + pump;
    p.elbowRz = -(1.85 + pump);
    fist(p, 'L');
    fist(p, 'R');
    p.thumbL = p.thumbR = 0.9;
    p.chest = -0.08;
    p.legL = -0.05;
    p.legR = 0.05;
    p.hipX = 0;
    p.headX = -0.05;
    p.headY = 0.25;
  } else if (pose === 'celebrate') {
    // jump with both thumbs up, knees tucked
    const ph = (t * 0.9) % 1;
    const air = Math.sin(Math.min(1, ph / 0.85) * Math.PI);
    const land = ph > 0.85 ? Math.sin(((ph - 0.85) / 0.15) * Math.PI) : 0;
    p.hipY = 0.92 + air * 0.32 - land * 0.1;
    p.armL = p.armR = 2.55;
    p.elbowLz = p.elbowRz = 0;
    p.elbowL = p.elbowR = -0.35;
    fist(p, 'L');
    fist(p, 'R');
    p.legL = -0.9 * air - 0.4 * land;
    p.kneeL = 1.4 * air + 0.8 * land;
    p.legR = 0.25 * air - 0.4 * land;
    p.kneeR = 1.5 * air + 0.8 * land;
    p.chest = -0.1 * air;
    p.headX = -0.18 * air;
    p.headZ = 0.06;
  } else if (pose === 'dance') {
    const b = t * 5;
    p.armL = 0.9 + 0.5 * Math.sin(b);
    p.armR = 0.9 + 0.5 * Math.sin(b + Math.PI);
    p.elbowL = p.elbowR = -1.3;
    p.curlL = p.curlR = 1.0;
    p.legL = -0.25 * Math.max(0, Math.sin(b));
    p.legR = -0.25 * Math.max(0, -Math.sin(b));
    p.kneeL = 0.5 * Math.max(0, Math.sin(b));
    p.kneeR = 0.5 * Math.max(0, -Math.sin(b));
    p.hipY = 0.92 - 0.03 * Math.abs(Math.sin(b));
    p.hipTurn = 0.3 * Math.sin(t * 2.5);
    p.headX = 0.1 * Math.sin(b * 2);
    p.headZ = 0.08 * Math.sin(b);
  } else if (pose === 'think') {
    p.armR = 0.15;
    p.armRx = -0.55;
    p.elbowR = -2.35;
    p.curlR = 1.2;
    p.armL = 0.25;
    p.armLx = -0.35;
    p.elbowL = -1.6; // supporting arm across the body
    p.headZ = 0.12;
    p.headY = -0.2;
    p.headX = -0.08;
  }
  return p;
}

/** Move the rig towards pose `p`. k = 1 jumps straight there. */
export function applyPose(r, p, k = 1) {
  const to = (obj, prop, axis, value) => (obj[prop][axis] += (value - obj[prop][axis]) * k);
  to(r.armL, 'rotation', 'z', p.armL);
  to(r.armR, 'rotation', 'z', -p.armR);
  to(r.armL, 'rotation', 'x', p.armLx);
  to(r.armR, 'rotation', 'x', p.armRx);
  to(r.elbowL, 'rotation', 'x', p.elbowL);
  to(r.elbowR, 'rotation', 'x', p.elbowR);
  to(r.elbowL, 'rotation', 'z', p.elbowLz);
  to(r.elbowR, 'rotation', 'z', p.elbowRz);
  to(r.fingersL, 'rotation', 'z', -p.curlL);
  to(r.fingersR, 'rotation', 'z', p.curlR);
  to(r.thumbL, 'rotation', 'x', p.thumbL);
  to(r.thumbR, 'rotation', 'x', p.thumbR);
  to(r.legL, 'rotation', 'x', p.legL);
  to(r.legR, 'rotation', 'x', p.legR);
  to(r.kneeL, 'rotation', 'x', p.kneeL);
  to(r.kneeR, 'rotation', 'x', p.kneeR);
  to(r.hips, 'position', 'y', p.hipY);
  to(r.hips, 'position', 'x', p.hipX);
  to(r.hips, 'rotation', 'y', p.hipTurn);
  to(r.hips, 'rotation', 'z', p.hipTilt);
  to(r.chest, 'rotation', 'x', p.chest);
  to(r.head, 'rotation', 'y', p.headY);
  to(r.head, 'rotation', 'x', p.headX);
  to(r.head, 'rotation', 'z', p.headZ);
}

export const JOINTS = ['hips', 'chest', 'head', 'armL', 'armR', 'elbowL', 'elbowR', 'fingersL', 'fingersR', 'thumbL', 'thumbR', 'legL', 'legR', 'kneeL', 'kneeR'];

/** Sample every pose into keyframed animation clips (for GLB/glTF export). */
export function bakeClips(rig, fps = 30) {
  const saved = JOINTS.map((j) => [rig[j].position.clone(), rig[j].quaternion.clone()]);
  const clips = POSES.map(([id, label, length]) => {
    const frames = Math.max(2, Math.round(length * fps) + 1);
    const times = [];
    const quats = Object.fromEntries(JOINTS.map((j) => [j, []]));
    const hipPos = [];
    for (let i = 0; i < frames; i++) {
      const t = (i / (frames - 1)) * length;
      times.push(t);
      applyPose(rig, poseAt(id, t), 1);
      for (const j of JOINTS) quats[j].push(...rig[j].quaternion.toArray());
      hipPos.push(...rig.hips.position.toArray());
    }
    const tracks = JOINTS.map((j) => new THREE.QuaternionKeyframeTrack(`${rig[j].name}.quaternion`, times, quats[j]));
    tracks.push(new THREE.VectorKeyframeTrack(`${rig.hips.name}.position`, times, hipPos));
    return new THREE.AnimationClip(label, length, tracks);
  });
  JOINTS.forEach((j, i) => {
    rig[j].position.copy(saved[i][0]);
    rig[j].quaternion.copy(saved[i][1]);
  });
  return clips;
}
