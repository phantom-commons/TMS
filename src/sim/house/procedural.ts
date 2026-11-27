import { mulberry32, seedFromString } from '../prng';

// Generador procedural de colores: una semilla (p. ej. la clave del dueño) da siempre la misma paleta de casa.
// Función pura: sin Math.random ni reloj. El detalle visual es una función de (semilla, material), nunca se guarda.

export type HousePalette = {
  wall: string;
  wallTrim: string;
  floor: string;
  floorAlt: string;
  wood: string;
  fabric: string;
  accent: string;
  accent2: string;
  leaf: string;
  metal: string;
  light: string;
  dark: string;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  const k = (n: number) => (n + hh / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}

/** Luminancia relativa aproximada (0–1) de un color '#rrggbb', para exigir contraste mínimo. */
export function luma(hex: string): number {
  const c = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
}

export function paletteFromSeed(seed: string): HousePalette {
  const rnd = mulberry32(seedFromString(`house-palette:${seed}`));
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const base = between(0, 360);
  const warm = between(18, 42); // madera: siempre cálida
  const accentHue = base + between(150, 210); // complementario
  const wall = hsl(base, between(0.18, 0.38), between(0.68, 0.78));
  // suelo claramente más oscuro que la pared: si el sorteo no lo da, se oscurece hasta que lo dé
  const floorSat = between(0.3, 0.5);
  let floorL = between(0.28, 0.4);
  let floor = hsl(warm, floorSat, floorL);
  for (let i = 0; i < 8 && luma(wall) - luma(floor) < 0.15; i++) {
    floorL *= 0.85;
    floor = hsl(warm, floorSat, floorL);
  }
  return {
    wall,
    wallTrim: hsl(base, between(0.15, 0.3), between(0.8, 0.88)),
    floor,
    floorAlt: hsl(warm, floorSat, floorL + between(0.05, 0.08)),
    wood: hsl(warm + between(-6, 6), between(0.35, 0.55), between(0.36, 0.48)),
    fabric: hsl(base + between(-30, 30), between(0.28, 0.5), between(0.52, 0.64)),
    accent: hsl(accentHue, between(0.4, 0.62), between(0.5, 0.62)),
    accent2: hsl(accentHue + between(50, 90), between(0.4, 0.62), between(0.52, 0.66)),
    leaf: hsl(between(95, 140), between(0.4, 0.6), between(0.34, 0.46)),
    metal: hsl(base, between(0.04, 0.12), between(0.66, 0.76)),
    light: hsl(between(40, 55), between(0.7, 0.95), between(0.82, 0.9)),
    dark: hsl(base, between(0.15, 0.3), between(0.14, 0.22)),
  };
}
