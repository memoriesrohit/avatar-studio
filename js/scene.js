// The 3D stage: loads a rigged character (GLB), plays its moves, drives facial expressions
// through morph targets, blinks, and frames the camera.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXPRESSIONS } from './catalog.js';

const BLINK_UNITS = ['eye-left-closure', 'eye-right-closure'];
const NOT_CLOTHES = /^(Body|Eyes|Eyebrows|Eyelashes|Teeth|Tongue|Hair)/;

function setupLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x6d6680, 0.55));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
  key.position.set(1.8, 3.2, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
  key.shadow.camera.right = key.shadow.camera.top = 1.2;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  fill.position.set(-2.5, 1.6, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc9b8ff, 1.3);
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
function fixMaterial(o) {
  const label = meshLabel(o);
  const m = o.material;
  if (/^(Hair|Eyebrows|Eyelashes)/.test(label)) {
    Object.assign(m, { transparent: false, alphaTest: 0.35, depthWrite: true, side: THREE.DoubleSide });
  } else if (/^Eyes/.test(label)) {
    // the eye texture's clear part is the cornea in front of the iris
    Object.assign(m, { transparent: false, alphaTest: 0.5, depthWrite: true, roughness: 0.15 });
  } else {
    Object.assign(m, { transparent: false, alphaTest: 0, depthWrite: true });
    if (/^Body/.test(label)) m.alphaMap = null;
    if (/^Clothes/.test(label)) Object.assign(m, { roughness: 0.8, metalness: 0, roughnessMap: null, metalnessMap: null });
  }
  m.needsUpdate = true;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
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
    this.camera.position.set(0.9, 1.25, 3.9);
    this.controls.target.set(0, 0.9, 0);
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
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.mixer?.update(dt);
    this.updateFace(this.clock.elapsedTime, dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
