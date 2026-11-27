import { canRole, type Capability, type Role, type Visitors } from '../../core/permissions';
import { knownObject } from '../../core/object-registry';
import { isObjectKind, type ObjectKind } from '../../core/objects';
import { roomById } from '../../core/room-config';

// Modelo puro de Tu Room (sin DOM ni canvas): objetos, reglas de colocación y operaciones con permisos.
// TODOS los cambios pasan por applyOp(layout, op, role): es el único sitio donde se decide quién puede qué.

export const ROOM_SIZE = 8;
export const WALL_H = 3;
export const MAX_EDITORS = 8;

export type BuiltinKind = 'bed' | 'chair' | 'desk' | 'window' | 'rug' | 'lamp' | 'plant' | 'poster';
/** Muebles de serie o un objeto voxel propio (id por contenido: `obj:<hash>`). */
export type ItemKind = BuiltinKind | ObjectKind;
export type Wall = 'left' | 'right';

/** Pieza de un mueble: una caja en coordenadas de la casilla del objeto (unidades = casillas). */
export type Part = { dx: number; dy: number; dz: number; w: number; d: number; h: number; color: string };

export type ItemDef = {
  kind: ItemKind;
  label: string;
  icon: string;
  mount: 'floor' | 'wall';
  /** casillas de largo (en pared: a lo largo de la pared) */
  w: number;
  d: number;
  /** ¿impide caminar y apilar? (las alfombras no) */
  blocks: boolean;
  parts: Part[];
  /** solo pared: altura inferior/superior y estilo */
  z0?: number;
  z1?: number;
  style?: 'window' | 'poster';
  color: string;
};

export const ITEMS: Record<BuiltinKind, ItemDef> = {
  bed: {
    kind: 'bed', label: 'Cama', icon: '🛏️', mount: 'floor', w: 2, d: 1, blocks: true, color: '#6b7fd7',
    parts: [
      { dx: 0, dy: 0, dz: 0, w: 2, d: 1, h: 0.34, color: '#6b7fd7' },
      { dx: 0.08, dy: 0.12, dz: 0.34, w: 0.5, d: 0.76, h: 0.14, color: '#f2f3f8' },
      { dx: 0.7, dy: 0, dz: 0.34, w: 1.3, d: 1, h: 0.1, color: '#9aaaff' },
    ],
  },
  chair: {
    kind: 'chair', label: 'Silla', icon: '🪑', mount: 'floor', w: 1, d: 1, blocks: true, color: '#e08a3c',
    parts: [
      { dx: 0.3, dy: 0.3, dz: 0, w: 0.4, d: 0.4, h: 0.26, color: '#8a5a2b' },
      { dx: 0.14, dy: 0.14, dz: 0.26, w: 0.72, d: 0.72, h: 0.12, color: '#e08a3c' },
      { dx: 0.14, dy: 0.14, dz: 0.38, w: 0.72, d: 0.12, h: 0.42, color: '#c9742e' },
    ],
  },
  desk: {
    kind: 'desk', label: 'Escritorio', icon: '🖥️', mount: 'floor', w: 2, d: 1, blocks: true, color: '#9b6b3f',
    parts: [
      { dx: 0.06, dy: 0.1, dz: 0, w: 0.14, d: 0.8, h: 0.56, color: '#7d5430' },
      { dx: 1.8, dy: 0.1, dz: 0, w: 0.14, d: 0.8, h: 0.56, color: '#7d5430' },
      { dx: 0, dy: 0.04, dz: 0.56, w: 2, d: 0.92, h: 0.1, color: '#a8774a' },
      { dx: 0.92, dy: 0.2, dz: 0.66, w: 0.16, d: 0.16, h: 0.1, color: '#444a5c' },
      { dx: 0.62, dy: 0.18, dz: 0.76, w: 0.76, d: 0.08, h: 0.46, color: '#2b3040' },
    ],
  },
  rug: {
    kind: 'rug', label: 'Alfombra', icon: '🟪', mount: 'floor', w: 2, d: 2, blocks: false, color: '#a06be0',
    parts: [
      { dx: 0, dy: 0, dz: 0, w: 2, d: 2, h: 0.04, color: '#a06be0' },
      { dx: 0.25, dy: 0.25, dz: 0.04, w: 1.5, d: 1.5, h: 0.01, color: '#c9a0ff' },
    ],
  },
  lamp: {
    kind: 'lamp', label: 'Lámpara', icon: '💡', mount: 'floor', w: 1, d: 1, blocks: true, color: '#ffd966',
    parts: [
      { dx: 0.32, dy: 0.32, dz: 0, w: 0.36, d: 0.36, h: 0.08, color: '#59606f' },
      { dx: 0.46, dy: 0.46, dz: 0.08, w: 0.08, d: 0.08, h: 0.9, color: '#7b8394' },
      { dx: 0.26, dy: 0.26, dz: 0.98, w: 0.48, d: 0.48, h: 0.3, color: '#ffd966' },
    ],
  },
  plant: {
    kind: 'plant', label: 'Planta', icon: '🪴', mount: 'floor', w: 1, d: 1, blocks: true, color: '#3fa66a',
    parts: [
      { dx: 0.25, dy: 0.25, dz: 0, w: 0.5, d: 0.5, h: 0.3, color: '#c4623a' },
      { dx: 0.14, dy: 0.14, dz: 0.3, w: 0.72, d: 0.72, h: 0.46, color: '#3fa66a' },
      { dx: 0.3, dy: 0.3, dz: 0.76, w: 0.4, d: 0.4, h: 0.26, color: '#58c783' },
    ],
  },
  window: {
    kind: 'window', label: 'Ventana', icon: '🪟', mount: 'wall', w: 2, d: 1, blocks: false, color: '#e9edf5',
    parts: [], z0: 0.85, z1: 2.15, style: 'window',
  },
  poster: {
    kind: 'poster', label: 'Póster', icon: '🖼️', mount: 'wall', w: 1, d: 1, blocks: false, color: '#ff8fa3',
    parts: [], z0: 1.0, z1: 1.95, style: 'poster',
  },
};

