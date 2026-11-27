import { BIOMES, type BiomeId } from './biome';
import { hash2, rand01, seedOf, valueNoise } from './noise';

// Texturas de suelo generadas: un tile RGBA pequeño y repetible por bioma. Es la misma función con otra paleta y
// otros umbrales. Devuelve bytes; el render los pone en un canvas o un DataTexture (nearest, sin filtrado).

export const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export function tileTexture(biome: BiomeId, worldSeed: string, size = 16): Uint8ClampedArray {
  const g = BIOMES[biome].ground;
  const base = rgb(g.base);
  const alt = rgb(g.alt);
  const speck = rgb(g.speck);
  const sd = seedOf(worldSeed, `tile:${biome}`);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // ruido periódico: el borde derecho encaja con el izquierdo
      const n = valueNoise(sd, x, y, Math.max(2, size / 4), Math.max(1, Math.ceil(size / Math.max(2, size / 4))));
      const px = n > 0.5 ? alt : base;
      const spk = rand01(sd, x, y, 5) < 0.07;
      const c = spk ? speck : px;
      const jitter = (hash2(sd, x, y, 9) % 7) - 3;
      const i = (y * size + x) * 4;
      out[i] = c[0] + jitter;
      out[i + 1] = c[1] + jitter;
      out[i + 2] = c[2] + jitter;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Textura de hoja para planos cruzados: manchas opacas sobre transparente (alfa 0/255). */
export function leafTexture(tone: string, worldSeed: string, size = 16): Uint8ClampedArray {
  const [r, g, b] = rgb(tone);
  const sd = seedOf(worldSeed, `leaf:${tone}`);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.6;
      const inside = dx * dx + dy * dy * 0.8 < 0.22 + (valueNoise(sd, x, y, 3) - 0.5) * 0.12;
      const i = (y * size + x) * 4;
      const shade = ((hash2(sd, x, y, 2) % 5) - 2) * 4 + (y < size / 2 ? 10 : 0);
      out[i] = r + shade;
      out[i + 1] = g + shade;
      out[i + 2] = b + shade;
      out[i + 3] = inside ? 255 : 0;
    }
  }
  return out;
}
