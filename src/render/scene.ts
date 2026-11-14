import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraMode = 'isometric' | 'top' | 'perspective';

export type CameraRig = {
  readonly camera: THREE.Camera;
  setMode: (mode: CameraMode) => void;
  getMode: () => CameraMode;
  setInputLocked: (locked: boolean) => void;
  update: () => void;
};

export type SceneCtx = {
  scene: THREE.Scene;
  cameraRig: CameraRig;
  renderer: THREE.WebGLRenderer;
};

export function createScene(
  canvas: HTMLCanvasElement,
  worldW: number,
  worldH: number,
): SceneCtx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);

  const center = new THREE.Vector3(worldW / 2, 0, worldH / 2);
  const viewSize = Math.max(worldW, worldH) * 1.3;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);

  const isometric = new THREE.OrthographicCamera(
    (-viewSize * aspect) / 2,
    (viewSize * aspect) / 2,
    viewSize / 2,
    -viewSize / 2,
    0.1,
    300,
  );
  isometric.position.set(worldW, 20, worldH + 10);
  isometric.lookAt(center);

  const top = new THREE.OrthographicCamera(
    (-viewSize * aspect) / 2,
    (viewSize * aspect) / 2,
    viewSize / 2,
    -viewSize / 2,
    0.1,
    300,
  );
  top.up.set(0, 0, -1);
  top.position.set(center.x, 32, center.z);
  top.lookAt(center);

  const perspective = new THREE.PerspectiveCamera(48, aspect, 0.1, 500);
  perspective.position.set(center.x + 13, 15, center.z + 19);
  perspective.lookAt(center);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight(0xdce5ff, 0x252936, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 1.45);
  sun.position.set(worldW * 0.8, 28, worldH * 0.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -worldW;
  sun.shadow.camera.right = worldW;
  sun.shadow.camera.top = worldH;
  sun.shadow.camera.bottom = -worldH;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  const cameras: Record<CameraMode, THREE.Camera> = { isometric, top, perspective };
  const controls: Record<CameraMode, OrbitControls> = {
    isometric: new OrbitControls(isometric, renderer.domElement),
    top: new OrbitControls(top, renderer.domElement),
    perspective: new OrbitControls(perspective, renderer.domElement),
  };

  for (const control of Object.values(controls)) {
    control.target.copy(center);
    control.enableDamping = true;
    control.dampingFactor = 0.08;
    control.enablePan = true;
    control.enabled = false;
    control.screenSpacePanning = false;
    control.update();
  }
  controls.isometric.minZoom = 0.65;
  controls.isometric.maxZoom = 2.6;
  controls.isometric.enableRotate = true;
  controls.isometric.enabled = true;
  controls.top.minZoom = 0.65;
  controls.top.maxZoom = 3.2;
  controls.top.enableRotate = false;
  controls.perspective.minDistance = 7;
  controls.perspective.maxDistance = 55;
  controls.perspective.maxPolarAngle = Math.PI * 0.48;

  let activeMode: CameraMode = 'isometric';
  const cameraRig: CameraRig = {
    get camera() {
      return cameras[activeMode];
    },
    setMode(mode) {
      controls[activeMode].enabled = false;
      activeMode = mode;
      controls[activeMode].enabled = true;
      controls[activeMode].update();
    },
    getMode() {
      return activeMode;
    },
    setInputLocked(locked) {
      const control = controls[activeMode];
      control.enableRotate = !locked && activeMode !== 'top';
      control.enablePan = !locked;
    },
    update() {
      controls[activeMode].update();
    },
  };

  const resize = () => {
    const a = window.innerWidth / Math.max(1, window.innerHeight);
    for (const camera of [isometric, top]) {
      camera.left = (-viewSize * a) / 2;
      camera.right = (viewSize * a) / 2;
      camera.top = viewSize / 2;
      camera.bottom = -viewSize / 2;
      camera.updateProjectionMatrix();
    }
    perspective.aspect = a;
    perspective.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  return { scene, cameraRig, renderer };
}
