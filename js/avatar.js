// Builds a 3D person from a config, entirely in code (no model files).
//
// Real-world proportions in metres: about 1.76 m tall, 7.5 heads high, feet on y = 0.
// Rig (all groups, so poses can rotate them):
//   root -> hips (pelvis, y 0.92)
//             torso                      body-type scale; shirts, trousers' waist
//             head (centre y 1.645)      face, hair, hats, glasses
//             armL/armR -> elbowL/R -> hand        sleeves ride on each segment
//             legL/legR -> kneeL/R  -> ankle/foot  trouser legs and shoes too
// The person faces +z. Their right side is -x.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// w: overall width, limb: arm/leg thickness, chest: extra width at the chest and shoulders
const BODY = {
  slim: { w: 0.9, limb: 0.88, chest: 1 },
  regular: { w: 1, limb: 1, chest: 1 },
  athletic: { w: 1, limb: 1.12, chest: 1.14 },
  sturdy: { w: 1.18, limb: 1.16, chest: 1 },
};
const DEPTH = 0.62; // torso is wider than it is deep
const HEAD_SCALE = 1.15; // a touch larger than life, like animated films

// Radius profiles [radius, height], listed top to bottom.
// Torso, in hips space (0 = pelvis centre, 0.56 = base of the neck).
const BASE_TORSO = [
  [0.001, 0.565], [0.05, 0.56], [0.075, 0.54], [0.14, 0.5], [0.17, 0.47], [0.178, 0.42], [0.174, 0.34],
  [0.162, 0.25], [0.148, 0.15], [0.152, 0.1], [0.165, 0.03], [0.163, -0.03], [0.14, -0.07], [0.08, -0.095], [0.001, -0.1],
];
// Limbs, each in its own joint space.
const UPPER_ARM = [[0.048, 0.03], [0.05, 0], [0.05, -0.06], [0.044, -0.18], [0.038, -0.29], [0.037, -0.31]];
const FOREARM = [[0.038, 0.02], [0.041, -0.05], [0.035, -0.15], [0.028, -0.25]];
const THIGH = [[0.075, 0.05], [0.085, 0], [0.08, -0.1], [0.068, -0.25], [0.056, -0.38], [0.05, -0.42], [0.049, -0.44]];
const SHIN = [[0.05, 0.02], [0.052, -0.04], [0.058, -0.12], [0.05, -0.22], [0.038, -0.33], [0.034, -0.4]];

// Head ellipsoid radii. Hair and hats are modelled on a unit sphere and scaled by this.
const HEAD = { x: 0.083, y: 0.115, z: 0.1 };

// Set per build: the torso for this body type and the jaw shape ('soft' or 'strong').
let TORSO = BASE_TORSO;
let JAW = 'soft';

/** Broaden chest and shoulders (an athletic V shape) without touching the waist or neck. */
function torsoFor(chest) {
  if (chest === 1) return BASE_TORSO;
  return BASE_TORSO.map(([r, y]) => {
    const k = THREE.MathUtils.smoothstep(y, 0.15, 0.4) * (1 - THREE.MathUtils.smoothstep(y, 0.5, 0.56));
    return [r * (1 + (chest - 1) * k), y];
  });
}

const LONG_SLEEVES = ['hoodie', 'jacket', 'sweater', 'shirt', 'blazer', 'flannel'];
export const TIE_TOPS = ['shirt', 'blazer'];

// ---------- small helpers ----------

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });
}

const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function add(parent, geometry, mat, [x, y, z] = [0, 0, 0], rot) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function group(parent, [x, y, z] = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function lathe(profile, phiStart = 0, phiLength = Math.PI * 2, segments = 48) {
  // LatheGeometry faces outwards only when the points go bottom-up
  const points = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength);
}

/** Radius of a profile at height y. */
function radiusAt(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if (y <= y0 && y >= y1) return r0 + ((y - y0) / (y1 - y0 || 1)) * (r1 - r0);
  }
  return y > profile[0][1] ? profile[0][0] : profile[profile.length - 1][0];
}

/** The part of a body profile between heights `top` and `bottom`, pushed outwards by `gap`: a garment. */
function shell(profile, gap, top = Infinity, bottom = -Infinity) {
  const pts = [];
  if (top < profile[0][1]) pts.push([radiusAt(profile, top), top]);
  for (const [r, y] of profile) if (y <= top && y >= bottom) pts.push([r, y]);
  if (bottom > profile[profile.length - 1][1]) pts.push([radiusAt(profile, bottom), bottom]);
  return pts.map(([r, y]) => [r < 0.003 ? r : r + gap, y]);
}

