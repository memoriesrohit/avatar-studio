// Builds a stylised 3D character from a config, entirely from simple shapes (no model files).
//
// Rig (all groups, so poses can rotate them):
//   root -> hips (y 0.95, pelvis)
//             torso (body-type scale)    clothes on the body
//             head  (centre at y 2.0)    face, hair, hats, glasses
//             armL / armR (shoulders)    sleeves move with the arms
//             legL / legR (hip joints)   trousers and shoes move with the legs
// The character faces +z, its feet touch y = 0. Its right side is -x.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const BODY = {
  slim: { w: 0.88, armX: 0.305, legX: 0.115, limb: 0.88 },
  regular: { w: 1, armX: 0.335, legX: 0.13, limb: 1 },
  sturdy: { w: 1.2, armX: 0.385, legX: 0.15, limb: 1.18 },
};

// Radius profiles (radius, height) for lathed body parts, in hips space.
const TORSO = [[0.001, -0.17], [0.16, -0.13], [0.23, -0.05], [0.245, 0.05], [0.232, 0.15], [0.25, 0.35], [0.26, 0.5], [0.25, 0.6], [0.2, 0.69], [0.09, 0.74], [0.001, 0.76]];
const SHIRT = [[0.105, 0.738], [0.212, 0.702], [0.268, 0.612], [0.277, 0.5], [0.268, 0.35], [0.25, 0.15], [0.262, 0.03]];
const TANK = [[0.17, 0.675], [0.258, 0.6], [0.274, 0.5], [0.268, 0.35], [0.25, 0.15], [0.262, 0.03]];
const KURTA = [...SHIRT.slice(0, -1), [0.262, 0.03], [0.285, -0.2], [0.31, -0.45]];
const SHIRT_TUCKED = [...SHIRT.slice(0, -2), [0.25, 0.15], [0.248, 0.11]];
const BLAZER = [[0.125, 0.735], [0.226, 0.705], [0.284, 0.615], [0.292, 0.5], [0.283, 0.35], [0.266, 0.15], [0.274, 0.03], [0.285, -0.07]];
const PANTS = [[0.255, 0.14], [0.258, 0.05], [0.25, -0.05], [0.178, -0.135], [0.001, -0.185]];
const SKIRT = [[0.256, 0.14], [0.262, 0.05], [0.33, -0.15], [0.43, -0.37]];
const PENCIL = [[0.256, 0.14], [0.262, 0.05], [0.272, -0.15], [0.252, -0.5]];

const LONG_SLEEVES = ['hoodie', 'jacket', 'sweater', 'shirt', 'blazer', 'flannel'];
const COLLARED = ['shirt', 'blazer', 'polo', 'flannel'];
export const TIE_TOPS = ['shirt', 'blazer'];
const TROUSERS = { jeans: [0.108, 0.104], joggers: [0.108, 0.097], trousers: [0.112, 0.108], chinos: [0.108, 0.1], cargo: [0.12, 0.112] };

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });
}

function shade(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

/** Checked flannel fabric drawn on a small canvas. */
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
  tex.repeat.set(6, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
}

/** Radius of a lathe profile at height y, so details can sit on the fabric. */
function radiusAt(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if ((y <= y0 && y >= y1) || (y >= y0 && y <= y1)) return r0 + ((y - y0) / (y1 - y0 || 1)) * (r1 - r0);
  }
  return profile[profile.length - 1][0];
}

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

function lathe(profile, segments = 40, phiStart = 0, phiLength = Math.PI * 2) {
  // profiles listed top-down would face inwards; always build them bottom-up
  const points = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength);
}

