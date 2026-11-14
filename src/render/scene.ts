import * as THREE from 'three';

export type SceneCtx = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  setShadows: (on: boolean) => void;
  setFog: (on: boolean) => void;
  onResize: (cb: () => void) => void;
  dispose: () => void;
};

const BG = 0x111318;

export function createScene(canvas: HTMLCanvasElement, worldW: number, worldH: number): SceneCtx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // luz de cielo/suelo + sol con sombras (cubre toda la sala)
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x20232d, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(worldW * 0.8, 24, worldH * 0.3);
  sun.target.position.set(worldW / 2, 0, worldH / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const r = Math.max(worldW, worldH) * 0.75;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const listeners: Array<() => void> = [];
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    listeners.forEach((cb) => cb());
  };
  window.addEventListener('resize', resize);

  return {
    scene,
    renderer,
    sun,
    setShadows(on) {
      sun.castShadow = on;
    },
    setFog(on) {
      scene.fog = on ? new THREE.Fog(BG, 8, 28) : null;
    },
    onResize: (cb) => void listeners.push(cb),
    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