/** A cylinder from point a to point b. */
function stick(parent, a, b, radius, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = add(parent, new THREE.CylinderGeometry(radius, radius, va.distanceTo(vb), 10), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

function plaid(hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#' + new THREE.Color(hex).getHexString();
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(0, 20, 64, 16);
  g.fillRect(20, 0, 16, 64);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 52, 64, 3);
  g.fillRect(52, 0, 3, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
}

// ---------- head shape ----------

/** Turn a point on a unit sphere into a head: narrower jaw and chin, rounder back of the skull. */
// Jaw width and chin depth as the face goes down (t = 0 at the eyes, 1 at the chin).
// A strong jaw stays wide until low down, then squares off, with the chin pushed forward.
const jawX = (t) => (JAW === 'strong' ? 1 + 0.06 * t - 0.5 * t ** 4 : 1 - 0.3 * t ** 1.5);
const chinZ = (t) => (JAW === 'strong' ? 1 + 0.06 * t ** 2 : 1 - 0.08 * t ** 1.5);

function shapeHead(ux, uy, uz) {
  let kx = 1, kz = 1;
  if (uy < 0) {
    const t = -uy;
    kx = jawX(t);
    kz = uz > 0 ? chinZ(t) : 1 - 0.35 * t;
  } else if (uz < 0) {
    kz = 1.06;
  }
  return [ux * HEAD.x * kx, uy * HEAD.y, uz * HEAD.z * kz];
}

/** How far forward the face surface is at (x, y). */
function faceZ(x, y) {
  const uy = y / HEAD.y;
  const t = Math.max(0, -uy);
  const ux = x / (HEAD.x * jawX(t));
  return Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)) * HEAD.z * chinZ(t);
}

function headGeometry(inflate = 1, ...ranges) {
  let g = new THREE.SphereGeometry(1, 64, 40, ...ranges);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g); // weld the seam so the head shades smoothly
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = shapeHead(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, x * inflate, y * inflate, z * inflate);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- the person ----------

export function buildAvatar(cfg) {
  const body = BODY[cfg.body] ?? BODY.regular;
  TORSO = torsoFor(body.chest);
  JAW = cfg.jaw === 'strong' ? 'strong' : 'soft';
  const skin = material(cfg.skin, { roughness: 0.55 });
  const top = cfg.top === 'flannel' ? plaid(cfg.topColor) : material(cfg.topColor, { side: THREE.DoubleSide, roughness: 0.85 });
  const bottom = material(cfg.bottomColor, { side: THREE.DoubleSide, roughness: 0.85 });
  const bottomTrim = material(shade(cfg.bottomColor, 0.78));

  const root = new THREE.Group();
  root.name = 'Avatar';
  const hips = group(root, [0, 0.92, 0]);
  const chest = group(hips); // upper body; leans independently of the legs
  const torso = group(chest);
  torso.scale.set(body.w, 1, body.w * DEPTH);
  add(torso, lathe(TORSO), skin);

  const rig = { root, hips, chest, torso, eyes: [] };

  // ---- Arms ----
  const sleeve = cfg.top === 'tank' ? null : LONG_SLEEVES.includes(cfg.top) ? 'long' : cfg.top === 'kurta' ? 'three-quarter' : 'short';
  const sleeveGap = cfg.top === 'blazer' ? 0.014 : cfg.top === 'hoodie' || cfg.top === 'sweater' ? 0.012 : 0.008;
  for (const s of [1, -1]) {
    const arm = group(chest, [s * 0.168 * body.w * body.chest, 0.45, 0]);
    arm.rotation.z = s * 0.07;
    const upper = group(arm);
    upper.scale.set(body.limb, 1, body.limb);
    add(upper, new THREE.SphereGeometry(0.05, 24, 16), skin); // shoulder
    add(upper, lathe(UPPER_ARM), skin);

    const elbow = group(arm, [0, -0.29, 0]);
    const fore = group(elbow);
    fore.scale.set(body.limb, 1, body.limb);
    add(fore, new THREE.SphereGeometry(0.039, 16, 12), skin);
    add(fore, lathe(FOREARM), skin);
    Object.assign(rig, addHand(elbow, s, skin));

    if (sleeve) {
      add(upper, new THREE.SphereGeometry(0.05 + sleeveGap, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), top);
      add(upper, lathe(shell(UPPER_ARM, sleeveGap, 0.03, sleeve === 'short' ? -0.13 : -0.31)), top);
      if (sleeve !== 'short') {
        const end = sleeve === 'long' ? -0.235 : -0.11;
        add(fore, new THREE.SphereGeometry(0.039 + sleeveGap, 16, 12), top);
        add(fore, lathe(shell(FOREARM, sleeveGap, 0.02, end)), top);
        if (cfg.top === 'blazer') {
          add(fore, new THREE.TorusGeometry(0.03 + 0.006, 0.004, 8, 24), material('#f5f5f5'), [0, -0.24, 0], [Math.PI / 2, 0, 0]);
        } else if (sleeve === 'long' && cfg.top !== 'jacket') {
          add(fore, new THREE.TorusGeometry(radiusAt(FOREARM, end) + sleeveGap, 0.006, 8, 24), top, [0, end, 0], [Math.PI / 2, 0, 0]);
        }
      }
    }
    rig[s === 1 ? 'armL' : 'armR'] = arm;
    rig[s === 1 ? 'elbowL' : 'elbowR'] = elbow;
  }

  // ---- Legs ----
  for (const s of [1, -1]) {
    const leg = group(hips, [s * 0.088 * body.w, -0.02, 0]);
    const thigh = group(leg);
    thigh.scale.set(body.limb, 1, body.limb);
    add(thigh, lathe(THIGH), skin);

    const knee = group(leg, [0, -0.42, 0]);
    const shin = group(knee);
    shin.scale.set(body.limb, 1, body.limb);
    add(shin, new THREE.SphereGeometry(0.05, 16, 12), skin);
    add(shin, lathe(SHIN), skin);

    const ankle = group(knee, [0, -0.4, 0]);
    addLegwear(cfg, s, thigh, shin, bottom, bottomTrim);
    addShoe(ankle, cfg, skin);

    rig[s === 1 ? 'legL' : 'legR'] = leg;
    rig[s === 1 ? 'kneeL' : 'kneeR'] = knee;
  }

  // ---- Clothes on the body ----
  const skirt = {
    skirt: [[0.158, 0.13], [0.168, 0.03], [0.2, -0.12], [0.25, -0.33]],
    pencil: [[0.158, 0.13], [0.168, 0.03], [0.172, -0.1], [0.152, -0.38]],
  }[cfg.bottom];
  if (skirt) {
    add(hips, lathe(skirt), bottom).scale.set(body.w, 1, body.w * 0.72);
  } else {
    add(torso, lathe(shell(TORSO, 0.01, 0.14)), bottom);
    if (cfg.top === 'shirt' && cfg.bottom !== 'joggers') {
      const formal = cfg.bottom === 'trousers';
      const y = 0.125;
      add(torso, new THREE.TorusGeometry(radiusAt(TORSO, y) + 0.012, 0.01, 8, 48), material(formal ? '#151515' : '#3b2314', { roughness: 0.4 }), [0, y, 0], [Math.PI / 2, 0, 0]);
      add(torso, new RoundedBoxGeometry(0.04, 0.026, 0.012, 2, 0.004), material(formal ? '#c0c0c0' : '#d4af37', { metalness: 0.8, roughness: 0.3 }), [0, y, radiusAt(TORSO, y) + 0.02]);
    }
  }
  addTop(chest, torso, cfg, top, body);

  // ---- Head ----
  const head = group(chest, [0, 0.73, 0]);
  head.scale.setScalar(HEAD_SCALE);
  rig.head = head;
  add(head, new THREE.CylinderGeometry(0.054, 0.062, 0.12, 24), skin, [0, -0.12, -0.012]);
  add(head, headGeometry(), skin);
  addFace(head, cfg, rig, skin);
  const hatOn = cfg.hat !== 'none' && cfg.hat !== 'headphones';
  const unit = group(head); // unit-sphere space for hair and hats
  unit.scale.set(HEAD.x, HEAD.y, HEAD.z);
  addHair(unit, cfg, hatOn);
  addHat(unit, cfg);
  addGlasses(head, cfg);

  // names let exported animations find each joint
  const names = {
    hips: 'Hips', chest: 'Chest', head: 'Head', armL: 'Arm_L', armR: 'Arm_R', elbowL: 'Elbow_L', elbowR: 'Elbow_R',
    fingersL: 'Fingers_L', fingersR: 'Fingers_R', thumbL: 'Thumb_L', thumbR: 'Thumb_R',
    legL: 'Leg_L', legR: 'Leg_R', kneeL: 'Knee_L', kneeR: 'Knee_R',
  };
  for (const [k, n] of Object.entries(names)) rig[k].name = n;
  return rig;
}

