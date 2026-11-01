// The 3D stage: renderer, lights, camera controls and the pose animations.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAvatar, disposeAvatar } from './avatar.js';
import { poseAt, applyPose, JOINTS } from './poses.js';

function setupLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f99, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 5, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.5;
  key.shadow.camera.right = key.shadow.camera.top = 1.5;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9a6ff, 1.2);
  rim.position.set(-3, 3, -3);
  scene.add(rim);
}

function makeRenderer(canvas, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function makeScene(renderer) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  setupLights(scene);

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.8, 0.06, 64),
    new THREE.MeshStandardMaterial({ color: 0xe6e1f2, roughness: 0.9 }),
  );
  stage.position.y = -0.03;
  stage.receiveShadow = true;
  scene.add(stage);
  return scene;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas, canvas.clientWidth, canvas.clientHeight);
    this.scene = makeScene(this.renderer);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.autoRotateSpeed = 1.6;
    this.resetCamera();

    this.pose = 'idle';
    this.clock = new THREE.Clock();
    this.nextBlink = 2;
    this.rig = null;

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  closeUp() {
    this.camera.position.set(0.28, 1.66, 0.95);
    this.controls.target.set(0, 1.58, 0);
    this.controls.update();
  }

  resetCamera() {
    this.camera.position.set(1.1, 1.35, 4.3);
    this.controls.target.set(0, 0.92, 0);
    this.controls.update();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setAvatar(config) {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeAvatar(this.rig);
    }
    const old = this.rig;
    this.rig = buildAvatar(config);
    // keep the current pose angles so changing clothes doesn't make the avatar "snap"
    if (old) for (const k of JOINTS) {
      this.rig[k].position.copy(old[k].position);
      this.rig[k].rotation.copy(old[k].rotation);
    }
    this.scene.add(this.rig.root);
  }

  /** PNG of the current view. */
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    if (this.rig) this.animate(t, dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  animate(t, dt) {
    const r = this.rig;
    applyPose(r, poseAt(this.pose, t), 1 - Math.exp(-dt * 10)); // ease towards the pose
    r.torso.scale.y = 1 + 0.008 * Math.sin(t * 2.2); // breathing

    // blink every few seconds
    const blink = t > this.nextBlink && t < this.nextBlink + 0.13;
    if (t > this.nextBlink + 0.13) this.nextBlink = t + 2 + Math.random() * 3;
    for (const e of r.eyes) e.scale.y = blink ? 0.1 : 1;
  }
}
/** Render small preview images of configs, for the "choose an avatar" cards. */
export function renderThumbnails(configs, size = 192) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = makeRenderer(canvas, size, size);
  renderer.setPixelRatio(1);
  const scene = makeScene(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0.35, 1.38, 2.45);
  camera.lookAt(0, 1.18, 0);

  const urls = configs.map((cfg) => {
    const rig = buildAvatar(cfg);
    applyPose(rig, poseAt('idle', 0));
    rig.head.rotation.y = 0.2;
    scene.add(rig.root);
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    scene.remove(rig.root);
    disposeAvatar(rig);
    return url;
  });
  renderer.dispose();
  renderer.forceContextLoss();
  return urls;
}
