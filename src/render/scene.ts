import * as THREE from 'three';
import type { CameraMode } from '../ui/menu';

export type CameraRig = {
  getCamera: () => THREE.Camera;
  getMode: () => CameraMode;
  setMode: (mode: CameraMode) => void;
};
export type SceneCtx = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  cameraRig: CameraRig;
};

export function createScene(canvas: HTMLCanvasElement, worldW: number, worldH: number): SceneCtx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);
  const viewSize = Math.max(worldW, worldH) * 1.3;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const ortho = new THREE.OrthographicCamera((-viewSize * aspect) / 2, (viewSize * aspect) / 2, viewSize / 2, -viewSize / 2, 0.1, 300);
  const perspective = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
  const target = new THREE.Vector3(worldW / 2, 0, worldH / 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(worldW, 30, worldH);
  scene.add(sun);

  let mode: CameraMode = 'isometric';
  let active: THREE.Camera = ortho;
  const rig: CameraRig = {
    getCamera: () => active,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      if (next === 'top') {
        active = ortho;
        ortho.position.set(target.x, 28, target.z);
        ortho.up.set(0, 0, -1);
        ortho.lookAt(target);
      } else if (next === 'isometric') {
        active = ortho;
        ortho.position.set(target.x + 15, 20, target.z + 15);
        ortho.up.set(0, 1, 0);
        ortho.lookAt(target);
      } else {
        active = perspective;
        perspective.position.set(target.x + 12, 12, target.z + 16);
        perspective.up.set(0, 1, 0);
        perspective.lookAt(target);
      }
      active.updateProjectionMatrix();
    },
  };
  rig.setMode('isometric');

  const resize = () => {
    const a = window.innerWidth / Math.max(1, window.innerHeight);
    ortho.left = (-viewSize * a) / 2;
    ortho.right = (viewSize * a) / 2;
    ortho.top = viewSize / 2;
    ortho.bottom = -viewSize / 2;
    ortho.updateProjectionMatrix();
    perspective.aspect = a;
    perspective.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  return { scene, camera: ortho, renderer, cameraRig: rig };
}