/** Palm, a finger block that curls at the knuckles, and a thumb that can point up. */
function addHand(elbow, s, skin) {
  const side = s === 1 ? 'L' : 'R';
  const hand = group(elbow, [0, -0.25, 0]);
  add(hand, new RoundedBoxGeometry(0.028, 0.085, 0.076, 2, 0.011), skin, [0, -0.045, 0.004]);
  const fingers = group(hand, [-s * 0.002, -0.085, 0.004]);
  fingers.rotation.z = -s * 0.3;
  add(fingers, new RoundedBoxGeometry(0.022, 0.072, 0.07, 2, 0.01), skin, [-s * 0.002, -0.034, 0]);
  const thumb = group(hand, [-s * 0.01, -0.035, 0.036]);
  thumb.rotation.x = 0.9;
  add(thumb, new THREE.CapsuleGeometry(0.0105, 0.04, 4, 8), skin, [0, -0.028, 0]);
  return { ['fingers' + side]: fingers, ['thumb' + side]: thumb };
}

function addLegwear(cfg, s, thigh, shin, mat, trim) {
  const b = cfg.bottom;
  if (b === 'shorts') {
    add(thigh, lathe(shell(THIGH, 0.014, 0.05, -0.24)), mat);
    return;
  }
  if (!['jeans', 'joggers', 'trousers', 'chinos', 'cargo'].includes(b)) return;
  const gap = b === 'cargo' || b === 'trousers' ? 0.016 : 0.011;
  add(thigh, lathe(shell(THIGH, gap, 0.05, -0.44)), mat);
  add(shin, new THREE.SphereGeometry(0.05 + gap, 16, 12), mat); // keeps the knee covered when it bends

  if (b === 'joggers') {
    add(shin, lathe(shell(SHIN, 0.01, 0.02, -0.38)), mat);
    add(shin, new THREE.TorusGeometry(0.046, 0.009, 8, 20), mat, [0, -0.385, 0], [Math.PI / 2, 0, 0]);
  } else {
    const [rTop, rBot] = { jeans: [0.062, 0.054], trousers: [0.066, 0.062], chinos: [0.06, 0.052], cargo: [0.068, 0.064] }[b];
    const len = b === 'chinos' ? 0.38 : 0.405;
    add(shin, new THREE.CylinderGeometry(rTop, rBot, len, 24, 1, true), mat, [0, 0.02 - len / 2, 0]);
    if (b === 'chinos') add(shin, new THREE.TorusGeometry(rBot, 0.008, 8, 24), trim, [0, 0.02 - len, 0], [Math.PI / 2, 0, 0]);
    if (b === 'trousers') add(shin, new THREE.BoxGeometry(0.003, 0.4, 0.003), trim, [0, -0.18, 0.064]); // crease
  }
  if (b === 'trousers') add(thigh, new THREE.BoxGeometry(0.003, 0.4, 0.003), trim, [0, -0.22, radiusAt(THIGH, -0.22) + gap]);
  if (b === 'cargo') add(thigh, new RoundedBoxGeometry(0.025, 0.09, 0.075, 2, 0.008), trim, [s * (radiusAt(THIGH, -0.22) + gap), -0.22, 0]);
}