export const ITEM_KINDS = Object.keys(ITEMS) as BuiltinKind[];

export const isBuiltinKind = (k: string): k is BuiltinKind => Object.prototype.hasOwnProperty.call(ITEMS, k);
/** ¿es un nombre de objeto válido? (que esté registrado en este cliente es otra cuestión) */
export const isItemKind = (k: string): k is ItemKind => isBuiltinKind(k) || isObjectKind(k);

const customDefs = new Map<string, ItemDef>();
const UNKNOWN: Part[] = [{ dx: 0.2, dy: 0.2, dz: 0, w: 0.6, d: 0.6, h: 0.6, color: '#59606f' }];

/**
 * Definición de un objeto: de serie o voxel propio. Un objeto propio que este cliente aún no conoce (por ejemplo, tras
 * borrar la biblioteca local) se muestra como bloque gris: el layout sigue siendo válido y no se pierde nada.
 */
export function itemDef(kind: ItemKind): ItemDef {
  if (isBuiltinKind(kind)) return ITEMS[kind];
  const cached = customDefs.get(kind);
  if (cached) return cached;
  const known = knownObject(kind);
  if (!known) return { kind, label: 'Objeto desconocido', icon: '❔', mount: 'floor', w: 1, d: 1, blocks: true, parts: UNKNOWN, color: '#59606f' };
  const def: ItemDef = {
    kind,
    label: known.obj.name,
    icon: '',
    mount: 'floor',
    w: known.compiled.w,
    d: known.compiled.d,
    blocks: known.compiled.blocks,
    parts: known.compiled.parts,
    color: known.compiled.color,
  };
  customDefs.set(kind, def);
  return def;
}

/** Objetos de serie y propios que este layout posee (en la room o en el inventario), de serie primero. */
export function ownedKinds(l: Pick<RoomLayout, 'items' | 'stash'>): ItemKind[] {
  const seen = new Set<string>([...l.items.map((i) => i.kind), ...Object.keys(l.stash)]);
  const builtin = ITEM_KINDS.filter((k) => seen.has(k));
  const custom = [...seen].filter((k): k is ObjectKind => isObjectKind(k)).sort();
  return [...builtin, ...custom];
}

