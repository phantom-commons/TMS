import type { Ship } from './ship';

// Parámetros de forma de la nave: datos puros (sin Three, sin azar). La misma receta da la misma malla en cualquier máquina.
// La colisión NO depende de esto: sigue saliendo de HULL_MASK. Esto solo cambia el aspecto.

export type ShipParams = {
  v: 1;
  /** grosor del fuselaje (multiplicador) */
  radius: number;
  /** envergadura de las alas */
  wingSpan: number;
  /** tamaño de la cabina (multiplicador) */
  cabin: number;
  /** alto de la aleta de cola */
  finHeight: number;
  /** lados del fuselaje (menos = más anguloso y barato) */
  sides: number;
  /** tono 0-359; null = el que sale de la semilla */
  hue: number | null;
};

export const PARAM_RANGES = {
  radius: { min: 0.7, max: 1.3, step: 0.05 },
  wingSpan: { min: 0.6, max: 2.2, step: 0.05 },
  cabin: { min: 0.6, max: 1.4, step: 0.05 },
  finHeight: { min: 0.4, max: 2.2, step: 0.05 },
  sides: { min: 5, max: 12, step: 1 },
} as const;

export const DEFAULT_PARAMS: ShipParams = { v: 1, radius: 1, wingSpan: 1.65, cabin: 1, finHeight: 1.3, sides: 8, hue: null };

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Normaliza cualquier cosa leída del disco o de la pantalla: nunca se da por buena. */
export function cleanParams(raw: unknown): ShipParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PARAMS;
  const R = PARAM_RANGES;
  const hue = typeof r.hue === 'number' && Number.isFinite(r.hue) ? ((Math.round(r.hue) % 360) + 360) % 360 : null;
  return {
    v: 1,
    radius: clamp(num(r.radius, d.radius), R.radius.min, R.radius.max),
    wingSpan: clamp(num(r.wingSpan, d.wingSpan), R.wingSpan.min, R.wingSpan.max),
    cabin: clamp(num(r.cabin, d.cabin), R.cabin.min, R.cabin.max),
    finHeight: clamp(num(r.finHeight, d.finHeight), R.finHeight.min, R.finHeight.max),
    sides: Math.round(clamp(num(r.sides, d.sides), R.sides.min, R.sides.max)),
    hue,
  };
}

/** Variante determinista por semilla (para que cada jugador tenga una nave distinta sin tocar nada). */
export function paramsFromSeed(h: (a: number) => number): ShipParams {
  const pick = (r: { min: number; max: number; step: number }, k: number) => r.min + (h(k) % (Math.round((r.max - r.min) / r.step) + 1)) * r.step;
  return cleanParams({ radius: pick(PARAM_RANGES.radius, 1), wingSpan: pick(PARAM_RANGES.wingSpan, 2), cabin: pick(PARAM_RANGES.cabin, 3), finHeight: pick(PARAM_RANGES.finHeight, 4), sides: pick(PARAM_RANGES.sides, 5), hue: null });
}

const KEY = 'ship.params.v1';
type Store = { get: <T>(k: string, f: T) => T; set: (k: string, v: unknown) => void };
export const loadParams = (kv: Store): ShipParams => cleanParams(kv.get<unknown>(KEY, null));
export const saveParams = (kv: Store, p: ShipParams): void => kv.set(KEY, cleanParams(p));

/** Receta compartible: texto corto y estable. */
export const paramsToText = (p: ShipParams): string => JSON.stringify(cleanParams(p));
export function paramsFromText(t: string): ShipParams | null {
  try {
    return cleanParams(JSON.parse(t));
  } catch {
    return null;
  }
}

export type { Ship };
