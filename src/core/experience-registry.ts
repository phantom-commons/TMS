import type { Identity } from '../identity/keys';
import type { KV } from './kv';
import { canRole, type Capability } from './permissions';
import type { RoomConfig } from './room-config';

// Registro de experiencias. Cada una se carga bajo demanda (import dinámico): el menú arranca ligero
// y solo descargas el código de Snake, de Salto o de Tu Room cuando entras.

export type ExperienceContext = {
  /** contenedor a pantalla completa donde la experiencia se monta */
  root: HTMLElement;
  config: RoomConfig;
  identity: Identity;
  /** clave pública (hex) del usuario */
  author: string;
  kv: KV;
  /** permisos del usuario en esta room, ya resueltos con la política de su config */
  can: (cap: Capability) => boolean;
  toast: (message: string, ms?: number) => void;
  /** volver al menú */
  exit: () => void;
  /** ir a otra ruta del shell (p. ej. '#/inventory') */
  go: (hash: string) => void;
};

export type ExperienceHandle = { destroy: () => void };
export type ExperienceFactory = (ctx: ExperienceContext) => ExperienceHandle | Promise<ExperienceHandle>;
type Loader = () => Promise<ExperienceFactory>;

const loaders = new Map<string, Loader>();

export function registerExperience(id: string, loader: Loader): void {
  loaders.set(id, loader);
}

export async function loadExperience(id: string): Promise<ExperienceFactory | null> {
  const loader = loaders.get(id);
  return loader ? loader() : null;
}

/** Permisos de quien juega solo (rooms sin lista de acceso propia, como los juegos). */
export const soloCan =
  (config: RoomConfig) =>
  (cap: Capability): boolean =>
    canRole('owner', cap, { policy: config.policy });

export function registerBuiltinExperiences(): void {
  registerExperience('personal-room', async () => (await import('../experiences/social/personal-room')).mountPersonalRoom);
  registerExperience('house', async () => (await import('../experiences/house/index')).mountHouse);
  registerExperience('star', async () => (await import('../experiences/star/index')).mountStar);
  registerExperience('lab', async () => (await import('../experiences/lab/index')).mountLab);
  registerExperience('workshop', async () => (await import('../experiences/workshop/index')).mountWorkshop);
  registerExperience('snake', async () => (await import('../experiences/arcade/snake/index')).mountSnake);
  registerExperience('runner', async () => (await import('../experiences/arcade/runner/index')).mountRunner);
}