export type PlacedItem = {
  id: string;
  kind: ItemKind;
  /** suelo: casilla x. pared: posición a lo largo de la pared */
  x: number;
  /** suelo: casilla y. pared: siempre 0 */
  y: number;
  rot: 0 | 1;
  wall: Wall | null;
  locked: boolean;
};

export type RoomLayout = {
  v: 1;
  roomId: string;
  rev: number;
  updatedAt: number;
  /** dueño, editores y visibilidad */
  owner: string;
  editors: string[];
  visitors: Visitors;
  /** el dueño fijó la cámara para todos */
  cameraLocked: boolean;
  items: PlacedItem[];
  /** objetos del inventario que no están colocados */
  stash: Partial<Record<ItemKind, number>>;
  nextId: number;
};

// ───────────────── geometría ─────────────────

export type Dim = { w: number; d: number };

export function dims(it: Pick<PlacedItem, 'kind' | 'rot'>): Dim {
  const def = itemDef(it.kind);
  if (def.mount === 'wall') return { w: def.w, d: 1 };
  return it.rot ? { w: def.d, d: def.w } : { w: def.w, d: def.d };
}

/** Pieza girada 90° dentro de su huella (para dibujar). */
export function orientedParts(kind: ItemKind, rot: 0 | 1): Part[] {
  const def = itemDef(kind);
  if (!rot) return def.parts;
  return def.parts.map((p) => ({ ...p, dx: p.dy, dy: def.w - p.dx - p.w, w: p.d, d: p.w }));
}

export function cellsOf(it: PlacedItem): Array<[number, number]> {
  if (itemDef(it.kind).mount === 'wall') return [];
  const { w, d } = dims(it);
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) out.push([it.x + dx, it.y + dy]);
  return out;
}

/** Casillas por las que no se puede caminar. */
export function blockedCells(layout: RoomLayout): Set<string> {
  const s = new Set<string>();
  for (const it of layout.items) {
    if (!itemDef(it.kind).blocks) continue;
    for (const [x, y] of cellsOf(it)) s.add(`${x},${y}`);
  }
  return s;
}

/** Camino más corto (4 direcciones) sin cruzar muebles. Excluye el origen. */
export function findPath(layout: RoomLayout, from: { x: number; y: number }, to: { x: number; y: number }): Array<{ x: number; y: number }> | null {
  const blocked = blockedCells(layout);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < ROOM_SIZE && y < ROOM_SIZE;
  if (!inside(to.x, to.y) || blocked.has(`${to.x},${to.y}`)) return null;
  const k = (x: number, y: number) => `${x},${y}`;
  const prev = new Map<string, string | null>([[k(from.x, from.y), null]]);
  const queue = [{ x: from.x, y: from.y }];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.x === to.x && cur.y === to.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inside(nx, ny) || blocked.has(k(nx, ny)) || prev.has(k(nx, ny))) continue;
      prev.set(k(nx, ny), k(cur.x, cur.y));
      queue.push({ x: nx, y: ny });
    }
  }
  if (!prev.has(k(to.x, to.y))) return null;
  const path: Array<{ x: number; y: number }> = [];
  let at: string | null = k(to.x, to.y);
  while (at && at !== k(from.x, from.y)) {
    const [x, y] = at.split(',').map(Number);
    path.push({ x, y });
    at = prev.get(at) ?? null;
  }
  return path.reverse();
}

// ───────────────── validación ─────────────────

