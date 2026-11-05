// The 3D stage: loads a rigged character (GLB), plays its motion-captured moves, drives facial
// expressions through morph targets, blinks, keeps eye contact with the camera, and renders with
// studio lighting and ambient occlusion.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EXPRESSIONS } from './catalog.js';

const BLINK_UNITS = ['eye-left-closure', 'eye-right-closure'];
const NOT_CLOTHES = /^(Body|Eyes|Eyebrows|Eyelashes|Teeth|Tongue|Hair)/;
// moves calm enough for the character to hold eye contact with the viewer
const EYE_CONTACT = new Set(['Idle', 'Talk', 'Wave', 'Argue', 'Happy']);

function setupLights(scene) {
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
  key.position.set(1.8, 3.2, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
  key.shadow.camera.right = key.shadow.camera.top = 1.2;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc9b8ff, 0.9);
  rim.position.set(-1.5, 2.5, -3);
  scene.add(rim);
}

/** Which garment a mesh belongs to: its own name, or its parent's for multi-material meshes. */
const meshLabel = (o) => (o.name && !/^mesh_\d|_\d+$/.test(o.name) ? o.name : o.parent?.name ?? o.name);

/**
 * MakeHuman materials come through as alpha-blended, which makes skin see-through and sorts hair badly.
 * Hair, brows and lashes become cut-out strands; everything else is solid. The eyes keep their
 * transparent outer layer (cornea).
 */
/**
 * Fine skin-surface detail (pores and micro creases) as a small tiling normal map, generated once.
 * MakeHuman skins only have a colour texture, so without this skin reads as smooth plastic.
 */
let poreMap;
function skinDetail() {
  if (poreMap) return poreMap;
  const N = 256;
  const h = new Float32Array(N * N);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) { // pores: small soft dimples
    const cx = rand() * N, cy = rand() * N, r = 0.8 + rand() * 1.6, d = 0.4 + rand() * 0.6;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const px = (Math.floor(cx) + x + N) % N, py = (Math.floor(cy) + y + N) % N;
      const dist = Math.hypot(x + (cx % 1) - 0.5, y + (cy % 1) - 0.5);
      if (dist < r * 2) h[py * N + px] -= d * Math.exp(-(dist * dist) / (r * r));
    }
  }
  for (let i = 0; i < N * N; i++) h[i] += (rand() - 0.5) * 0.25; // fine grain
  poreMap = heightToNormalMap(h, N, 24);
  return poreMap;
}

