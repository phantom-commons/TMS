/**
 * PRNG determinista (mulberry32). Seeded 32-bit.
 * Usado en src/sim en lugar de Math.random() para que clientes y relay coincidan.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash estable de string → semilla para mulberry32 (FNV-1a). */
export function seedFromString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Variante pura de mulberry32 para estados que se guardan y se hashean (la semilla vive dentro del estado de la sim).
 * Devuelve el estado siguiente y un entero de 32 bits sin signo; todo en enteros, sin decimales.
 */
export function mulberry32Step(state: number): { state: number; u32: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: next, u32: (t ^ (t >>> 14)) >>> 0 };
}
