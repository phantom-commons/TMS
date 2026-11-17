import type { RoomPolicy } from './permissions';

// Una Room es una configuración declarativa. El motor no cambia: cada experiencia declara qué capacidades usa.
//   Room       → el espacio, su contenido y sus reglas   (este archivo)
//   View       → cómo se dibuja; la room declara qué vistas permite y el jugador elige entre ellas (view.allowed)
//   Experience → qué puede hacer el usuario dentro       (experience → experience-registry.ts)

export type RoomType = 'home' | 'social' | 'explorer' | 'arcade' | 'world';
/** Cómo se ve una room. Una room permite varias; el jugador elige una (si la room y su rol lo dejan). */
export type ViewKind = 'ui' | 'side' | 'top' | 'iso' | 'third' | 'fps';
export const VIEW_LABEL: Record<ViewKind, string> = {
  ui: 'Menú',
  side: 'Lateral',
  top: 'Cenital',
  iso: 'Isométrica',
  third: 'Tercera persona',
  fps: 'Primera persona',
};

/** solo: cada jugador tiene su copia y nada se sincroniza. shared: la room es de todos (registro firmado + relay). */
export type RoomMode = 'solo' | 'shared';

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
  view: {
    /** vistas que el autor permite, sin repetir */
    allowed: readonly ViewKind[];
    /** vista inicial, y la única si la cámara está bloqueada */
    default: ViewKind;
    controls: InputScheme;
  };
  mode: RoomMode;
  /** subdivisiones enteras por casilla (1 = casilla entera). La lógica sigue siendo entera: solo cambia la precisión. */
  resolution: number;
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
    view: { allowed: ['ui'], default: 'ui', controls: 'none' },
    mode: 'solo',
    resolution: 1,
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
    view: { allowed: ['iso', 'top'], default: 'iso', controls: 'pointer' },
    mode: 'solo',
    resolution: 1,
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
    view: { allowed: ['top'], default: 'top', controls: 'dpad' },
    mode: 'solo',
    resolution: 1,
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
    view: { allowed: ['side'], default: 'side', controls: 'jump' },
    mode: 'solo',
    resolution: 1,
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
    view: { allowed: ['third', 'fps', 'iso', 'top'], default: 'iso', controls: 'world' },
    mode: 'shared',
    resolution: 1,
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
    view: { allowed: ['third', 'fps', 'iso', 'top'], default: 'iso', controls: 'world' },
    mode: 'shared',
    resolution: 1,
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

/** Errores de una configuración (vacío = válida). */
export function validateRoomConfig(c: RoomConfig): string[] {
  const errs: string[] = [];
  const { allowed } = c.view;
  if (allowed.length === 0) errs.push('view.allowed vacío');
  if (new Set(allowed).size !== allowed.length) errs.push('view.allowed repetido');
  for (const v of allowed) if (!(v in VIEW_LABEL)) errs.push(`vista desconocida: ${String(v)}`);
  if (!allowed.includes(c.view.default)) errs.push('view.default no está entre las vistas permitidas');
  if (!Number.isInteger(c.resolution) || c.resolution < 1 || c.resolution > 16) errs.push('resolution debe ser un entero entre 1 y 16');
  if (c.mode === 'shared' && !c.features.multiplayer) errs.push('una room compartida necesita features.multiplayer');
  if (c.mode === 'solo' && c.features.multiplayer) errs.push('una room en solitario no puede tener features.multiplayer');
  return errs;
}

/**
 * Vista efectiva: la preferida del jugador solo cuenta si la room la permite y puede elegir
 * (cámara libre y rol con capacidad de cámara). Si no, manda la vista por defecto del autor.
 */
export function resolveView(c: RoomConfig, preferred: string | null | undefined, canChoose: boolean): ViewKind {
  if (!canChoose || c.policy.camera === 'locked') return c.view.default;
  return c.view.allowed.find((v) => v === preferred) ?? c.view.default;
}

/** Etiquetas cortas de lo que declara una room (chips de Explorar). */
export function roomBadges(c: RoomConfig): string[] {
  const out: string[] = [];
  const { allowed } = c.view;
  if (allowed.length > 1 && c.policy.camera === 'free') out.push(`${allowed.length} vistas`);
  else out.push(VIEW_LABEL[c.view.default].toLowerCase());
  if (c.policy.camera === 'locked') out.push('📷 cámara fija');
  if (c.policy.edit === 'access') out.push('editable');
  if (c.features.scores) out.push('récords');
  out.push(c.mode === 'shared' ? 'multijugador' : 'en solitario');
  return out;
}
