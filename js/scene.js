// The 3D stage: renderer, lights, camera controls and the pose animations.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAvatar, disposeAvatar } from './avatar.js';

function setupLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f99, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 5, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -2;
  key.shadow.camera.right = key.shadow.camera.top = 2;
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
    new THREE.CylinderGeometry(1.05, 1.12, 0.08, 64),
    new THREE.MeshStandardMaterial({ color: 0xe6e1f2, roughness: 0.9 }),
  );
  stage.position.y = -0.04;
  stage.receiveShadow = true;
  scene.add(stage);
  return scene;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas, canvas.clientWidth, canvas.clientHeight);
    this.scene = makeScene(this.renderer);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
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

  resetCamera() {
    this.camera.position.set(1.5, 1.8, 5.8);
    this.controls.target.set(0, 1.1, 0);
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
    if (old) for (const k of ['hips', 'head', 'armL', 'armR', 'legL', 'legR']) {
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
    const k = 1 - Math.exp(-dt * 10); // smooth blend towards each pose
    const to = (obj, prop, axis, value) => (obj[prop][axis] += (value - obj[prop][axis]) * k);

    // pose targets: arm/leg angles, hip height & turn, head angles
    let armL = 0.12 + 0.03 * Math.sin(t * 1.4), armR = armL, armLx = 0, armRx = 0;
    let legL = 0, legR = 0, hipY = 0.95, hipTurn = 0, headY = 0.18 * Math.sin(t * 0.5), headX = 0, headZ = 0.04 * Math.sin(t * 0.8);

    if (this.pose === 'wave') {
      armR = 2.55 + 0.35 * Math.sin(t * 9);
      headZ = -0.12;
      headY = 0.1;
    } else if (this.pose === 'dance') {
      const b = t * 5;
      armL = 1.2 + 0.7 * Math.sin(b);
      armR = 1.2 + 0.7 * Math.sin(b + Math.PI);
      armLx = armRx = -0.3;
      legL = 0.3 * Math.sin(b);
      legR = -0.3 * Math.sin(b);
      hipY = 0.95 + 0.05 * Math.abs(Math.sin(b));
      hipTurn = 0.35 * Math.sin(t * 2.5);
      headX = 0.12 * Math.sin(b * 2);
      headZ = 0.1 * Math.sin(b);
    } else if (this.pose === 'jump') {
      const p = (t * 1.1) % 1;
      const h = Math.max(0, Math.sin(p * Math.PI * 1.25));
      hipY = 0.95 + h * 0.38;
      armL = armR = 0.15 + h * 2.4;
      legL = -h * 0.35;
      legR = h * 0.35;
      headX = -h * 0.2;
    } else if (this.pose === 'think') {
      armR = 0.5;
      armRx = -2.2;
      headZ = 0.15;
      headY = -0.25;
      headX = -0.12;
    }

    to(r.armL, 'rotation', 'z', armL);
    to(r.armR, 'rotation', 'z', -armR);
    to(r.armL, 'rotation', 'x', armLx);
    to(r.armR, 'rotation', 'x', armRx);
    to(r.legL, 'rotation', 'x', legL);
    to(r.legR, 'rotation', 'x', legR);
    to(r.hips, 'position', 'y', hipY);
    to(r.hips, 'rotation', 'y', hipTurn);
    to(r.head, 'rotation', 'y', headY);
    to(r.head, 'rotation', 'x', headX);
    to(r.head, 'rotation', 'z', headZ);
    r.torso.scale.y = 1 + 0.012 * Math.sin(t * 2.2); // breathing

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
  camera.position.set(0.6, 1.75, 3.6);
  camera.lookAt(0, 1.55, 0);

  const urls = configs.map((cfg) => {
    const rig = buildAvatar(cfg);
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
