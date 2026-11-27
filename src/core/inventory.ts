// Ayudantes puros para contar objetos por clase. Las unidades reales (firmadas) viven en core/units;
// aquí solo se cuenta: tuyas (usables) − colocadas en tus rooms = libres.

export type Counts = Record<string, number>;

/** Unidades libres = tuyas − colocadas. Nunca negativo. */
export function freeUnits(owned: Counts, used: Counts, kind: string): number {
  return Math.max(0, (owned[kind] ?? 0) - (used[kind] ?? 0));
}

export const countKinds = (kinds: Iterable<string>): Counts => {
  const c: Counts = {};
  for (const k of kinds) c[k] = (c[k] ?? 0) + 1;
  return c;
};

export const mergeCounts = (...list: Counts[]): Counts => {
  const c: Counts = {};
  for (const l of list) for (const [k, v] of Object.entries(l)) c[k] = (c[k] ?? 0) + v;
  return c;
};