function addShoe(ankle, cfg, skin) {
  const kind = cfg.shoes;
  const mat = material(cfg.shoesColor, { roughness: 0.6 });
  if (kind === 'barefoot' || kind === 'sandals') {
    add(ankle, new RoundedBoxGeometry(0.08, 0.06, 0.235, 3, 0.025), skin, [0, -0.045, 0.045]);
  }
  if (kind === 'sneakers' || kind === 'boots') {
    const sole = material(kind === 'boots' ? '#2a2a2a' : '#f5f5f5', { roughness: 0.9 });
    add(ankle, new RoundedBoxGeometry(0.095, 0.08, 0.265, 3, 0.032), mat, [0, -0.038, 0.045]);
    add(ankle, new RoundedBoxGeometry(0.1, 0.024, 0.272, 2, 0.008), sole, [0, -0.068, 0.045]);
    if (kind === 'boots') add(ankle, new THREE.CylinderGeometry(0.05, 0.052, 0.15, 24), mat, [0, 0.05, 0]);
    else add(ankle, new THREE.BoxGeometry(0.035, 0.005, 0.07), material('#f5f5f5'), [0, 0.002, 0.07], [-0.25, 0, 0]);
  } else if (kind === 'sandals') {
    add(ankle, new RoundedBoxGeometry(0.09, 0.016, 0.255, 2, 0.006), mat, [0, -0.072, 0.045]);
    for (const z of [0.02, 0.1]) add(ankle, new THREE.BoxGeometry(0.086, 0.01, 0.016), mat, [0, -0.02 - z * 0.12, z]);
  } else if (kind === 'oxfords' || kind === 'loafers') {
    const polished = material(cfg.shoesColor, { roughness: 0.22, metalness: 0.15 });
    add(ankle, new THREE.CylinderGeometry(0.038, 0.038, 0.07, 16), material('#2b2b2b'), [0, 0.0, 0]); // sock
    add(ankle, new RoundedBoxGeometry(0.088, 0.06, 0.262, 3, 0.024), polished, [0, -0.045, 0.05]);
    add(ankle, new RoundedBoxGeometry(0.092, 0.014, 0.266, 2, 0.005), material('#1a1a1a'), [0, -0.073, 0.05]);
    const detail = material(shade(cfg.shoesColor, 0.6), { roughness: 0.3 });
    if (kind === 'oxfords') add(ankle, new THREE.BoxGeometry(0.03, 0.004, 0.05), detail, [0, -0.014, 0.08]);
    else add(ankle, new THREE.BoxGeometry(0.08, 0.006, 0.014), detail, [0, -0.015, 0.11]);
  }
}

// ---------- tops ----------

