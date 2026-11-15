import type { RoomPolicy } from './permissions';

// Una Room es una configuración declarativa. El motor no cambia: cada experiencia declara qué capacidades usa.
//   Room       → el espacio, su contenido y sus reglas   (este archivo)
//   View       → cómo se dibuja                          (view.mode)
//   Experience → qué puede hacer el usuario dentro       (experience → experience-registry.ts)

export type RoomType = 'home' | 'social' | 'explorer' | 'arcade' | 'world';
export type ViewMode = 'ui' | '2d' | 'isometric' | '3d';

/** Esquema de controles que la experiencia pide a input/adaptive.ts */
export type InputScheme = 'none' | 'pointer' | 'dpad' | 'jump' | 'world';

export type RoomFeatures = {
  avatar: boolean;
  inventory: boolean;
  profile: boolean;
  chat: boolean;
  multiplayer: boolean;
  physics: boolean;
  minimap: boolean;
  interactions: boolean;
  scores: boolean;
};

export type RoomConfig = {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  type: RoomType;
  /** id en experience-registry */
  experience: string;
  /** 'inline': se monta dentro del shell. 'page': usa su propia página (motor 3D) */
  launch: 'inline' | 'page';
  href?: string;
  view: { mode: ViewMode; camera: 'fixed' | 'free'; controls: InputScheme };
  features: RoomFeatures;
  policy: RoomPolicy;
};

const none: RoomFeatures = {
  avatar: false,
  inventory: false,
  profile: false,
  chat: false,
  multiplayer: false,
  physics: false,
  minimap: false,
  interactions: false,
  scores: false,
};

export const ROOMS: readonly RoomConfig[] = [
  {
    // La pantalla inicial es una room de tipo UI: sin cámara, sin movimiento, carga instantánea (la pinta el shell).
    id: 'home',
    name: 'Inicio',
    tagline: 'Tu punto de partida en TMS.',
    icon: '🏠',
    type: 'home',
    experience: 'home',
    launch: 'inline',
    view: { mode: 'ui', camera: 'fixed', controls: 'none' },
    features: { ...none, inventory: true, profile: true, interactions: true, scores: true },
    policy: { camera: 'locked', edit: 'none' },
  },
  {
    id: 'my-room',
    name: 'Tu Room',
    tagline: 'Tu espacio privado. Mueve y bloquea tus muebles.',
    icon: '🛋️',
    type: 'social',
    experience: 'personal-room',
    launch: 'inline',
    view: { mode: 'isometric', camera: 'free', controls: 'pointer' },
    features: { ...none, avatar: true, inventory: true, profile: true, interactions: true },
    policy: { camera: 'free', edit: 'access' },
  },
  {
    id: 'snake',
    name: 'Snake',
    tagline: 'Come, crece y no te choques. Cámara fija.',
    icon: '🐍',
    type: 'arcade',
    experience: 'snake',
    launch: 'inline',
    view: { mode: '2d', camera: 'fixed', controls: 'dpad' },
    features: { ...none, scores: true },
    policy: { camera: 'locked', edit: 'none' },
  },
  {
    id: 'runner',
    name: 'Salto',
    tagline: 'Salta y agáchate. Aguanta lo máximo que puedas.',
    icon: '🦖',
    type: 'arcade',
    experience: 'runner',
    launch: 'inline',
    view: { mode: '2d', camera: 'fixed', controls: 'jump' },
    features: { ...none, scores: true },
    policy: { camera: 'locked', edit: 'none' },
  },
  {
    id: 'world',
    name: 'Mundo 3D',
    tagline: 'Tu sala 3D con cámara libre, cubos y visitas.',
    icon: '🧊',
    type: 'world',
    experience: 'world3d',
    launch: 'page',
    href: '?exp=world',
    view: { mode: '3d', camera: 'free', controls: 'world' },
    features: { ...none, avatar: true, chat: true, multiplayer: true, physics: true, minimap: true, interactions: true },
    policy: { camera: 'free', edit: 'access' },
  },
  {
    id: 'atrium',
    name: 'Atrium',
    tagline: 'Nave con columnas y altar central, en 3D.',
    icon: '🏛️',
    type: 'world',
    experience: 'world3d',
    launch: 'page',
    href: '?room=atrium',
    view: { mode: '3d', camera: 'free', controls: 'world' },
    features: { ...none, avatar: true, chat: true, multiplayer: true, physics: true, minimap: true, interactions: true },
    policy: { camera: 'free', edit: 'access' },
  },
];

export const roomById = (id: string): RoomConfig | undefined => ROOMS.find((r) => r.id === id);

export const TYPE_LABEL: Record<RoomType, string> = {
  home: 'Inicio',
  social: 'Social',
  explorer: 'Exploración',
  arcade: 'Arcade',
  world: 'Mundo 3D',
};

/** Etiquetas cortas de lo que declara una room (chips de Explorar). */
export function roomBadges(c: RoomConfig): string[] {
  const out: string[] = [];
  out.push(c.view.mode === 'isometric' ? 'isométrica' : c.view.mode === '3d' ? '3D' : c.view.mode === '2d' ? '2D' : 'UI');
  if (c.policy.camera === 'locked') out.push('📷 cámara fija');
  if (c.policy.edit === 'access') out.push('editable');
  if (c.features.scores) out.push('récords');
  if (c.features.multiplayer) out.push('multijugador');
  return out;
}
