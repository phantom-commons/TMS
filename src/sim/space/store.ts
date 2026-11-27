import { newShip, MODULE_IDS, type Ship } from './ship';

// Guardado de la nave en el kv del navegador. Lo leído nunca se da por bueno: si no encaja, se parte de una nave nueva.

type Store = { get: <T>(k: string, f: T) => T; set: (k: string, v: unknown) => void };
export const SHIP_KEY = 'star.ship.v1';

export function validShip(raw: unknown, seed: string): Ship | null {
  const r = raw as Partial<Ship> | null;
  if (!r || r.v !== 1 || r.seed !== seed || !['flying', 'crashed', 'landed'].includes(r.status as string)) return null;
  if (r.status !== 'flying') {
    const at = r.at;
    if (!at || !Number.isInteger(at.x) || !Number.isInteger(at.y)) return null;
  }
  if (!r.modules || MODULE_IDS.some((m) => typeof r.modules![m] !== 'boolean')) return null;
  return r as Ship;
}

export const loadShip = (kv: Store, seed: string): Ship => validShip(kv.get<unknown>(SHIP_KEY, null), seed) ?? newShip(seed);
export const saveShip = (kv: Store, ship: Ship): void => kv.set(SHIP_KEY, ship);