function addTop(hips, torso, cfg, mat, body) {
  const t = cfg.top;
  const trim = material(shade(cfg.topColor, 0.8));
  const white = material('#f5f5f5', { side: THREE.DoubleSide, roughness: 0.85 });
  const neck = group(hips); // collars etc. sit around the round neck, not the flattened torso
  const front = (profile, y, extra = 0) => radiusAt(profile, y) + extra;

  const UNTUCKED = shell(TORSO, 0.016, 0.545, 0.0);
  const TUCKED = shell(TORSO, 0.006, 0.545, 0.115);

  if (t === 'blazer' || t === 'jacket') {
    const inner = t === 'blazer' ? TUCKED : UNTUCKED;
    const outer = shell(TORSO, t === 'blazer' ? 0.028 : 0.03, 0.54, t === 'blazer' ? -0.06 : 0.0);
    const gap = t === 'blazer' ? 0.3 : 0.22;
    add(torso, lathe(inner), white);
    add(torso, lathe(outer, gap, Math.PI * 2 - gap * 2), mat);
    const edge = (s, y) => [s * Math.sin(gap) * radiusAt(outer, y), y, Math.cos(gap) * radiusAt(outer, y)];
    for (const s of [1, -1]) stick(torso, [s * 0.06, 0.53, 0.07], edge(s, t === 'blazer' ? 0.3 : 0.45), 0.012, trim).scale.set(1, 1, 0.5);
    if (t === 'blazer') {
      collar(neck, white);
      add(torso, new THREE.SphereGeometry(0.008, 8, 8), trim, edge(1, 0.22).map((v, i) => (i === 2 ? v + 0.004 : v)));
      const square = new THREE.Shape();
      square.moveTo(-0.022, 0);
      square.lineTo(0.022, 0);
      square.lineTo(0.012, 0.022);
      square.lineTo(-0.006, 0.016);
      square.closePath();
      const r = radiusAt(outer, 0.38), x = 0.1;
      add(torso, new THREE.ShapeGeometry(square), material(cfg.tieColor ?? '#ef4444', { side: THREE.DoubleSide }), [x, 0.38, Math.sqrt(r * r - x * x) + 0.004], [0, Math.asin(x / r), 0]);
      addTie(torso, cfg, inner);
    } else {
      for (const y of [0.42, 0.3, 0.18]) add(torso, new THREE.SphereGeometry(0.007, 8, 8), trim, edge(1, y));
    }
    return;
  }

  const profile = t === 'tank' ? shell(TORSO, 0.008, 0.47, 0.0)
    : t === 'shirt' ? TUCKED
    : t === 'kurta' ? [...shell(TORSO, 0.016, 0.545, 0.0), [0.19, -0.12], [0.215, -0.3]]
    : shell(TORSO, t === 'hoodie' || t === 'sweater' ? 0.02 : 0.016, 0.545, 0.0);
  add(torso, lathe(profile), mat);

  if (t === 'shirt' || t === 'flannel') {
    collar(neck, mat);
    for (const y of [0.48, 0.38, 0.28, 0.18]) add(torso, new THREE.SphereGeometry(0.006, 8, 8), white, [0, y, front(profile, y, 0.002)]);
    if (t === 'flannel') {
      for (const s of [1, -1]) {
        const r = front(profile, 0.4), x = s * 0.075;
        add(torso, new RoundedBoxGeometry(0.05, 0.05, 0.01, 2, 0.004), mat, [x, 0.4, Math.sqrt(r * r - x * x)], [0, Math.asin(x / r), 0]);
      }
    }
    if (t === 'shirt') addTie(torso, cfg, profile);
  } else if (t === 'polo') {
    collar(neck, trim, true);
    for (const y of [0.5, 0.46]) add(torso, new THREE.SphereGeometry(0.006, 8, 8), white, [0, y, front(profile, y, 0.002)]);
  } else if (t === 'tshirt') {
    add(neck, new THREE.TorusGeometry(0.062, 0.006, 8, 32), trim, [0, 0.55, 0.004], [Math.PI / 2 + 0.25, 0, 0]);
  } else if (t === 'sweater') {
    add(neck, new THREE.TorusGeometry(0.062, 0.011, 8, 32), trim, [0, 0.55, 0.004], [Math.PI / 2 + 0.25, 0, 0]);
    add(torso, new THREE.TorusGeometry(front(profile, 0.01), 0.01, 8, 48), trim, [0, 0.01, 0], [Math.PI / 2, 0, 0]);
  } else if (t === 'hoodie') {
    add(neck, new THREE.TorusGeometry(0.085, 0.032, 12, 32), mat, [0, 0.545, -0.025], [Math.PI / 2 - 0.4, 0, 0]);
    add(torso, new RoundedBoxGeometry(0.18, 0.08, 0.016, 2, 0.008), trim, [0, 0.13, front(profile, 0.13)]);
    for (const s of [1, -1]) stick(torso, [s * 0.025, 0.52, 0.1], [s * 0.028, 0.42, front(profile, 0.42, 0.004)], 0.003, white);
  } else if (t === 'kurta') {
    add(neck, new THREE.CylinderGeometry(0.06, 0.066, 0.03, 32, 1, true), trim, [0, 0.565, 0]);
    const gold = material('#d4af37', { metalness: 0.7, roughness: 0.35 });
    for (const y of [0.5, 0.44, 0.38]) add(torso, new THREE.SphereGeometry(0.006, 8, 8), gold, [0, y, front(profile, y, 0.002)]);
  }
}

function collar(neck, mat, flat = false) {
  add(neck, new THREE.CylinderGeometry(0.058, 0.066, flat ? 0.024 : 0.036, 32, 1, true, Math.PI * 0.14, Math.PI * 1.72), mat, [0, 0.568, 0]);
  for (const s of [1, -1]) {
    add(neck, new THREE.BoxGeometry(0.034, 0.026, 0.005), mat, [s * 0.022, 0.556, 0.058], [flat ? -0.7 : -0.3, s * 0.3, s * 0.55]);
  }
}

function addTie(torso, cfg, profile) {
  if (!TIE_TOPS.includes(cfg.top) || !cfg.tie || cfg.tie === 'none') return;
  const mat = material(cfg.tieColor, { roughness: 0.45, side: THREE.DoubleSide });
  const z = (y) => radiusAt(profile, y) + 0.008;
  if (cfg.tie === 'bow') {
    for (const s of [1, -1]) add(torso, new THREE.ConeGeometry(0.02, 0.036, 4), mat, [s * 0.018, 0.548, 0.102], [0, 0, s * Math.PI / 2]);
    add(torso, new THREE.SphereGeometry(0.009, 10, 8), mat, [0, 0.548, 0.104]);
    return;
  }
  add(torso, new RoundedBoxGeometry(0.024, 0.022, 0.016, 2, 0.005), mat, [0, 0.548, 0.1]);
  stick(torso, [0, 0.54, 0.102], [0, 0.4, z(0.4)], 0.011, mat).scale.set(1, 1, 0.3);
  const blade = new THREE.Shape();
  blade.moveTo(-0.012, 0);
  blade.lineTo(0.012, 0);
  blade.lineTo(0.02, -0.17);
  blade.lineTo(0, -0.195);
  blade.lineTo(-0.02, -0.17);
  blade.closePath();
  add(torso, new THREE.ShapeGeometry(blade), mat, [0, 0.405, z(0.33)]);
}

