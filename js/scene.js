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
  const img = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const at = (xx, yy) => h[((yy + N) % N) * N + ((xx + N) % N)];
    const dx = at(x + 1, y) - at(x - 1, y), dy = at(x, y + 1) - at(x, y - 1);
    const n = new THREE.Vector3(-dx, -dy, 2).normalize();
    const i = (y * N + x) * 4;
    img[i] = (n.x * 0.5 + 0.5) * 255;
    img[i + 1] = (n.y * 0.5 + 0.5) * 255;
    img[i + 2] = (n.z * 0.5 + 0.5) * 255;
    img[i + 3] = 255;
  }
  poreMap = new THREE.DataTexture(img, N, N, THREE.RGBAFormat);
  poreMap.wrapS = poreMap.wrapT = THREE.RepeatWrapping;
  poreMap.repeat.set(24, 24);
  poreMap.generateMipmaps = true;
  poreMap.minFilter = THREE.LinearMipmapLinearFilter;
  poreMap.needsUpdate = true;
  return poreMap;
}

function fixMaterial(o) {
  const label = meshLabel(o);
  const src = o.material;
  // physically based material with sheen: soft velvety highlight on skin, fabric and hair
  const m = new THREE.MeshPhysicalMaterial({
    name: src.name, map: src.map, normalMap: src.normalMap, normalScale: src.normalScale, color: src.color,
    roughness: src.roughness, metalness: 0, roughnessMap: src.roughnessMap, side: src.side,
  });
  if (/^Hair/.test(label)) {
    // matte strands with a faint highlight, not a shiny helmet
    Object.assign(m, { alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.78, sheen: 0.12, sheenRoughness: 0.5, specularIntensity: 0.25 });
    m.sheenColor.copy(src.color).multiplyScalar(0.6);
  } else if (/^(Eyebrows|Eyelashes)/.test(label)) {
    Object.assign(m, { alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9, specularIntensity: 0 });
  } else if (/^Eyes/.test(label)) {
    // the eye texture's clear part is the cornea in front of the iris
    Object.assign(m, { alphaTest: 0.5, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
  } else if (/^Body/.test(label)) {
    Object.assign(m, { roughness: 0.5, sheen: 0.3, sheenRoughness: 0.75, specularIntensity: 0.5, normalMap: skinDetail() });
    m.normalScale.set(0.35, 0.35);
    m.sheenColor.set(0xff9e86);
  } else if (/^(Teeth|Tongue)/.test(label)) {
    Object.assign(m, { roughness: 0.35, clearcoat: 0.4 });
  } else {
    // fabric: matte with a soft sheen at grazing angles, like real cloth
    Object.assign(m, { roughness: 0.82, roughnessMap: null, sheen: 0.6, sheenRoughness: 0.85, specularIntensity: 0.3 });
    m.sheenColor.copy(src.color).lerp(new THREE.Color(0xffffff), 0.5).multiplyScalar(0.5);
  }
  src.dispose();
  o.material = m;
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
    this.character.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned meshes move outside their rest-pose bounds
      fixMaterial(o);
      o.userData.baseColor ??= o.material.color.clone();
      if (o.morphTargetDictionary) this.morphMeshes.push(o);
    });
    this.mixer?.stopAllAction();
    this.mixer = new THREE.AnimationMixer(this.character);
    this.head = this.character.getObjectByName('mixamorigHead');
    this.gaze = 0;
    if (this.head) {
      // which way the head faces at rest (the character faces +Z), in the head bone's own frame
      this.character.updateMatrixWorld(true);
      this.headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
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

  playMove(name, fade = 0.35) {
    const next = this.actions[name] ?? this.actions.Idle;
    if (!next) return;
    this.move = this.actions[name] ? name : 'Idle';
    for (const a of Object.values(this.actions)) if (a !== next) a.fadeOut(fade);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
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
