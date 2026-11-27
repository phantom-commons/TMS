import type { KV } from '../../core/kv';
import { applyEdit, createHouse, type HouseObject, type HouseState, type ObjectDefs, type Rot } from '../../sim/house/state';

// Persistencia de la casa en este navegador. Se guarda lo mínimo (objetos y dónde está el jugador); al cargar se
// vuelve a validar todo con las reglas de la sim, así que un guardado dañado o con objetos desconocidos no rompe nada.

type Saved = { v: 1; objects: Array<Pick<HouseObject, 'kind' | 'x' | 'y' | 'rot'>>; player: { cx: number; cy: number } };

export const DEFAULT_KEY = 'house.v1';

/** Clases de objeto colocadas en una casa guardada (para saber cuántas unidades del inventario están en uso). */
export function savedKinds(kv: KV, key = DEFAULT_KEY): string[] {
  const raw = kv.get<Saved | null>(key, null);
  return raw && Array.isArray(raw.objects) ? raw.objects.map((o) => o?.kind).filter((k): k is string => typeof k === 'string') : [];
}

export function saveHouse(kv: KV, s: HouseState, key = DEFAULT_KEY): void {
  const data: Saved = {
    v: 1,
    objects: s.objects.map((o) => ({ kind: o.kind, x: o.x, y: o.y, rot: o.rot })),
    player: { cx: s.player.cx, cy: s.player.cy },
  };
  kv.set(key, data);
}

/** Casa guardada, o la inicial si no hay nada (o si lo guardado no sirve). Los objetos que ya no caben se descartan. */
export function loadHouse(kv: KV, fallback: HouseState, defs: ObjectDefs, key = DEFAULT_KEY): HouseState {
  const raw = kv.get<Saved | null>(key, null);
  if (!raw || raw.v !== 1 || !Array.isArray(raw.objects)) return fallback;
  let s = createHouse(fallback.seed, fallback.w, fallback.d);
  // el jugador va primero: así los objetos se validan contra el sitio donde de verdad estaba
  const p = raw.player;
  if (p && Number.isInteger(p.cx) && Number.isInteger(p.cy) && p.cx >= 0 && p.cy >= 0 && p.cx < s.w && p.cy < s.d) {
    s = { ...s, player: { cx: p.cx, cy: p.cy, fromX: p.cx, fromY: p.cy, moveLeft: 0 } };
  }
  for (const o of raw.objects) {
    if (!o || typeof o.kind !== 'string') continue;
    const r = applyEdit(s, { t: 'place', kind: o.kind, x: o.x, y: o.y, rot: ([0, 1, 2, 3].includes(o.rot) ? o.rot : 0) as Rot }, defs);
    if (r.ok) s = r.state;
  }
  return s;
}
