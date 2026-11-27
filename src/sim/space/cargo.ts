import { mergeCounts, type Counts } from '../../core/inventory';
import { MODULES, repair, type ModuleId, type Ship } from './ship';

// Carga: lo que llevas ENCIMA (se puede perder al morir: queda en una cápsula) y lo GUARDADO en la nave (a salvo).
// Depositar es manual. Reparar gasta primero lo que llevas y luego lo guardado. Puro; el guardado vive en el kv.

export type Cargo = { carried: Counts; stored: Counts };
export const emptyCargo = (): Cargo => ({ carried: {}, stored: {} });

const clean = (c: Counts): Counts => Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));
const total = (c: Counts, k: string): number => c[k] ?? 0;

export function deposit(cargo: Cargo, kind: string, n = Infinity): Cargo {
  const take = Math.min(n, total(cargo.carried, kind));
  if (take <= 0) return cargo;
  return { carried: clean({ ...cargo.carried, [kind]: total(cargo.carried, kind) - take }), stored: { ...cargo.stored, [kind]: total(cargo.stored, kind) + take } };
}
export function withdraw(cargo: Cargo, kind: string, n = Infinity): Cargo {
  const take = Math.min(n, total(cargo.stored, kind));
  if (take <= 0) return cargo;
  return { stored: clean({ ...cargo.stored, [kind]: total(cargo.stored, kind) - take }), carried: { ...cargo.carried, [kind]: total(cargo.carried, kind) + take } };
}
export const depositAll = (cargo: Cargo): Cargo => Object.keys(cargo.carried).reduce((c, k) => deposit(c, k), cargo);

/** Todo lo que tienes a mano para gastar: encima + guardado. */
export const available = (cargo: Cargo): Counts => mergeCounts(cargo.carried, cargo.stored);

/** Gasta `need` de lo que llevas y luego de lo guardado. */
export function spend(cargo: Cargo, need: Counts): Cargo | null {
  const carried = { ...cargo.carried };
  const stored = { ...cargo.stored };
  for (const [k, n] of Object.entries(need)) {
    const fromCarried = Math.min(n, total(carried, k));
    const rest = n - fromCarried;
    if (rest > total(stored, k)) return null;
    carried[k] = total(carried, k) - fromCarried;
    stored[k] = total(stored, k) - rest;
  }
  return { carried: clean(carried), stored: clean(stored) };
}

export type CargoRepair = { ok: true; ship: Ship; cargo: Cargo } | { ok: false; reason: string };

export function repairFromCargo(ship: Ship, id: ModuleId, cargo: Cargo): CargoRepair {
  const r = repair(ship, id, available(cargo));
  if (!r.ok) return r;
  const next = spend(cargo, r.consumed);
  return next ? { ok: true, ship: r.ship, cargo: next } : { ok: false, reason: 'Te faltan piezas.' };
}

/** Lo que pide un módulo y lo que tienes de cada cosa, para mostrarlo. */
export const needsOf = (id: ModuleId, cargo: Cargo): Array<{ kind: string; need: number; have: number }> =>
  Object.entries(MODULES[id].needs).map(([kind, need]) => ({ kind, need, have: total(available(cargo), kind) }));

type Store = { get: <T>(k: string, f: T) => T; set: (k: string, v: unknown) => void };
export const CARRIED_KEY = 'star.carried.v1';
export const STORED_KEY = 'star.stored.v1';
const counts = (v: unknown): Counts =>
  v && typeof v === 'object' ? clean(Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, n]) => Number.isInteger(n) && (n as number) > 0).map(([k, n]) => [k, n as number]))) : {};
export const loadCargo = (kv: Store): Cargo => ({ carried: counts(kv.get<unknown>(CARRIED_KEY, {})), stored: counts(kv.get<unknown>(STORED_KEY, {})) });
export function saveCargo(kv: Store, c: Cargo): void {
  kv.set(CARRIED_KEY, c.carried);
  kv.set(STORED_KEY, c.stored);
}
