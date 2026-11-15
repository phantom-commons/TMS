import type { CamMode } from '../render/camera';

export type InspectorMode = 'always' | 'hover' | 'off';
export type StageStyle = 'atrium' | 'classic';

export type Settings = {
  radial: boolean; // menú radial
  dock: boolean; // botones rápidos (recoger/soltar, atacar) junto al radial
  hints: boolean; // leyenda de atajos
  prompt: boolean; // aviso contextual ("[F] recoger…")
  status: boolean; // estado de conexión, sala, mochila y cámara
  minimap: boolean; // minimapa con calor de visitas
  compass: boolean; // brújula que gira con la cámara
  chat: boolean; // chat de sala
  dev: boolean; // panel de desarrollador (F2)
  ghosts: boolean; // ver fantasmas de quien no está conectado
  shadows: boolean;
  fog: boolean; // niebla en cámaras de primera/tercera persona
  stage: StageStyle; // escenografía 3D de la sala
  fx: boolean; // partículas (polvo) del escenario
  inspector: InspectorMode; // log de objeto: siempre / al pasar o hacer click / apagado
  online: boolean; // conectar al relay (visitas y copia en la nube)
  camera: CamMode;
};

export const DEFAULTS: Settings = {
  radial: true,
  dock: true,
  hints: true,
  prompt: true,
  status: true,
  minimap: true,
  compass: true,
  chat: true,
  dev: false,
  ghosts: true,
  shadows: true,
  fog: true,
  stage: 'atrium',
  fx: true,
  inspector: 'hover',
  online: true,
  camera: 'oblique',
};

const KEY = 'tms.settings';

export type SettingsStore = {
  get: () => Settings;
  set: (patch: Partial<Settings>) => void;
  subscribe: (cb: (s: Settings, changed: Array<keyof Settings>) => void) => () => void;
};

export function createSettingsStore(): SettingsStore {
  let state: Settings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* sin almacenamiento: se usan los valores por defecto */
  }
  const subs = new Set<(s: Settings, changed: Array<keyof Settings>) => void>();
  return {
    get: () => state,
    set(patch) {
      const changed = (Object.keys(patch) as Array<keyof Settings>).filter((k) => patch[k] !== state[k]);
      if (changed.length === 0) return;
      state = { ...state, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* ignorar */
      }
      subs.forEach((cb) => cb(state, changed));
    },
    subscribe(cb) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
}