// ---------- face ----------

function addFace(head, cfg, rig, skin) {
  const white = material('#f8f6f2', { roughness: 0.25 });
  const iris = material(cfg.eyes, { roughness: 0.25 });
  const dark = material('#0d0d0d', { roughness: 0.3 });
  const brow = material(shade(cfg.hairColor, 0.8), { roughness: 0.9 });
  const lipColor = new THREE.Color(cfg.skin).lerp(new THREE.Color('#a8505a'), 0.45);
  const lips = material(lipColor, { roughness: 0.45 });
  const ex = cfg.expression;
  const lift = { smile: 0.0, grin: 0.002, neutral: -0.001, surprised: 0.006, excited: 0.008, confident: -0.002 }[ex] ?? 0;
  const strong = cfg.jaw === 'strong';
  const lid = { excited: 0.2, surprised: 0.22, confident: 0.38, neutral: 0.33 }[ex] ?? 0.3;

  for (const s of [1, -1]) {
    const x = s * 0.032, y = 0.014;
    const eye = group(head, [x, y, faceZ(x, y) - 0.0075]);
    add(eye, new THREE.SphereGeometry(0.0125, 24, 16), white);
    add(eye, new THREE.SphereGeometry(0.0068, 20, 12), iris, [0, 0, 0.0098]).scale.set(1, 1, 0.45);
    add(eye, new THREE.SphereGeometry(0.0032, 12, 8), dark, [0, 0, 0.0121]).scale.set(1, 1, 0.4);
    add(eye, new THREE.SphereGeometry(0.0013, 8, 6), white, [s * -0.0025, 0.0025, 0.0126]);
    add(eye, new THREE.SphereGeometry(0.0136, 20, 10, 0, Math.PI * 2, 0, Math.PI * lid), skin, [0, 0, 0], [0.12, 0, 0]); // upper eyelid
    rig.eyes.push(eye);

    const by = 0.034 + lift + (ex === 'confident' && s === -1 ? 0.006 : 0); // one raised brow for a confident look
    const b = add(head, new RoundedBoxGeometry(strong ? 0.034 : 0.03, strong ? 0.0075 : 0.005, 0.007, 2, 0.0025), brow, [s * 0.033, by, faceZ(s * 0.033, by) + 0.002]);
    b.rotation.set(-0.2, s * 0.32, s * ({ neutral: -0.12, confident: -0.1, surprised: 0.08, excited: 0.12 }[ex] ?? 0.04));

    add(head, new THREE.SphereGeometry(0.028, 16, 12), skin, [s * 0.082, -0.004, -0.008], [0, s * 0.3, 0]).scale.set(0.35, 1, 0.65); // ear
    add(head, new THREE.SphereGeometry(0.0075, 10, 8), skin, [s * 0.009, -0.03, faceZ(0.009, -0.03) + 0.002]); // nostril wing
  }

  // nose
  const tipZ = faceZ(0, -0.026) + 0.009;
  stick(head, [0, 0.008, faceZ(0, 0.008) - 0.002], [0, -0.022, tipZ - 0.003], 0.0055, skin);
  add(head, new THREE.SphereGeometry(0.0092, 16, 12), skin, [0, -0.026, tipZ - 0.004]).scale.set(1.1, 0.85, 1);

  // mouth
  const beard = cfg.facialHair === 'beard';
  const my = -0.056;
  const mouth = group(head, [0, my, faceZ(0, my) + (beard ? 0.008 : 0.0015)]);
  mouth.rotation.x = -0.3;
  if (cfg.expression === 'smile') {
    add(mouth, new THREE.TorusGeometry(0.016, 0.0034, 8, 24, Math.PI * 0.9), lips, [0, 0.009, 0], [0, 0, Math.PI * 1.05]);
    add(mouth, new THREE.CapsuleGeometry(0.0028, 0.022, 4, 8), lips, [0, 0.003, -0.001], [0, 0, Math.PI / 2]);
  } else if (cfg.expression === 'grin') {
    add(mouth, new THREE.CircleGeometry(0.018, 24, Math.PI, Math.PI), material('#4a1720'), [0, 0.004, 0.0005]);
    add(mouth, new THREE.BoxGeometry(0.028, 0.0055, 0.002), white, [0, 0.0015, 0.0012]);
    add(mouth, new THREE.TorusGeometry(0.0185, 0.0028, 8, 24, Math.PI), lips, [0, 0.004, 0], [0, 0, Math.PI]);
  } else if (ex === 'excited') {
    // big open laugh: teeth on top, tongue below
    add(mouth, new THREE.CircleGeometry(0.024, 28, Math.PI, Math.PI), material('#4a1720'), [0, 0.007, 0.0005]).scale.y = 1.2;
    add(mouth, new THREE.BoxGeometry(0.036, 0.0065, 0.002), white, [0, 0.0045, 0.0012]);
    add(mouth, new THREE.CircleGeometry(0.012, 20, Math.PI, Math.PI), material('#c75b6b'), [0, -0.012, 0.001]);
    add(mouth, new THREE.TorusGeometry(0.0245, 0.003, 8, 28, Math.PI), lips, [0, 0.007, 0], [0, 0, Math.PI]).scale.y = 1.2;
  } else if (ex === 'confident') {
    // half smile, pulled up on one side
    add(mouth, new THREE.CapsuleGeometry(0.0032, 0.024, 4, 8), lips, [0, 0.002, 0], [0, 0, Math.PI / 2 + 0.12]);
    add(mouth, new THREE.TorusGeometry(0.01, 0.003, 8, 16, Math.PI * 0.6), lips, [-0.011, 0.008, 0], [0, 0, Math.PI * 1.2]);
  } else if (cfg.expression === 'surprised') {
    add(mouth, new THREE.CircleGeometry(0.008, 20), material('#4a1720'));
    add(mouth, new THREE.TorusGeometry(0.009, 0.003, 8, 24), lips);
  } else {
    add(mouth, new THREE.CapsuleGeometry(0.003, 0.022, 4, 8), lips, [0, 0.0025, 0], [0, 0, Math.PI / 2]);
    add(mouth, new THREE.CapsuleGeometry(0.0038, 0.018, 4, 8), lips, [0, -0.0035, 0], [0, 0, Math.PI / 2]);
  }

  const fh = material(cfg.hairColor, { roughness: 0.95, side: THREE.DoubleSide });
  if (beard) add(head, headGeometry(1.05, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.6, Math.PI * 0.37), fh);
  if (cfg.facialHair === 'moustache' || beard) {
    for (const s of [1, -1]) {
      const z = faceZ(s * 0.011, -0.043) + (beard ? 0.008 : 0.004);
      add(head, new THREE.CapsuleGeometry(0.0045, 0.016, 4, 8), fh, [s * 0.011, -0.043, z], [0, 0, Math.PI / 2 + s * 0.3]);
    }
  }
}

