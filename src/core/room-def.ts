import type { KV } from './kv';
import { MAX_RULES, MAX_TEXT, type Action, type Rule, type Trigger } from '../sim/house/rules';
import { VIEW_LABEL, validateRoomConfig, type RoomConfig, type ViewKind } from './room-config';

// Una room creada por el usuario es solo datos: nombre, tamaño, semilla de color, vistas permitidas y reglas.
// Los muebles colocados se guardan aparte (clave `house.<id>`); los objetos salen de tu inventario único.

export const CUSTOM_PREFIX = 'c-';
export const MIN_SIDE = 4;
export const MAX_SIDE_CELLS = 14;
export const MAX_NAME = 28;
export const CAM_VIEWS: readonly ViewKind[] = ['fps', 'third', 'iso', 'top'];

export type RoomDef = {
  v: 1;
  id: string;
  name: string;
  /** de aquí salen los colores de paredes y suelo (generador procedural) */
  seed: string;
  w: number;
  d: number;
  views: ViewKind[];
  defaultView: ViewKind;
  rules: Rule[];
};

export const isCustomId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);
export const houseKey = (id: string): string => `house.${id}`;

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
export const randomSeed = (): string => hex(8);

export function newRoomDef(name = 'Mi room'): RoomDef {
  return { v: 1, id: CUSTOM_PREFIX + hex(8), name, seed: randomSeed(), w: 8, d: 8, views: ['fps', 'third', 'iso', 'top'], defaultView: 'fps', rules: [] };
}

const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

function cleanTrigger(t: unknown, w: number, d: number): Trigger | null {
  const o = t as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (o.t === 'enter') return { t: 'enter' };
  if (o.t === 'step') return { t: 'step', cx: int(o.cx, 0, w - 1, 0), cy: int(o.cy, 0, d - 1, 0) };
  if (o.t === 'use' && typeof o.kind === 'string') return { t: 'use', kind: o.kind.slice(0, 40) };
  return null;
}

function cleanAction(a: unknown, w: number, d: number): Action | null {
  const o = a as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (o.t === 'say') return { t: 'say', text: String(o.text ?? '').slice(0, MAX_TEXT) };
  if (o.t === 'goto') return { t: 'goto', cx: int(o.cx, 0, w - 1, 0), cy: int(o.cy, 0, d - 1, 0) };
  if (o.t === 'recolor') return { t: 'recolor', seed: String(o.seed ?? '').slice(0, 24) || randomSeed() };
  return null;
}

/** Acota y limpia una definición venida de fuera. Siempre devuelve algo que pasa validateRoomDef. */
export function normalizeRoomDef(raw: unknown): RoomDef | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.v !== 1 || typeof o.id !== 'string' || !isCustomId(o.id)) return null;
  const w = int(o.w, MIN_SIDE, MAX_SIDE_CELLS, 8);
  const d = int(o.d, MIN_SIDE, MAX_SIDE_CELLS, 8);
  const views = (Array.isArray(o.views) ? o.views : []).filter((v): v is ViewKind => CAM_VIEWS.includes(v as ViewKind));
  const uniq = [...new Set(views)];
  const finalViews = uniq.length ? uniq : [...CAM_VIEWS];
  const defaultView = finalViews.includes(o.defaultView as ViewKind) ? (o.defaultView as ViewKind) : (finalViews[0] as ViewKind);
  const rules: Rule[] = [];
  let id = 1;
  for (const r of Array.isArray(o.rules) ? o.rules : []) {
    if (rules.length >= MAX_RULES) break;
    const when = cleanTrigger((r as Record<string, unknown>)?.when, w, d);
    const then = cleanAction((r as Record<string, unknown>)?.then, w, d);
    if (when && then) rules.push({ id: id++, when, then });
  }
  return {
    v: 1,
    id: o.id,
    name: (typeof o.name === 'string' ? o.name.trim() : '').slice(0, MAX_NAME) || 'Mi room',
    seed: typeof o.seed === 'string' && o.seed ? o.seed.slice(0, 24) : randomSeed(),
    w,
    d,
    views: finalViews,
    defaultView,
    rules,
  };
}

export function validateRoomDef(d: RoomDef): string | null {
  const n = normalizeRoomDef(d);
  if (!n) return 'room inválida';
  return JSON.stringify(n) === JSON.stringify(d) ? null : 'la room tiene valores fuera de rango';
}

/** Configuración de room (la misma forma que las del catálogo) para una room creada por el usuario. */
export function configOfDef(def: RoomDef): RoomConfig {
  return {
    id: def.id,
    name: def.name,
    tagline: `Hecha por ti · ${def.w}×${def.d} casillas · ${def.rules.length} regla${def.rules.length === 1 ? '' : 's'}`,
    icon: 'door',
    type: 'social',
    experience: 'house',
    launch: 'inline',
    view: { allowed: def.views, default: def.defaultView, controls: 'world' },
    mode: 'solo',
    resolution: 1,
    features: { avatar: true, inventory: true, profile: false, chat: false, multiplayer: false, physics: false, minimap: false, interactions: true, scores: false },
    policy: { camera: 'free', edit: 'access' },
  };
}

// ───────────── almacenamiento ─────────────
const KEY = 'rooms.mine';

export function loadRoomDefs(kv: KV): RoomDef[] {
  const raw = kv.get<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRoomDef).filter((d): d is RoomDef => d !== null);
}

export function saveRoomDef(kv: KV, def: RoomDef): RoomDef {
  const clean = normalizeRoomDef(def) ?? def;
  const all = loadRoomDefs(kv);
  const i = all.findIndex((r) => r.id === clean.id);
  if (i >= 0) all[i] = clean;
  else all.push(clean);
  kv.set(KEY, all);
  return clean;
}

export function deleteRoomDef(kv: KV, id: string): void {
  kv.set(KEY, loadRoomDefs(kv).filter((r) => r.id !== id));
  kv.remove(houseKey(id));
}

export const roomDefById = (kv: KV, id: string): RoomDef | undefined => loadRoomDefs(kv).find((r) => r.id === id);

export const viewName = (v: ViewKind): string => VIEW_LABEL[v];
export const configErrors = (def: RoomDef): string[] => validateRoomConfig(configOfDef(def));
