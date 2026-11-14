import * as THREE from 'three';

export type SceneCtx = {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
};

export function createScene(
  canvas: HTMLCanvasElement,
  worldW: number,
  worldH: number,
): SceneCtx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);

  const viewSize = Math.max(worldW, worldH) * 1.3;
  const aspect = window.innerWidth / window.innerHeight;

  const camera = new THREE.OrthographicCamera(
    (-viewSize * aspect) / 2,
    (viewSize * aspect) / 2,
    viewSize / 2,
    -viewSize / 2,
    0.1,
    200,
  );
  camera.position.set(worldW, 20, worldH + 10);
  camera.lookAt(worldW / 2, 0, worldH / 2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(worldW, 30, worldH);
  scene.add(sun);

  const resize = () => {
    const a = window.innerWidth / window.innerHeight;
    camera.left = (-viewSize * a) / 2;
    camera.right = (viewSize * a) / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  return { scene, camera, renderer };
}