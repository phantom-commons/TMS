import * as THREE from 'three';
import { GRAPHICS_EVENT, getGraphics } from '../core/graphics';

export type SceneCtx = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  setShadows: (on: boolean) => void;
  setFog: (on: boolean) => void;
  /** 'atrium': tonemapping cinematográfico y luz cálida; 'classic': el aspecto original. */
  setLook: (look: 'atrium' | 'classic') => void;
  /** panorama equirectangular como cielo, o null para el degradado simple */
  setSky: (panorama: THREE.Texture | null) => void;
  onResize: (cb: () => void) => void;
  dispose: () => void;
};

const BG = 0x111318;

/** Degradado vertical barato (una textura de 2×256) que sustituye al cielo HDRI. Su base coincide con el color de la niebla. */
function makeGradientSky(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#2c3556');
    gr.addColorStop(0.5, '#1c2238');
    gr.addColorStop(1, '#111318');
    g.fillStyle = gr;
    g.fillRect(0, 0, 2, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createScene(canvas: HTMLCanvasElement, worldW: number, worldH: number): SceneCtx {
  const scene = new THREE.Scene();
  const gradientSky = makeGradientSky();
  scene.background = gradientSky;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(getGraphics().pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // luz de cielo/suelo + sol con sombras (cubre toda la sala)
  const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x20232d, 0.75);
  scene.add(hemi);
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
    renderer.setPixelRatio(getGraphics().pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    listeners.forEach((cb) => cb());
  };
  window.addEventListener('resize', resize);
  window.addEventListener(GRAPHICS_EVENT, resize);

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
    setLook(look) {
      const atrium = look === 'atrium';
      renderer.toneMapping = atrium ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      renderer.toneMappingExposure = atrium ? 1.0 : 1;
      hemi.color.setHex(atrium ? 0xb9c4ff : 0xcfd8ff);
      hemi.groundColor.setHex(atrium ? 0x2a2230 : 0x20232d);
      hemi.intensity = atrium ? 0.55 : 0.75;
      sun.color.setHex(atrium ? 0xffe6c4 : 0xffffff);
      sun.intensity = atrium ? 1.35 : 1.1;
    },
    setSky(panorama) {
      if (panorama) {
        // sin este mapeo Three pinta el HDR como una foto plana pegada a la pantalla, no como un cielo
        panorama.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = panorama;
      } else {
        scene.background = gradientSky;
      }
    },
    onResize: (cb) => void listeners.push(cb),
    dispose() {
      gradientSky.dispose();
      window.removeEventListener('resize', resize);
      window.removeEventListener(GRAPHICS_EVENT, resize);
      renderer.dispose();
    },
  };
}