/** A cylinder from point a to point b. */
function stick(parent, a, b, radius, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = add(parent, new THREE.CylinderGeometry(radius, radius, va.distanceTo(vb), 8), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

/** Top hemisphere shell, tilted back so the front edge sits above the eyes. */
function cap(parent, r, mat, tilt = -0.38) {
  const m = add(parent, new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  m.rotation.x = tilt;
  return m;
}

function onHead(elevationDeg, aroundDeg, r) {
  const e = THREE.MathUtils.degToRad(elevationDeg), a = THREE.MathUtils.degToRad(aroundDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(r);
}

export function buildAvatar(cfg) {
  const body = BODY[cfg.body] ?? BODY.regular;
  const skin = material(cfg.skin, { roughness: 0.6 });
  const top = cfg.top === 'flannel' ? plaid(cfg.topColor) : material(cfg.topColor, { side: THREE.DoubleSide });
  const bottom = material(cfg.bottomColor, { side: THREE.DoubleSide });
  const bottomTrim = material(shade(cfg.bottomColor, 0.78));
  const hairMat = material(cfg.hairColor, { roughness: 0.85, side: THREE.DoubleSide });

  const root = new THREE.Group();
  const hips = group(root, [0, 0.95, 0]);
  const torso = group(hips);
  torso.scale.set(body.w, 1, body.w * 0.78);
  add(torso, lathe(TORSO), skin);

  const rig = { root, hips, torso, eyes: [] };
  const sideways = cfg.top === 'tank' ? 'bare' : LONG_SLEEVES.includes(cfg.top) ? 'long' : cfg.top === 'kurta' ? 'three-quarter' : 'short';

  // ---- Arms ----
  for (const s of [1, -1]) {
    const arm = group(hips, [s * body.armX, 0.63, 0]);
    arm.rotation.z = s * 0.12;
    const limb = group(arm);
    limb.scale.set(body.limb, 1, body.limb);
    add(limb, new THREE.CapsuleGeometry(0.07, 0.48, 6, 16), skin, [0, -0.3, 0]);
    add(arm, new THREE.SphereGeometry(0.082, 20, 16), skin, [0, -0.64, 0]);

    if (sideways !== 'bare') {
      add(limb, new THREE.SphereGeometry(0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), top, [0, -0.02, 0]);
      const len = { short: 0.24, 'three-quarter': 0.44, long: 0.56 }[sideways];
      add(limb, new THREE.CylinderGeometry(0.09, 0.083, len, 20, 1, true), top, [0, -0.02 - len / 2, 0]);
      if (cfg.top === 'blazer') {
        add(limb, new THREE.TorusGeometry(0.076, 0.014, 8, 20), material('#f5f5f5'), [0, -0.585, 0], [Math.PI / 2, 0, 0]);
      } else if (sideways === 'long' && cfg.top !== 'jacket') {
        add(limb, new THREE.TorusGeometry(0.08, 0.016, 8, 20), top, [0, -0.57, 0], [Math.PI / 2, 0, 0]);
      }
    }
    rig[s === 1 ? 'armL' : 'armR'] = arm;
  }

  // ---- Legs, trousers, shoes ----
  for (const s of [1, -1]) {
    const leg = group(hips, [s * body.legX, 0, 0]);
    const limb = group(leg);
    limb.scale.set(body.limb, 1, body.limb);
    add(limb, new THREE.CapsuleGeometry(0.09, 0.7, 6, 16), skin, [0, -0.42, 0]);

    const b = cfg.bottom;
    if (TROUSERS[b]) {
      const [rTop, rBot] = TROUSERS[b];
      add(limb, new THREE.CylinderGeometry(rTop, rBot, 0.8, 20, 1, true), bottom, [0, -0.4, 0]);
      if (b === 'joggers') add(limb, new THREE.TorusGeometry(0.097, 0.02, 8, 20), bottom, [0, -0.79, 0], [Math.PI / 2, 0, 0]);
      if (b === 'chinos') add(limb, new THREE.TorusGeometry(0.101, 0.022, 8, 20), bottomTrim, [0, -0.775, 0], [Math.PI / 2, 0, 0]);
      if (b === 'trousers') add(limb, new THREE.BoxGeometry(0.006, 0.76, 0.006), bottomTrim, [0, -0.4, 0.11]); // front crease
      if (b === 'cargo') {
        add(limb, new RoundedBoxGeometry(0.05, 0.14, 0.12, 2, 0.015), bottomTrim, [s * 0.118, -0.36, 0]);
        add(limb, new THREE.BoxGeometry(0.052, 0.035, 0.125), bottomTrim, [s * 0.12, -0.28, 0]);
      }
    } else if (b === 'shorts') {
      add(limb, new THREE.CylinderGeometry(0.11, 0.112, 0.36, 20, 1, true), bottom, [0, -0.17, 0]);
    }

    addShoe(leg, cfg, skin);
    rig[s === 1 ? 'legL' : 'legR'] = leg;
  }

  // ---- Clothes on the body ----
  const skirt = { skirt: SKIRT, pencil: PENCIL }[cfg.bottom];
  if (skirt) {
    add(hips, lathe(skirt), bottom).scale.set(body.w, 1, body.w * 0.85);
  } else {
    add(torso, lathe(PANTS), bottom);
    // a belt only shows with a tucked-in shirt
    if (cfg.top === 'shirt' && TROUSERS[cfg.bottom] && cfg.bottom !== 'joggers') {
      const formal = cfg.bottom === 'trousers';
      add(torso, new THREE.TorusGeometry(0.257, 0.018, 8, 40), material(formal ? '#151515' : '#3b2314', { roughness: 0.45 }), [0, 0.12, 0], [Math.PI / 2, 0, 0]);
      add(torso, new RoundedBoxGeometry(0.07, 0.05, 0.02, 2, 0.008), material(formal ? '#c0c0c0' : '#d4af37', { metalness: 0.8, roughness: 0.3 }), [0, 0.12, 0.27]);
    }
  }
  addTop(torso, cfg, top);

  // ---- Head ----
  const head = group(hips, [0, 1.05, 0]);
  rig.head = head;
  add(head, new THREE.CylinderGeometry(0.085, 0.095, 0.24, 16), skin, [0, -0.28, 0]);
  add(head, new THREE.SphereGeometry(0.32, 48, 32), skin).scale.set(1, 1.02, 1);
  for (const s of [1, -1]) add(head, new THREE.SphereGeometry(0.07, 16, 12), skin, [s * 0.315, -0.01, 0]).scale.set(0.6, 1, 0.8);
  add(head, new THREE.SphereGeometry(0.036, 16, 12), skin, [0, -0.045, 0.318]);
  addFace(head, cfg, rig);
  const hatOn = cfg.hat !== 'none' && cfg.hat !== 'headphones';
  addHair(head, cfg, hairMat, hatOn);
  addHat(head, cfg);
  addGlasses(head, cfg);

  return rig;
}

function collar(parent, mat, flat = false) {
  add(parent, new THREE.CylinderGeometry(0.112, 0.124, flat ? 0.045 : 0.07, 24, 1, true, Math.PI * 0.15, Math.PI * 1.7), mat, [0, 0.755, 0]);
  for (const s of [1, -1]) {
    add(parent, new THREE.BoxGeometry(0.07, 0.05, 0.012), mat, [s * 0.045, 0.73, 0.125], [flat ? -0.6 : -0.25, 0, s * 0.6]);
  }
}

function buttons(parent, profile, ys, mat, x = 0) {
  for (const y of ys) add(parent, new THREE.SphereGeometry(0.011, 8, 8), mat, [x, y, radiusAt(profile, y) + 0.004]);
}

function addTie(torso, cfg, profile) {
  if (!TIE_TOPS.includes(cfg.top) || !cfg.tie || cfg.tie === 'none') return;
  const mat = material(cfg.tieColor, { roughness: 0.45, side: THREE.DoubleSide });
  if (cfg.tie === 'bow') {
    for (const s of [1, -1]) {
      add(torso, new THREE.ConeGeometry(0.04, 0.07, 4), mat, [s * 0.035, 0.71, 0.215], [0, 0, s * Math.PI / 2]).scale.set(1, 1, 0.5);
    }
    add(torso, new THREE.SphereGeometry(0.018, 10, 8), mat, [0, 0.71, 0.22]);
    return;
  }
  add(torso, new RoundedBoxGeometry(0.05, 0.045, 0.03, 2, 0.01), mat, [0, 0.705, 0.205]);
  // upper part leans out over the chest, lower part hangs straight
  const z1 = radiusAt(profile, 0.68) + 0.008, z2 = radiusAt(profile, 0.5) + 0.01;
  stick(torso, [0, 0.685, z1], [0, 0.5, z2], 0.026, mat).scale.set(1, 1, 0.25);
  const blade = new THREE.Shape();
  blade.moveTo(-0.03, 0);
  blade.lineTo(0.03, 0);
  blade.lineTo(0.045, -0.17);
  blade.lineTo(0, -0.21);
  blade.lineTo(-0.045, -0.17);
  blade.closePath();
  add(torso, new THREE.ShapeGeometry(blade), mat, [0, 0.505, z2]);
}

function addTop(torso, cfg, mat) {
  const t = cfg.top;
  const profile = { tank: TANK, kurta: KURTA, shirt: SHIRT_TUCKED, blazer: SHIRT_TUCKED }[t] ?? SHIRT;
  const trim = material(shade(cfg.topColor, 0.8));
  const white = material('#f5f5f5');

  if (t === 'blazer') {
    // a white shirt underneath, then the blazer with an open front
    add(torso, lathe(SHIRT_TUCKED), white);
    collar(torso, white);
    add(torso, lathe(BLAZER, 40, 0.28, Math.PI * 2 - 0.56), mat);
    for (const s of [1, -1]) {
      const edge = (y) => [s * Math.sin(0.28) * radiusAt(BLAZER, y), y, Math.cos(0.28) * radiusAt(BLAZER, y)];
      stick(torso, [s * 0.11, 0.72, 0.17], edge(0.36), 0.02, trim).scale.set(1, 1, 0.5); // lapel
    }
    add(torso, new THREE.SphereGeometry(0.014, 8, 8), trim, [Math.sin(0.28) * 0.27, 0.27, Math.cos(0.28) * 0.27 + 0.008]);
    const square = new THREE.Shape();
    square.moveTo(-0.035, 0);
    square.lineTo(0.035, 0);
    square.lineTo(0.02, 0.035);
    square.lineTo(-0.01, 0.025);
    square.closePath();
    const pocket = add(torso, new THREE.ShapeGeometry(square), material(cfg.tieColor ?? '#ef4444', { side: THREE.DoubleSide }), [0.15, 0.5, 0.258]);
    pocket.rotation.y = 0.55;
    addTie(torso, cfg, SHIRT_TUCKED);
    return;
  }

  add(torso, lathe(profile), mat);

  if (t === 'shirt') {
    collar(torso, mat);
    add(torso, new THREE.BoxGeometry(0.035, 0.6, 0.006), trim, [0, 0.42, radiusAt(SHIRT_TUCKED, 0.42)]);
    buttons(torso, SHIRT_TUCKED, [0.66, 0.54, 0.42, 0.3, 0.18], white);
    addTie(torso, cfg, SHIRT_TUCKED);
  } else if (t === 'polo') {
    collar(torso, trim, true);
    buttons(torso, SHIRT, [0.66, 0.6], white);
    add(torso, new THREE.TorusGeometry(0.262, 0.012, 8, 40), trim, [0, 0.04, 0], [Math.PI / 2, 0, 0]);
  } else if (t === 'flannel') {
    collar(torso, mat);
    buttons(torso, SHIRT, [0.64, 0.5, 0.36, 0.22, 0.08], white);
    for (const s of [1, -1]) {
      add(torso, new RoundedBoxGeometry(0.09, 0.09, 0.02, 2, 0.008), mat, [s * 0.11, 0.5, radiusAt(SHIRT, 0.5) - 0.02]).rotation.y = s * 0.38;
    }
  } else if (t === 'tshirt') {
    add(torso, new THREE.TorusGeometry(0.105, 0.016, 8, 32), trim, [0, 0.738, 0], [Math.PI / 2, 0, 0]);
  } else if (t === 'sweater') {
    add(torso, new THREE.TorusGeometry(0.11, 0.028, 8, 32), trim, [0, 0.735, 0], [Math.PI / 2, 0, 0]);
    add(torso, new THREE.TorusGeometry(0.262, 0.022, 8, 40), trim, [0, 0.04, 0], [Math.PI / 2, 0, 0]);
  } else if (t === 'hoodie') {
    add(torso, new THREE.TorusGeometry(0.17, 0.065, 12, 32), mat, [0, 0.7, -0.03], [Math.PI / 2 - 0.35, 0, 0]);
    add(torso, new RoundedBoxGeometry(0.3, 0.13, 0.04, 2, 0.015), trim, [0, 0.17, 0.243]);
    const white = material('#f5f5f5');
    for (const s of [1, -1]) stick(torso, [s * 0.05, 0.66, 0.24], [s * 0.055, 0.5, 0.27], 0.008, white);
  } else if (t === 'jacket') {
    add(torso, new THREE.BoxGeometry(0.13, 0.62, 0.02), material('#f5f5f5'), [0, 0.36, 0.268]);
    for (const s of [1, -1]) {
      const lapel = add(torso, new THREE.BoxGeometry(0.06, 0.24, 0.02), trim, [s * 0.09, 0.58, 0.26]);
      lapel.rotation.z = s * 0.35;
    }
    for (const y of [0.15, 0.3]) add(torso, new THREE.SphereGeometry(0.014, 8, 8), trim, [0.075, y, 0.272]);
  } else if (t === 'kurta') {
    add(torso, new THREE.CylinderGeometry(0.105, 0.11, 0.05, 24, 1, true), trim, [0, 0.755, 0]);
    add(torso, new THREE.BoxGeometry(0.06, 0.3, 0.015), trim, [0, 0.5, 0.272]);
    const gold = material('#d4af37', { metalness: 0.7, roughness: 0.35 });
    for (const y of [0.42, 0.5, 0.58]) add(torso, new THREE.SphereGeometry(0.012, 8, 8), gold, [0, y, 0.282]);
  }
}

function addShoe(leg, cfg, skin) {
  const kind = cfg.shoes;
  const mat = material(cfg.shoesColor);
  const sole = material(kind === 'boots' ? '#2a2a2a' : '#f5f5f5', { roughness: 0.9 });

  if (kind === 'barefoot' || kind === 'sandals') {
    add(leg, new RoundedBoxGeometry(0.14, 0.09, 0.26, 3, 0.04), skin, [0, -0.9, 0.05]);
  }
  if (kind === 'sneakers' || kind === 'boots') {
    add(leg, new RoundedBoxGeometry(0.17, 0.12, 0.3, 3, 0.05), mat, [0, -0.885, 0.055]);
    add(leg, new RoundedBoxGeometry(0.178, 0.04, 0.31, 2, 0.015), sole, [0, -0.93, 0.055]);
    if (kind === 'boots') add(leg, new THREE.CylinderGeometry(0.11, 0.112, 0.24, 20), mat, [0, -0.77, 0]);
    else add(leg, new THREE.BoxGeometry(0.07, 0.012, 0.1), material('#f5f5f5'), [0, -0.822, 0.1]);
  } else if (kind === 'sandals') {
    add(leg, new RoundedBoxGeometry(0.16, 0.03, 0.29, 2, 0.01), mat, [0, -0.935, 0.05]);
    for (const z of [0.0, 0.11]) add(leg, new THREE.BoxGeometry(0.15, 0.02, 0.03), mat, [0, -0.86, z]);
  } else if (kind === 'oxfords' || kind === 'loafers') {
    const polished = material(cfg.shoesColor, { roughness: 0.22, metalness: 0.15 });
    const detail = material(shade(cfg.shoesColor, 0.6), { roughness: 0.3 });
    add(leg, new THREE.CylinderGeometry(0.092, 0.092, 0.08, 16), material('#2b2b2b'), [0, -0.83, 0]); // sock
    add(leg, new RoundedBoxGeometry(0.155, 0.09, 0.3, 3, 0.04), polished, [0, -0.9, 0.06]);
    add(leg, new RoundedBoxGeometry(0.16, 0.022, 0.305, 2, 0.008), material('#1a1a1a'), [0, -0.94, 0.06]);
    if (kind === 'oxfords') add(leg, new THREE.BoxGeometry(0.05, 0.008, 0.08), detail, [0, -0.853, 0.08]);
    else add(leg, new THREE.BoxGeometry(0.14, 0.012, 0.025), detail, [0, -0.855, 0.12]);
  }
}

function addFace(head, cfg, rig) {
  const white = material('#ffffff', { roughness: 0.3 });
  const iris = material(cfg.eyes, { roughness: 0.3 });
  const dark = material('#1a1a1a', { roughness: 0.4 });
  const brow = material(shade(cfg.hairColor, 0.85), { roughness: 0.9 });
  const lift = { smile: 0.0, grin: 0.015, neutral: -0.01, surprised: 0.04 }[cfg.expression] ?? 0;

  for (const s of [1, -1]) {
    const eye = group(head, [s * 0.11, 0.03, 0.27]);
    add(eye, new THREE.SphereGeometry(0.062, 24, 16), white);
    add(eye, new THREE.SphereGeometry(0.038, 20, 12), iris, [0, 0, 0.042]).scale.set(1, 1, 0.6);
    add(eye, new THREE.SphereGeometry(0.02, 12, 8), dark, [0, 0, 0.062]).scale.set(1, 1, 0.5);
    add(eye, new THREE.SphereGeometry(0.009, 8, 6), white, [s * -0.012, 0.014, 0.07]);
    rig.eyes.push(eye);

    const b = add(head, new RoundedBoxGeometry(0.1, 0.022, 0.02, 2, 0.008), brow, [s * 0.11, 0.125 + lift, 0.29]);
    b.rotation.set(-0.3, 0, s * ({ neutral: -0.12, surprised: 0.1 }[cfg.expression] ?? 0.05));

    const blush = add(head, new THREE.CircleGeometry(0.045, 20), material('#ff7a8a', { transparent: true, opacity: 0.35 }), [s * 0.185, -0.07, 0.262]);
    blush.rotation.y = s * 0.6;
  }

  const beard = cfg.facialHair === 'beard';
  const z = beard ? 0.326 : 0.302;
  const mouth = group(head, [0, -0.13, z]);
  mouth.rotation.x = -0.35;
  const lips = material('#8a2f3a', { roughness: 0.5 });
  if (cfg.expression === 'smile') {
    add(mouth, new THREE.TorusGeometry(0.06, 0.013, 8, 24, Math.PI), lips, [0, 0.03, 0], [0, 0, Math.PI]);
  } else if (cfg.expression === 'grin') {
    add(mouth, new THREE.CircleGeometry(0.075, 24, Math.PI, Math.PI), material('#5a1a24'), [0, 0.015, 0]);
    add(mouth, new THREE.BoxGeometry(0.11, 0.022, 0.004), white, [0, 0.004, 0.002]);
  } else if (cfg.expression === 'surprised') {
    add(mouth, new THREE.CircleGeometry(0.03, 20), material('#5a1a24'));
    add(mouth, new THREE.TorusGeometry(0.032, 0.01, 8, 24), lips);
  } else {
    add(mouth, new RoundedBoxGeometry(0.09, 0.016, 0.01, 2, 0.006), lips);
  }

  const fh = material(cfg.hairColor, { roughness: 0.9, side: THREE.DoubleSide });
  if (beard) {
    add(head, new THREE.SphereGeometry(0.334, 40, 16, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.6, Math.PI * 0.34), fh);
  }
  if (cfg.facialHair === 'moustache' || beard) {
    for (const s of [1, -1]) {
      const m = add(head, new THREE.CapsuleGeometry(0.02, 0.06, 4, 8), fh, [s * 0.042, -0.092, z + 0.008]);
      m.rotation.set(0, 0, Math.PI / 2 + s * 0.3);
    }
  }
}

function addHair(head, cfg, mat, hatOn) {
  const style = cfg.hair;
  if (style === 'bald') return;
  const hair = group(head);
  const extras = [];

  const r = style === 'buzz' ? 0.326 : style === 'curly' ? 0.35 : 0.338;
  cap(hair, r, mat, style === 'curly' ? -0.3 : -0.38);
  // back of the head, below the cap
  add(hair, new THREE.SphereGeometry(r, 40, 12, Math.PI, Math.PI, Math.PI / 2, Math.PI * 0.22), mat);

  if (style === 'spiky') {
    for (let i = 0; i < 9; i++) extras.push(spike(hair, onHead(52, i * 40 + 10, 0.31), mat));
    for (const a of [0, 120, 240]) extras.push(spike(hair, onHead(78, a, 0.31), mat));
  } else if (style === 'long') {
    add(hair, new THREE.CylinderGeometry(0.345, 0.38, 0.62, 40, 1, true, Math.PI / 2, Math.PI), mat, [0, -0.25, 0]);
    for (const s of [1, -1]) add(hair, new THREE.CapsuleGeometry(0.06, 0.34, 4, 12), mat, [s * 0.3, -0.18, 0.1]).rotation.z = s * 0.08;
  } else if (style === 'bun') {
    extras.push(add(hair, new THREE.SphereGeometry(0.14, 24, 16), mat, [0, 0.3, -0.17]));
  } else if (style === 'ponytail') {
    add(hair, new THREE.TorusGeometry(0.05, 0.018, 8, 16), material('#ef4444'), [0, 0.1, -0.335]);
    add(hair, new THREE.CapsuleGeometry(0.07, 0.36, 6, 12), mat, [0, -0.14, -0.4]).rotation.x = 0.25;
  } else if (style === 'curly') {
    const curl = new THREE.SphereGeometry(0.1, 16, 12);
    for (const [elev, n] of [[82, 1], [58, 7], [32, 11], [6, 13], [-22, 11]]) {
      for (let i = 0; i < n; i++) {
        const around = (i / n) * 360 + elev;
        const p = onHead(elev, around, 0.34);
        if (p.z > 0.12 && elev < 40) continue; // keep the face clear
        extras.push(add(hair, curl, mat, p.toArray()));
      }
    }
  }
  if (hatOn) extras.forEach((m) => (m.visible = false));
}

function spike(parent, pos, mat) {
  const m = add(parent, new THREE.ConeGeometry(0.075, 0.22, 10), mat);
  const dir = pos.clone().normalize();
  m.position.copy(pos).addScaledVector(dir, 0.09);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return m;
}

function addHat(head, cfg) {
  const kind = cfg.hat;
  if (kind === 'none') return;
  const mat = material(cfg.hatColor, { side: THREE.DoubleSide });
  const band = material(shade(cfg.hatColor, 0.45));
  const hat = group(head);

  if (kind === 'cap') {
    hat.rotation.x = -0.22;
    add(hat, new THREE.SphereGeometry(0.352, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat).scale.set(1, 0.92, 1);
    add(hat, new THREE.CylinderGeometry(0.22, 0.22, 0.022, 32), mat, [0, 0.01, 0.3]).rotation.x = 0.12;
    add(hat, new THREE.SphereGeometry(0.025, 10, 8), band, [0, 0.325, 0]);
  } else if (kind === 'beanie') {
    hat.rotation.x = -0.25;
    add(hat, new THREE.SphereGeometry(0.36, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat).scale.set(1, 1.15, 1);
    add(hat, new THREE.TorusGeometry(0.355, 0.045, 12, 48), band, [0, 0.03, 0], [Math.PI / 2, 0, 0]);
    add(hat, new THREE.SphereGeometry(0.08, 16, 12), band, [0, 0.43, 0]);
  } else if (kind === 'sunhat') {
    hat.rotation.x = -0.12;
    add(hat, new THREE.CylinderGeometry(0.27, 0.31, 0.24, 40), mat, [0, 0.3, 0]);
    add(hat, new THREE.CylinderGeometry(0.56, 0.56, 0.02, 56), mat, [0, 0.185, 0]);
    add(hat, new THREE.CylinderGeometry(0.315, 0.315, 0.055, 40), band, [0, 0.215, 0]);
  } else if (kind === 'tophat') {
    hat.rotation.x = -0.1;
    add(hat, new THREE.CylinderGeometry(0.24, 0.24, 0.42, 40), mat, [0, 0.47, 0]);
    add(hat, new THREE.CylinderGeometry(0.4, 0.4, 0.025, 48), mat, [0, 0.26, 0]);
    add(hat, new THREE.CylinderGeometry(0.245, 0.245, 0.07, 40), band, [0, 0.31, 0]);
  } else if (kind === 'headphones') {
    add(hat, new THREE.TorusGeometry(0.36, 0.024, 12, 48, Math.PI), mat, [0, 0.02, -0.02]);
    for (const s of [1, -1]) {
      add(hat, new THREE.CylinderGeometry(0.1, 0.1, 0.07, 28), mat, [s * 0.35, 0, 0], [0, 0, Math.PI / 2]);
      add(hat, new THREE.CylinderGeometry(0.085, 0.085, 0.03, 28), band, [s * 0.315, 0, 0], [0, 0, Math.PI / 2]);
    }
  }
}

function addGlasses(head, cfg) {
  const kind = cfg.glasses;
  if (kind === 'none') return;
  const frame = material(cfg.glassesColor, { metalness: 0.4, roughness: 0.35 });
  const lens = kind === 'shades'
    ? material('#111318', { metalness: 0.5, roughness: 0.15, side: THREE.DoubleSide })
    : material('#cfe8ff', { transparent: true, opacity: 0.18, roughness: 0.05 });
  const g = group(head, [0, 0.03, 0.36]);

  for (const s of [1, -1]) {
    const x = s * 0.11;
    if (kind === 'square') {
      add(g, new THREE.TorusGeometry(0.08, 0.011, 6, 4), frame, [x, 0, 0], [0, 0, Math.PI / 4]).scale.set(1.15, 0.85, 1);
      add(g, new THREE.CircleGeometry(0.075, 4), lens, [x, 0, -0.003], [0, 0, Math.PI / 4]).scale.set(1.15, 0.85, 1);
    } else {
      add(g, new THREE.TorusGeometry(0.068, 0.011, 8, 28), frame, [x, 0, 0]).scale.x = kind === 'shades' ? 1.15 : 1;
      add(g, new THREE.CircleGeometry(0.066, 28), lens, [x, 0, -0.003]).scale.x = kind === 'shades' ? 1.15 : 1;
    }
    stick(g, [s * 0.185, 0.01, -0.01], [s * 0.315, 0.01, -0.35], 0.007, frame); // arm to the ear
  }
  stick(g, [-0.04, 0.012, 0.005], [0.04, 0.012, 0.005], 0.008, frame); // bridge
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
