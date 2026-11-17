import * as THREE from 'three';

export type CamMode = 'oblique' | 'iso' | 'top' | 'third' | 'fps';

export const CAM_MODES: readonly CamMode[] = ['oblique', 'iso', 'top', 'third', 'fps'];
export const CAM_LABEL: Record<CamMode, string> = {
  oblique: 'Clásica',
  iso: 'Isométrica',
  top: 'Cenital',
  third: 'Tercera persona',
  fps: 'Primera persona',
};

export const isFirstPerson = (m: CamMode) => m === 'fps';
/** ¿esta cámara gira con Q/E? */
export const usesFacing = (m: CamMode) => m === 'fps' || m === 'third';

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const QUARTER = Math.PI / 2;

/** Cuarto de vuelta (0 norte, 1 este, 2 sur, 3 oeste) más cercano a un ángulo acumulado. */
export const quarterOf = (angle: number): number => (((Math.round(angle / QUARTER) % 4) + 4) % 4);

export type CameraRig = {
  camera: () => THREE.Camera;
  readonly mode: CamMode;
  setMode: (m: CamMode) => void;
  cycle: () => CamMode;
  /** giro de la vista respecto a la rejilla: se usa en screenToGrid */
  yaw: () => number;
  /** 0 norte, 1 este, 2 sur, 3 oeste (solo cámaras que giran) */
  readonly facing: number;
  turn: (dir: 1 | -1) => void;
  /**
   * Mirar arrastrando (táctil o ratón): gira la vista de forma continua, sin retraso. Positivo = hacia la derecha.
   * El movimiento sigue siendo por casillas, así que al soltar (lookEnd) la vista se ajusta al cuarto de vuelta más cercano.
   */
  look: (radians: number) => void;
  lookEnd: () => void;
  zoomBy: (factor: number) => void;
  /** pos: posición suavizada del avatar propio en el mundo, o null */
  update: (dt: number, pos: THREE.Vector3 | null) => void;
  resize: () => void;
};

export function createCameraRig(worldW: number, worldH: number, initial: CamMode = 'oblique'): CameraRig {
  const cx = worldW / 2;
  const cz = worldH / 2;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const persp = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
  let mode: CamMode = initial;
  let zoom = 1;
  let targetAngle = 0; // radianes acumulados (sin módulo) para girar por el camino corto
  let angle = 0;
  let facing = 0;

  const layoutOrtho = () => {
    const aspect = window.innerWidth / window.innerHeight;
    const base = Math.max(worldW, worldH) * (mode === 'iso' ? 1.25 : 1.3);
    const view = base / zoom;
    ortho.left = (-view * aspect) / 2;
    ortho.right = (view * aspect) / 2;
    ortho.top = view / 2;
    ortho.bottom = -view / 2;
    if (mode === 'iso') ortho.position.set(cx + 16, 16, cz + 16);
    else if (mode === 'top') ortho.position.set(cx, 40, cz + 0.001);
    else ortho.position.set(worldW, 20, worldH + 10);
    ortho.lookAt(cx, 0, cz);
    ortho.updateProjectionMatrix();
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
  };

  const rig: CameraRig = {
    camera: () => (mode === 'fps' || mode === 'third' ? persp : ortho),
    get mode() {
      return mode;
    },
    get facing() {
      return facing;
    },
    setMode(m) {
      mode = m;
      layoutOrtho();
    },
    cycle() {
      mode = CAM_MODES[(CAM_MODES.indexOf(mode) + 1) % CAM_MODES.length];
      layoutOrtho();
      return mode;
    },
    yaw() {
      if (mode === 'iso') return Math.PI / 4;
      if (usesFacing(mode)) return (-facing * Math.PI) / 2;
      return 0;
    },
    turn(dir) {
      facing = (facing + dir + 4) % 4;
      targetAngle += (dir * Math.PI) / 2;
    },
    look(radians) {
      if (!usesFacing(mode)) return;
      targetAngle += radians;
      angle += radians; // directo: sin el retardo de la suavización mientras el dedo está abajo
    },
    lookEnd() {
      if (!usesFacing(mode)) return;
      const q = Math.round(targetAngle / QUARTER);
      targetAngle = q * QUARTER;
      facing = quarterOf(targetAngle);
    },
    zoomBy(factor) {
      zoom = Math.min(2.5, Math.max(0.6, zoom * factor));
      layoutOrtho();
    },
    update(dt, pos) {
      angle += wrapPi(targetAngle - angle) * Math.min(1, dt * 12);
      if (!pos || !usesFacing(mode)) return;
      const dx = Math.sin(angle);
      const dz = -Math.cos(angle);
      if (mode === 'fps') {
        persp.position.set(pos.x, 0.72, pos.z);
        persp.lookAt(pos.x + dx, 0.68, pos.z + dz);
      } else {
        const back = 3.2 / zoom;
        persp.position.set(pos.x - dx * back, 2.3, pos.z - dz * back);
        persp.lookAt(pos.x + dx * 1.2, 0.5, pos.z + dz * 1.2);
      }
    },
    resize: layoutOrtho,
  };
  layoutOrtho();
  return rig;
}
