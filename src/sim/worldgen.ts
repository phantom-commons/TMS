import { hashCanonical } from './hash';
import { ROOM_H, ROOM_W } from './world';

// Generación determinista (puro, sin Date/Math.random): la misma semilla produce siempre la misma sala.
// Tu habitación de inicio sale de tu clave pública, es decir, de tus 24 palabras: funciona offline
// y cualquiera puede recalcularla para comprobar que el INIT no hace trampa.

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export type Cell2 = { x: number; y: number };

/** PRNG pequeño y rápido (mulberry32). */
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

export const isSeed = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

export function seedToInt(seedHex: string): number {
  const a = parseInt(seedHex.slice(0, 8), 16);
  const b = parseInt(seedHex.slice(8, 16), 16);
  return (a ^ b) >>> 0;
}

/** Semilla de tu sala de inicio (hex de 64). */
export function homeSeed(ownerPubkeyHex: string): string {
  return hashCanonical({ domain: 'TMS_HOME_SEED', owner: ownerPubkeyHex });
}

/** Código corto de 12 caracteres (Base32 minúscula, 60 bits) derivado de tu clave pública. */
export function homeCode(ownerPubkeyHex: string): string {
  const h = hashCanonical({ domain: 'TMS_HOME_CODE', owner: ownerPubkeyHex });
  let out = '';
  for (let i = 0; i < 12; i++) out += B32[parseInt(h.slice(i * 2, i * 2 + 2), 16) & 31];
  return out;
}

export const homeRoomId = (ownerPubkeyHex: string): string => `home-${homeCode(ownerPubkeyHex)}`;

export const isHomeRoomId = (roomId: string): boolean => roomId.startsWith('home-');

/** Tono (0–359) para teñir el suelo de la sala. */
export function paletteHue(seedHex: string): number {
  return Math.floor(mulberry32(seedToInt(seedHex) ^ 0x9e3779b9)() * 360);
}

const cheb = (a: Cell2, b: Cell2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Pilares sueltos (nunca juntos, nunca sobre el spawn ni tapando la puerta). */
export function generatePillars(seedHex: string, spawn: Cell2): Cell2[] {
  const rnd = mulberry32(seedToInt(seedHex));
  const want = 5 + Math.floor(rnd() * 4);
  const out: Cell2[] = [];
  for (let tries = 0; tries < 200 && out.length < want; tries++) {
    const c = { x: 1 + Math.floor(rnd() * (ROOM_W - 2)), y: 1 + Math.floor(rnd() * (ROOM_H - 2)) };
    if (cheb(c, spawn) <= 2) continue;
    if (c.x >= ROOM_W - 3 && c.y >= 5 && c.y <= 9) continue; // pasillo de la puerta
    if (out.some((p) => cheb(p, c) < 2)) continue;
    out.push(c);
  }
  return out;
}

/** Posiciones de los cubos iniciales (libres, lejos de pilares y del spawn). */
export function starterCubes(seedHex: string, spawn: Cell2, pillars: Cell2[], n = 3): Cell2[] {
  const rnd = mulberry32(seedToInt(seedHex) ^ 0x85ebca6b);
  const out: Cell2[] = [];
  for (let tries = 0; tries < 300 && out.length < n; tries++) {
    const c = { x: 2 + Math.floor(rnd() * (ROOM_W - 4)), y: 2 + Math.floor(rnd() * (ROOM_H - 4)) };
    if (cheb(c, spawn) <= 1) continue;
    if (c.x >= ROOM_W - 3 && c.y >= 5 && c.y <= 9) continue;
    if (pillars.some((p) => cheb(p, c) < 1)) continue;
    if (out.some((p) => cheb(p, c) < 2)) continue;
    out.push(c);
  }
  return out;
}
