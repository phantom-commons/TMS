// Ruido determinista para la generación. Solo enteros y operaciones aritméticas básicas (nada de Math.sin/random),
// así todos los navegadores calculan lo mismo. `seed` es un entero de 32 bits; ver `seedOf`.

import { seedFromString } from '../prng';

export const seedOf = (worldSeed: string, salt = ''): number => seedFromString(`space:${worldSeed}:${salt}`);

/** Hash de 32 bits de (semilla, x, y, sal). */
export function hash2(seed: number, x: number, y: number, salt = 0): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Número en [0,1) a partir del hash. */
export const rand01 = (seed: number, x: number, y: number, salt = 0): number => hash2(seed, x, y, salt) / 4294967296;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Ruido de valor: `scale` celdas entre puntos de la rejilla. `period` (opcional) lo hace repetible (para texturas). */
export function valueNoise(seed: number, x: number, y: number, scale: number, period = 0): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smooth(gx - x0);
  const fy = smooth(gy - y0);
  const w = (v: number) => (period > 0 ? ((v % period) + period) % period : v);
  const a = rand01(seed, w(x0), w(y0));
  const b = rand01(seed, w(x0 + 1), w(y0));
  const c = rand01(seed, w(x0), w(y0 + 1));
  const d = rand01(seed, w(x0 + 1), w(y0 + 1));
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Suma de octavas, normalizada a [0,1). */
export function fbm(seed: number, x: number, y: number, scale: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let s = scale;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(seed + i * 101, x, y, s) * amp;
    total += amp;
    amp /= 2;
    s = Math.max(1, s / 2);
  }
  return sum / total;
}