/** Turns a tiling height field into a repeating tangent-space normal map. */
function heightToNormalMap(h, N, repeat, strength = 1) {
  const img = new Uint8ClampedArray(N * N * 4);
  const at = (xx, yy) => h[((yy + N) % N) * N + ((xx + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const n = new THREE.Vector3(-dx, -dy, 2).normalize();
    const i = (y * N + x) * 4;
    img[i] = (n.x * 0.5 + 0.5) * 255;
    img[i + 1] = (n.y * 0.5 + 0.5) * 255;
    img[i + 2] = (n.z * 0.5 + 0.5) * 255;
    img[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(img, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Woven cloth: a 2/2 twill (the diagonal weave of suiting and denim) with rounded yarns and slight
 * thread-to-thread irregularity, so light picks out the weave up close and it fades to flat far away.
 * MakeHuman clothes have only a colour texture.
 */
let weaveMap;
function fabricDetail() {
  if (weaveMap) return weaveMap;
  const N = 128, T = 16, W = N / T; // 16 threads each way per tile
  const h = new Float32Array(N * N);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jitter = Array.from({ length: T * 2 }, () => 0.75 + rand() * 0.5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const tx = Math.floor(x / W), ty = Math.floor(y / W);
    const fx = (x % W + 0.5) / W, fy = (y % W + 0.5) / W;
    const warpUp = ((tx + ty) % 4) < 2; // 2 over, 2 under, stepping one thread per row: the twill diagonal
    const warp = Math.sin(Math.PI * fx) * jitter[tx], weft = Math.sin(Math.PI * fy) * jitter[T + ty];
    h[y * N + x] = (warpUp ? warp * (0.6 + 0.4 * Math.sin(Math.PI * fy)) : weft * (0.6 + 0.4 * Math.sin(Math.PI * fx))) + (rand() - 0.5) * 0.15;
  }
  weaveMap = heightToNormalMap(h, N, 70, 1.4);
  return weaveMap;
}

/** Leather: soft irregular pebble grain for shoes. */
let grainMap;
function leatherDetail() {
  if (grainMap) return grainMap;
  const N = 128;
  const h = new Float32Array(N * N);
  let seed = 23;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    const cx = rand() * N, cy = rand() * N, r = 1.5 + rand() * 2.5;
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const px = (Math.floor(cx) + x + N) % N, py = (Math.floor(cy) + y + N) % N;
      const d = Math.hypot(x, y);
      if (d < r * 2.5) h[py * N + px] += 0.5 * Math.exp(-(d * d) / (r * r));
    }
  }
  grainMap = heightToNormalMap(h, N, 30, 0.6);
  return grainMap;
}

function fixMaterial(o) {
  const label = meshLabel(o);
  const src = o.material;
  // physically based material with sheen: soft velvety highlight on skin, fabric and hair
  const m = new THREE.MeshPhysicalMaterial({
    name: src.name, map: src.map, normalMap: src.normalMap, normalScale: src.normalScale, color: src.color,
    roughness: src.roughness, metalness: 0, roughnessMap: src.roughnessMap, side: src.side,
    // ambient occlusion baked in Blender (eye sockets, nostrils, lips, collars, cuffs, folds): it only
    // darkens ambient and environment light, as real contact shadow does
    aoMap: src.aoMap, aoMapIntensity: 1,
  });
  if (/^Hair/.test(label)) {
    // matte strands with a faint highlight, not a shiny helmet; alpha-to-coverage (with the
    // multisampled render) gives the strand tips soft edges instead of a hard cut-out
    Object.assign(m, { alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.78, sheen: 0.12, sheenRoughness: 0.5, specularIntensity: 0.25 });
    m.sheenColor.copy(src.color).multiplyScalar(0.6);
  } else if (/^(Eyebrows|Eyelashes)/.test(label)) {
    // brow and lash textures are all soft, partial alpha (individual fine hairs): blend them over the
    // skin rather than cutting them at a threshold, which turned brows into solid painted strokes
    // (their alpha is faint, so it is strengthened: dense in the middle, wispy at the ends)
    Object.assign(m, { transparent: true, depthWrite: false, alphaTest: 0.01, side: THREE.DoubleSide, roughness: 0.9, specularIntensity: 0 });
    if (src.map && !src.userData.boosted) {
      m.map = featheredAlpha(src.map, 0, /^Eyebrows/.test(label) ? 2.2 : 1.6);
      m.userData.boosted = true;
    }
    o.renderOrder = 2;
  } else if (/^Eyes/.test(label)) {
    // the eye texture's clear part is the cornea in front of the iris
    Object.assign(m, { alphaTest: 0.5, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
  } else if (/^Body/.test(label)) {
    Object.assign(m, { roughness: 0.5, sheen: 0.3, sheenRoughness: 0.75, specularIntensity: 0.5, normalMap: skinDetail() });
    m.normalScale.set(0.35, 0.35);
    m.sheenColor.set(0xff9e86);
  } else if (/^(Teeth|Tongue)/.test(label)) {
    Object.assign(m, { roughness: 0.35, clearcoat: 0.4 });
  } else if (/shoe|boot/i.test(label)) {
    // leather: smoother and glossier than cloth, with a fine grain
    Object.assign(m, { roughness: 0.45, roughnessMap: null, clearcoat: 0.3, clearcoatRoughness: 0.35, specularIntensity: 0.6, normalMap: src.normalMap ?? leatherDetail() });
    m.normalScale.set(0.4, 0.4);
  } else {
    // fabric: matte with a soft sheen at grazing angles and a woven surface, like real cloth
    Object.assign(m, { roughness: 0.82, roughnessMap: null, sheen: 0.6, sheenRoughness: 0.85, specularIntensity: 0.3, normalMap: src.normalMap ?? fabricDetail() });
    m.normalScale.set(0.5, 0.5);
    m.sheenColor.copy(src.color).lerp(new THREE.Color(0xffffff), 0.5).multiplyScalar(0.5);
  }
  src.dispose();
  o.material = m;
}

/** A copy of a texture whose alpha is slightly blurred (and optionally strengthened), for soft strand edges. */
function featheredAlpha(tex, px = 3, gain = 1) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.filter = `blur(${px}px)`;
  g.drawImage(img, 0, 0);
  const blurred = g.getImageData(0, 0, c.width, c.height);
  g.filter = 'none';
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  const sharp = g.getImageData(0, 0, c.width, c.height);
  // keep the sharp colour, take only the softened alpha
  for (let i = 3; i < sharp.data.length; i += 4) sharp.data[i] = Math.min(255, blurred.data[i] * gain);
  g.putImageData(sharp, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = tex.colorSpace;
  t.flipY = tex.flipY;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.channel = tex.channel;
  t.anisotropy = 8;
  return t;
}

/**
 * Hair in two passes, the usual real-time hair technique: the solid core is drawn opaque (correct
 * depth, no sorting problems), then a blended pass draws only the soft strand edges around it.
 */
function addHairTips(o) {
  const tips = o.clone();
  const m = o.material.clone();
  Object.assign(m, { map: featheredAlpha(o.material.map), alphaTest: 0.02, alphaToCoverage: false, transparent: true, depthWrite: false });
  tips.material = m;
  tips.name = 'HairTips';
  tips.renderOrder = 1;
  tips.castShadow = false;
  o.parent.add(tips);
  return tips;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping; // natural skin tones, soft highlight roll-off
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // a real photographed studio (Poly Haven, CC0) lights the character with soft boxes
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    new RGBELoader().load('assets/studio_small_09_1k.hdr', (hdr) => {
      this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
      this.scene.environmentIntensity = 0.9;
      hdr.dispose();
      pmrem.dispose();
    });
    setupLights(this.scene);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.04, 64), new THREE.MeshStandardMaterial({ color: 0x2a2738, roughness: 0.6 }));
    disc.position.y = -0.021;
    disc.receiveShadow = true;
    this.scene.add(disc);

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.autoRotateSpeed = 1.4;
    this.resetCamera();

    // post-processing: multisampled render, ambient occlusion in folds and contacts, then tone mapping
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());

    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.clock = new THREE.Clock();
    this.gltf = null;
    this.character = null;
    this.mixer = null;
    this.actions = {};
    this.move = 'Idle';
    this.expression = 'Neutral';
    this.morphMeshes = [];
    this.current = {}; // face unit -> current weight, eased towards the expression
    this.nextBlink = 1.5;
    this.tint = null;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.renderer.setAnimationLoop(() => this.frame());
    window.avatarStage = this; // handy from the browser console
  }

  resetCamera() {
    this.camera.position.set(0.9, 1.25, 4.4);
    this.controls.target.set(0, 0.92, 0);
    this.controls.update();
  }

  closeUp() {
    const head = this.character?.getObjectByName('mixamorigHead');
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y + 0.07 : 1.6;
    this.camera.position.set(0.16, y + 0.02, 0.75);
    this.controls.target.set(0, y, 0);
    this.controls.update();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(url, onProgress) {
    if (!this.cache.has(url)) {
      this.cache.set(url, this.loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total)));
    }
    let gltf;
    try {
      gltf = await this.cache.get(url);
    } catch (e) {
      this.cache.delete(url);
      throw e;
    }
    if (this.character) this.scene.remove(this.character);
    this.gltf = gltf;
    this.character = gltf.scene;
    this.morphMeshes = [];
    const hair = [];
    this.character.traverse((o) => {
      if (!o.isMesh || o.name === 'HairTips') return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned meshes move outside their rest-pose bounds
      fixMaterial(o);
      o.userData.baseColor ??= o.material.color.clone();
      if (o.morphTargetDictionary) this.morphMeshes.push(o);
      if (/^Hair/.test(meshLabel(o)) && o.material.map) hair.push(o);
    });
    for (const o of hair) if (!o.userData.tips) o.userData.tips = addHairTips(o);
    this.mixer?.stopAllAction();
    this.mixer = new THREE.AnimationMixer(this.character);
    this.head = this.character.getObjectByName('mixamorigHead');
    this.gaze = 0;
    if (this.head) {
      // which way the head faces at rest (the character faces +Z), in the head bone's own frame
      this.character.updateMatrixWorld(true);
      this.headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    this.setupEyes();
    this.actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
    this.scene.add(this.character);
    this.applyTint(this.tint);
    this.current = {};
    this.playMove(this.move, 0);
    return gltf;
  }

  get moves() {
    return this.gltf ? this.gltf.animations.map((c) => c.name) : [];
  }

  playMove(name, fade = 0.6) {
    const next = this.actions[name] ?? this.actions.Idle;
    if (!next) return;
    const prev = this.actions[this.move];
    this.move = this.actions[name] ? name : 'Idle';
    for (const a of Object.values(this.actions)) if (a !== next && a !== prev) a.stop();
    next.reset().setEffectiveWeight(1).play();
    // a smooth hand-over from the move being played, long enough that big pose changes don't snap
    if (prev && prev !== next && fade > 0) next.crossFadeFrom(prev, fade, false);
    else if (prev && prev !== next) prev.stop();
  }

  /** Recolour the clothes (multiplies their fabric texture), or restore them with null. */
  applyTint(hex) {
    this.tint = hex;
    this.character?.traverse((o) => {
      if (!o.isMesh || NOT_CLOTHES.test(meshLabel(o))) return;
      o.material.color.copy(o.userData.baseColor);
      if (hex) o.material.color.multiply(new THREE.Color(hex)).multiplyScalar(1.5);
    });
  }

  snapshot() {
    this.composer.render();
    return this.canvas.toDataURL('image/png');
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.mixer?.update(dt);
    this.updateGaze(dt);
    this.updateEyes(this.clock.elapsedTime, dt);
    this.updateFace(this.clock.elapsedTime, dt);
    this.controls.update();
    this.composer.render();
  }

  /** Turn the head a little towards the viewer during calm moves, like natural eye contact. */
  updateGaze(dt) {
    const head = this.head;
    if (!head) return;
    const want = EYE_CONTACT.has(this.move) ? 1 : 0;
    this.gaze += (want - this.gaze) * (1 - Math.exp(-dt * 3));
    if (this.gaze < 0.01) return;
    head.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
    const world = head.getWorldQuaternion(new THREE.Quaternion());
    const facing = this.headForward.clone().applyQuaternion(world);
    const toCam = this.camera.position.clone().sub(pos).normalize();
    if (facing.dot(toCam) < 0.2) return; // viewer is behind or far to the side
    const turn = new THREE.Quaternion().setFromUnitVectors(facing, toCam);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    const limit = THREE.MathUtils.degToRad(28);
    const amount = (angle > limit ? limit / angle : 1) * 0.65 * this.gaze;
    const target = new THREE.Quaternion().slerp(turn, amount).multiply(world);
    const parent = head.parent.getWorldQuaternion(new THREE.Quaternion());
    head.quaternion.copy(parent.invert().multiply(target));
  }

  /**
   * The eyes' own frame in the head bone, taken from the bind pose (so it doesn't depend on the pose
   * the character was in when loaded): eye centre, and the head's forward, left and up directions.
   */
  setupEyes() {
    this.eyes = null;
    const mesh = this.character.getObjectByName('Eyes');
    const dict = mesh?.morphTargetDictionary;
    if (!this.head || !dict || dict['eyes-look-left'] === undefined) return;
    const bi = mesh.skeleton.bones.indexOf(this.head);
    if (bi < 0) return;
    const inv = mesh.skeleton.boneInverses[bi]; // mesh space -> head bone space, at bind
    mesh.geometry.computeBoundingBox();
    const centre = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    const rot = new THREE.Matrix3().setFromMatrix4(inv);
    const dir = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix3(rot).normalize();
    this.eyes = {
      mesh, centre, forward: dir(0, 0, 1), left: dir(1, 0, 0), up: dir(0, 1, 0),
      keys: ['eyes-look-left', 'eyes-look-right', 'eyes-look-up', 'eyes-look-down'].map((k) => dict[k]),
      yaw: 0, pitch: 0, dart: new THREE.Vector2(), nextDart: 0,
    };
  }

  /**
   * Eyes: they look at the viewer during eye contact (the head only turns part of the way), and make
   * small quick darts (saccades) every so often, as living eyes never hold perfectly still.
   */
  updateEyes(t, dt) {
    const e = this.eyes;
    if (!e) return;
    if (t > e.nextDart) {
      const r = this.gaze > 0.5 ? 1.8 : 5; // small darts while holding eye contact, wider when looking around
      e.dart.set((Math.random() * 2 - 1) * r, (Math.random() * 2 - 1) * r * 0.6);
      e.nextDart = t + 0.5 + Math.random() * 2.3;
    }
    let yaw = e.dart.x, pitch = e.dart.y;
    if (this.gaze > 0.01) {
      this.head.updateWorldMatrix(true, false);
      const eyePos = e.centre.clone().applyMatrix4(this.head.matrixWorld);
      const local = this.camera.position.clone().sub(eyePos)
        .applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
      const f = local.dot(e.forward);
      if (f > 0.3) {
        yaw += THREE.MathUtils.radToDeg(Math.atan2(local.dot(e.left), f)) * this.gaze;
        pitch += THREE.MathUtils.radToDeg(Math.atan2(local.dot(e.up), f)) * this.gaze;
      }
    }
    yaw = THREE.MathUtils.clamp(yaw, -25, 25);
    pitch = THREE.MathUtils.clamp(pitch, -20, 20);
    const k = 1 - Math.exp(-dt * 28); // eye movements are fast
    e.yaw += (yaw - e.yaw) * k;
    e.pitch += (pitch - e.pitch) * k;
    const w = e.mesh.morphTargetInfluences;
    const [l, r, u, d] = e.keys;
    w[l] = Math.max(0, e.yaw) / 25;
    w[r] = Math.max(0, -e.yaw) / 25;
    w[u] = Math.max(0, e.pitch) / 20;
    w[d] = Math.max(0, -e.pitch) / 20;
  }

  updateFace(t, dt) {
    if (!this.morphMeshes.length) return;
    const target = { ...(EXPRESSIONS[this.expression] ?? {}) };
    // blink every few seconds, unless the expression is already closing an eye
    let blink = 0;
    if (!target['eye-left-closure'] && !target['eye-right-closure']) {
      if (t > this.nextBlink + 0.18) this.nextBlink = t + 2.2 + Math.random() * 3.5;
      if (t > this.nextBlink) blink = Math.sin(((t - this.nextBlink) / 0.18) * Math.PI);
    }
    const k = 1 - Math.exp(-dt * 9);
    for (const u of new Set([...Object.keys(this.current), ...Object.keys(target), ...BLINK_UNITS])) {
      const eased = (this.current[u] ?? 0) + ((target[u] ?? 0) - (this.current[u] ?? 0)) * k;
      this.current[u] = eased;
      const v = BLINK_UNITS.includes(u) ? Math.min(1, Math.max(eased, blink)) : eased;
      for (const m of this.morphMeshes) {
        const i = m.morphTargetDictionary[u];
        if (i !== undefined) m.morphTargetInfluences[i] = v;
      }
    }
  }
}