export function validateLayout(l: RoomLayout): string | null {
  const ids = new Set<string>();
  const solid = new Map<string, string>();
  const rugs = new Map<string, string>();
  const walls: Record<Wall, Map<number, string>> = { left: new Map(), right: new Map() };

  for (const it of l.items) {
    const def = itemDef(it.kind);
    if (!def) return 'objeto desconocido';
    if (ids.has(it.id)) return 'objeto duplicado';
    ids.add(it.id);
    if (it.rot !== 0 && it.rot !== 1) return 'giro inválido';
    if (!Number.isInteger(it.x) || !Number.isInteger(it.y)) return 'posición inválida';

    if (def.mount === 'wall') {
      if (it.wall !== 'left' && it.wall !== 'right') return `${def.label} debe ir en una pared`;
      if (it.y !== 0 || it.x < 0 || it.x + def.w > ROOM_SIZE) return `${def.label} se sale de la pared`;
      for (let u = it.x; u < it.x + def.w; u++) {
        if (walls[it.wall].has(u)) return `${def.label} se solapa con otro objeto de la pared`;
        walls[it.wall].set(u, it.id);
      }
      continue;
    }

    if (it.wall !== null) return `${def.label} debe ir en el suelo`;
    const { w, d } = dims(it);
    if (it.x < 0 || it.y < 0 || it.x + w > ROOM_SIZE || it.y + d > ROOM_SIZE) return `${def.label} se sale de la habitación`;
    const map = def.blocks ? solid : rugs;
    for (const [x, y] of cellsOf(it)) {
      const k = `${x},${y}`;
      if (map.has(k)) return `${def.label} se solapa con otro objeto`;
      map.set(k, it.id);
    }
  }

  for (const [kind, n] of Object.entries(l.stash)) {
    if (!isItemKind(kind) || !Number.isInteger(n) || (n as number) < 0) return 'inventario inválido';
  }
  if (l.editors.length > MAX_EDITORS) return 'demasiados editores';
  return null;
}

// ───────────────── operaciones con permisos ─────────────────

export type Op =
  | { t: 'move'; id: string; x: number; y: number; wall?: Wall }
  | { t: 'rotate'; id: string }
  | { t: 'lock'; id: string; locked: boolean }
  | { t: 'place'; kind: ItemKind; x: number; y: number; wall?: Wall }
  | { t: 'store'; id: string }
  | { t: 'visitors'; value: Visitors }
  | { t: 'editor'; pubkey: string; add: boolean }
  | { t: 'camera'; locked: boolean };

export type OpResult = { ok: true; layout: RoomLayout } | { ok: false; error: string };

const CAP: Record<Op['t'], Capability> = {
  move: 'move',
  rotate: 'move',
  lock: 'lock',
  place: 'manage',
  store: 'manage',
  visitors: 'share',
  editor: 'share',
  camera: 'share',
};

const clone = (l: RoomLayout): RoomLayout => JSON.parse(JSON.stringify(l)) as RoomLayout;
const fail = (error: string): OpResult => ({ ok: false, error });

export function applyOp(layout: RoomLayout, op: Op, role: Role, now = Date.now()): OpResult {
  const policy = roomById('my-room')?.policy ?? { camera: 'free', edit: 'access' };
  const ctx = { policy, cameraLocked: layout.cameraLocked, visitors: layout.visitors } as const;
  if (!canRole(role, CAP[op.t], ctx)) {
    return fail(role === 'visitor' ? 'los visitantes solo pueden mirar' : 'solo el dueño puede hacer eso');
  }

  const next = clone(layout);
  const find = (id: string) => next.items.find((i) => i.id === id);

  switch (op.t) {
    case 'move': {
      const it = find(op.id);
      if (!it) return fail('objeto no encontrado');
      if (it.locked) return fail('está bloqueado');
      if (itemDef(it.kind).mount === 'wall') {
        it.wall = op.wall ?? it.wall;
        it.x = op.x;
        it.y = 0;
      } else {
        it.x = op.x;
        it.y = op.y;
      }
      break;
    }
    case 'rotate': {
      const it = find(op.id);
      if (!it) return fail('objeto no encontrado');
      if (it.locked) return fail('está bloqueado');
      if (itemDef(it.kind).mount === 'wall') return fail('las cosas de pared no giran');
      it.rot = it.rot ? 0 : 1;
      break;
    }
    case 'lock': {
      const it = find(op.id);
      if (!it) return fail('objeto no encontrado');
      it.locked = op.locked;
      break;
    }
    case 'place': {
      const have = next.stash[op.kind] ?? 0;
      if (have <= 0) return fail('no tienes de ese objeto en el inventario');
      const wall = itemDef(op.kind).mount === 'wall';
      next.items.push({
        id: `it-${next.nextId}`,
        kind: op.kind,
        x: op.x,
        y: wall ? 0 : op.y,
        rot: 0,
        wall: wall ? (op.wall ?? 'left') : null,
        locked: false,
      });
      next.nextId += 1;
      if (have === 1) delete next.stash[op.kind];
      else next.stash[op.kind] = have - 1;
      break;
    }
    case 'store': {
      const it = find(op.id);
      if (!it) return fail('objeto no encontrado');
      if (it.locked) return fail('está bloqueado');
      next.items = next.items.filter((i) => i.id !== op.id);
      next.stash[it.kind] = (next.stash[it.kind] ?? 0) + 1;
      break;
    }
    case 'visitors':
      next.visitors = op.value;
      break;
    case 'editor': {
      const key = op.pubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) return fail('la clave pública debe tener 64 caracteres hex');
      if (key === next.owner.toLowerCase()) return fail('el dueño ya puede editar');
      next.editors = next.editors.filter((e) => e.toLowerCase() !== key);
      if (op.add) next.editors.push(key);
      break;
    }
    case 'camera':
      next.cameraLocked = op.locked;
      break;
  }

  const err = validateLayout(next);
  if (err) return fail(err);
  next.rev += 1;
  next.updatedAt = now;
  return { ok: true, layout: next };
}