// ---------- hair & hats (built on a unit sphere, scaled to the head) ----------

function onSphere(elevationDeg, aroundDeg, r) {
  const e = THREE.MathUtils.degToRad(elevationDeg), a = THREE.MathUtils.degToRad(aroundDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(r);
}

function addHair(unit, cfg, hatOn) {
  const style = cfg.hair;
  if (style === 'bald') return;
  const mat = material(cfg.hairColor, { roughness: 0.85, side: THREE.DoubleSide });
  const extras = [];
  const r = style === 'buzz' ? 1.07 : style === 'curly' ? 1.12 : 1.1;

  add(unit, new THREE.SphereGeometry(r, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat).rotation.x = style === 'curly' ? -0.3 : -0.4;
  add(unit, new THREE.SphereGeometry(r, 48, 14, Math.PI, Math.PI, Math.PI / 2, Math.PI * 0.2), mat); // back of the head

  if (style === 'spiky') {
    const cone = new THREE.ConeGeometry(0.2, 0.55, 8);
    for (let i = 0; i < 9; i++) extras.push(spike(unit, cone, onSphere(50, i * 40 + 10, 1.0), mat));
    for (const a of [0, 120, 240]) extras.push(spike(unit, cone, onSphere(78, a, 1.0), mat));
  } else if (style === 'quiff') {
    // volume swept up and back from the forehead
    const front = add(unit, new THREE.SphereGeometry(0.62, 32, 16), mat, [0.05, 0.92, 0.32], [-0.5, 0, 0.06]);
    front.scale.set(1.4, 0.6, 1.15);
    const back = add(unit, new THREE.SphereGeometry(0.62, 32, 16), mat, [0, 0.98, -0.2], [0.2, 0, 0]);
    back.scale.set(1.3, 0.42, 1.25);
    extras.push(front, back);
  } else if (style === 'sidepart') {
    const sweep = add(unit, new THREE.SphereGeometry(0.65, 32, 16), mat, [-0.3, 0.92, 0.18], [-0.3, 0, 0.35]);
    sweep.scale.set(1.15, 0.42, 1.3);
    extras.push(sweep);
  } else if (style === 'long') {
    add(unit, new THREE.CylinderGeometry(1.1, 1.24, 1.9, 48, 1, true, Math.PI / 2, Math.PI), mat, [0, -0.75, 0]);
    for (const s of [1, -1]) add(unit, new THREE.CapsuleGeometry(0.17, 1.05, 4, 12), mat, [s * 0.96, -0.62, 0.22], [0, 0, s * 0.06]);
  } else if (style === 'bun') {
    extras.push(add(unit, new THREE.SphereGeometry(0.42, 24, 16), mat, [0, 0.98, -0.55]));
  } else if (style === 'ponytail') {
    add(unit, new THREE.TorusGeometry(0.14, 0.05, 8, 16), material('#ef4444'), [0, 0.3, -1.08]);
    add(unit, new THREE.CapsuleGeometry(0.2, 1.15, 6, 12), mat, [0, -0.5, -1.25], [0.22, 0, 0]);
  } else if (style === 'curly') {
    const curl = new THREE.SphereGeometry(0.27, 14, 10);
    for (const [elev, n] of [[82, 1], [58, 8], [32, 12], [6, 14], [-20, 12]]) {
      for (let i = 0; i < n; i++) {
        const p = onSphere(elev, (i / n) * 360 + elev, 1.07);
        if (p.z > 0.3 && elev < 40) continue; // keep the face clear
        extras.push(add(unit, curl, mat, p.toArray()));
      }
    }
  }
  if (hatOn) extras.forEach((m) => (m.visible = false));
}

function spike(parent, cone, pos, mat) {
  const m = add(parent, cone, mat);
  const dir = pos.clone().normalize();
  m.position.copy(pos).addScaledVector(dir, 0.22);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return m;
}

function addHat(unit, cfg) {
  const kind = cfg.hat;
  if (kind === 'none') return;
  const mat = material(cfg.hatColor, { side: THREE.DoubleSide });
  const band = material(shade(cfg.hatColor, 0.45));
  const hat = group(unit);

  if (kind === 'cap') {
    hat.rotation.x = -0.22;
    add(hat, new THREE.SphereGeometry(1.14, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat).scale.set(1, 0.9, 1);
    add(hat, new THREE.CylinderGeometry(0.75, 0.75, 0.06, 40), mat, [0, 0.04, 0.95]).rotation.x = 0.12;
    add(hat, new THREE.SphereGeometry(0.08, 10, 8), band, [0, 1.03, 0]);
  } else if (kind === 'beanie') {
    hat.rotation.x = -0.25;
    add(hat, new THREE.SphereGeometry(1.15, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat).scale.set(1, 1.12, 1);
    add(hat, new THREE.TorusGeometry(1.14, 0.13, 12, 56), band, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
    add(hat, new THREE.SphereGeometry(0.24, 16, 12), band, [0, 1.35, 0]);
  } else if (kind === 'sunhat') {
    hat.rotation.x = -0.12;
    add(hat, new THREE.CylinderGeometry(0.86, 1.0, 0.75, 48), mat, [0, 0.94, 0]);
    add(hat, new THREE.CylinderGeometry(1.8, 1.8, 0.05, 64), mat, [0, 0.58, 0]);
    add(hat, new THREE.CylinderGeometry(1.01, 1.01, 0.17, 48), band, [0, 0.67, 0]);
  } else if (kind === 'tophat') {
    hat.rotation.x = -0.1;
    add(hat, new THREE.CylinderGeometry(0.78, 0.78, 1.3, 48), mat, [0, 1.47, 0]);
    add(hat, new THREE.CylinderGeometry(1.3, 1.3, 0.07, 56), mat, [0, 0.82, 0]);
    add(hat, new THREE.CylinderGeometry(0.8, 0.8, 0.22, 48), band, [0, 0.98, 0]);
  } else if (kind === 'headphones') {
    add(hat, new THREE.TorusGeometry(1.13, 0.07, 12, 56, Math.PI), mat, [0, 0.05, -0.05]);
    for (const s of [1, -1]) {
      add(hat, new THREE.CylinderGeometry(0.42, 0.42, 0.28, 32), mat, [s * 1.12, 0, -0.05], [0, 0, Math.PI / 2]);
      add(hat, new THREE.CylinderGeometry(0.36, 0.36, 0.1, 32), band, [s * 0.98, 0, -0.05], [0, 0, Math.PI / 2]);
    }
  }
}

function addGlasses(head, cfg) {
  const kind = cfg.glasses;
  if (kind === 'none') return;
  const frame = material(cfg.glassesColor, { metalness: 0.4, roughness: 0.35 });
  const lens = kind === 'shades'
    ? material('#111318', { metalness: 0.5, roughness: 0.15, side: THREE.DoubleSide })
    : material('#cfe8ff', { transparent: true, opacity: 0.16, roughness: 0.05 });
  const y = 0.014, z = faceZ(0.033, y) + 0.013;

  for (const s of [1, -1]) {
    const x = s * 0.034;
    if (kind === 'square') {
      add(head, new THREE.TorusGeometry(0.024, 0.0024, 6, 4), frame, [x, y, z], [0, 0, Math.PI / 4]).scale.set(1.15, 0.8, 1);
      add(head, new THREE.CircleGeometry(0.023, 4), lens, [x, y, z - 0.001], [0, 0, Math.PI / 4]).scale.set(1.15, 0.8, 1);
    } else {
      const wide = kind === 'shades' ? 1.15 : 1;
      add(head, new THREE.TorusGeometry(0.0185, 0.0022, 8, 28), frame, [x, y, z]).scale.x = wide;
      add(head, new THREE.CircleGeometry(0.0182, 28), lens, [x, y, z - 0.001]).scale.x = wide;
    }
    stick(head, [s * 0.056, y + 0.004, z - 0.004], [s * 0.086, y + 0.004, -0.01], 0.0017, frame); // arm to the ear
  }
  stick(head, [-0.014, y + 0.004, z + 0.001], [0.014, y + 0.004, z + 0.001], 0.0019, frame); // bridge
}

/** Free GPU memory of a rig built by buildAvatar. */
export function disposeAvatar(rig) {
  rig.root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}