// ───────────────── layout inicial y colocación automática ─────────────────

export function defaultLayout(owner: string, roomId = 'my-room', now = Date.now()): RoomLayout {
  const it = (id: string, kind: ItemKind, x: number, y: number, rot: 0 | 1 = 0, wall: Wall | null = null): PlacedItem => ({
    id, kind, x, y, rot, wall, locked: false,
  });
  return {
    v: 1,
    roomId,
    rev: 0,
    updatedAt: now,
    owner,
    editors: [],
    visitors: 'view',
    cameraLocked: false,
    items: [
      it('it-1', 'bed', 5, 0),
      it('it-2', 'desk', 0, 2, 1),
      it('it-3', 'chair', 1, 2),
      it('it-4', 'window', 2, 0, 0, 'right'),
      it('it-5', 'poster', 5, 0, 0, 'left'),
    ],
    stash: { rug: 1, lamp: 1, plant: 2 },
    nextId: 6,
  };
}

/** Primer hueco válido para colocar un objeto del inventario (de dentro hacia fuera). */
export function findFreeSpot(layout: RoomLayout, kind: ItemKind): { x: number; y: number; wall?: Wall } | null {
  const def = itemDef(kind);
  const probe = (cand: PlacedItem) => validateLayout({ ...layout, items: [...layout.items, cand] }) === null;
  if (def.mount === 'wall') {
    for (const wall of ['left', 'right'] as const) {
      for (let u = 0; u + def.w <= ROOM_SIZE; u++) {
        if (probe({ id: 'probe', kind, x: u, y: 0, rot: 0, wall, locked: false })) return { x: u, y: 0, wall };
      }
    }
    return null;
  }
  const c = (ROOM_SIZE - 1) / 2;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < ROOM_SIZE; y++) for (let x = 0; x < ROOM_SIZE; x++) cells.push([x, y]);
  cells.sort((a, b) => Math.hypot(a[0] - c, a[1] - c) - Math.hypot(b[0] - c, b[1] - c));
  for (const [x, y] of cells) {
    if (probe({ id: 'probe', kind, x, y, rot: 0, wall: null, locked: false })) return { x, y };
  }
  return null;
}

export const stashCount = (l: RoomLayout, kind: ItemKind) => l.stash[kind] ?? 0;
export const placedCount = (l: RoomLayout, kind: ItemKind) => l.items.filter((i) => i.kind === kind).length;

/** Añade unidades al inventario (p. ej. el creador de un objeto recibe la primera). Devuelve un layout nuevo. */
export function grantItem(layout: RoomLayout, kind: ItemKind, n = 1, now = Date.now()): RoomLayout {
  const next: RoomLayout = { ...layout, stash: { ...layout.stash, [kind]: (layout.stash[kind] ?? 0) + n }, rev: layout.rev + 1, updatedAt: now };
  const err = validateLayout(next);
  if (err) throw new Error(err);
  return next;
}
