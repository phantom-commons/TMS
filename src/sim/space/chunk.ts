import { hashCanonical } from '../hash';
import { BIOME_IDS, BIOMES, biomeAt, type BiomeId } from './biome';
import { hash2, seedOf } from './noise';
import { REGION, structureOfRegion } from './templates';

// Un chunk es una función pura de (semilla del mundo, cx, cy). Tiene tres capas:
//  1. suelo y estáticos (bioma + celdas de estructuras): nunca cambian, no se guardan;
//  2. props sin colisión (arbustos, pinos…): posición sub-celda, solo adorno;
//  3. cosas con estado (cofres, cubos…): id estable `gen:<cx>,<cy>:<kind>:<n>`; solo entran en el registro al tocarlas.

export const CHUNK = 16;
export const CELLS = CHUNK * CHUNK;

export type Prop = { kind: string; u: number; v: number; s: number }; // u,v en octavos de celda dentro del chunk; s = escala %
export type State = Record<string, number | string | boolean>;
export type Thing = { id: string; kind: string; x: number; y: number; state: State };
export type Chunk = {
  cx: number;
  cy: number;
  /** un dígito por celda: índice en BIOME_IDS */
  ground: string;
  /** celdas estáticas de estructuras: [índice dentro del chunk, kind] */
  statics: Array<[number, string]>;
  props: Prop[];
  things: Thing[];
};

export const chunkOf = (x: number, y: number): { cx: number; cy: number } => ({ cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) });
export const cellIndex = (x: number, y: number): number => (((y % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((x % CHUNK) + CHUNK) % CHUNK);
export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;
export const originChunkOfThing = (id: string): { cx: number; cy: number } | null => {
  const m = /^gen:(-?\d+),(-?\d+):/.exec(id);
  return m ? { cx: Number(m[1]), cy: Number(m[2]) } : null;
};

const initialState = (kind: string): State => (kind === 'cofre' ? { open: false } : {});

export function generateChunk(worldSeed: string, cx: number, cy: number): Chunk {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const counters = new Map<string, number>();
  const mkThing = (kind: string, x: number, y: number): Thing => {
    const n = counters.get(kind) ?? 0;
    counters.set(kind, n + 1);
    return { id: `gen:${cx},${cy}:${kind}:${n}`, kind, x, y, state: initialState(kind) };
  };

  let ground = '';
  for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) ground += BIOME_IDS.indexOf(biomeAt(worldSeed, x0 + x, y0 + y));

  const statics: Array<[number, string]> = [];
  const things: Thing[] = [];
  const blocked = new Set<number>();
  // 1) la estructura de la región de este chunk (cabe entera en su región: no hay que mirar vecinas)
  const placed = structureOfRegion(worldSeed, Math.floor((x0) / REGION), Math.floor((y0) / REGION));
  if (placed) {
    const { template: t, x: px, y: py } = placed;
    for (let ty = 0; ty < t.rows.length; ty++) {
      for (let tx = 0; tx < t.rows[ty]!.length; tx++) {
        const wx = px + tx;
        const wy = py + ty;
        if (wx < x0 || wx >= x0 + CHUNK || wy < y0 || wy >= y0 + CHUNK) continue;
        const ch = t.rows[ty]![tx]!;
        if (ch === ' ') continue;
        const i = cellIndex(wx, wy);
        blocked.add(i);
        statics.push([i, ch === '#' ? 'muro' : 'suelo-estructura']);
        if (ch === 'c') things.push(mkThing('cofre', wx, wy));
        else if (ch === 'b') things.push(mkThing('cubo-empujable', wx, wy));
      }
    }
  }
  statics.sort((a, b) => a[0] - b[0]);

  // 2) props y 3) cosas sueltas según el bioma de cada celda
  const sp = seedOf(worldSeed, 'props');
  const st = seedOf(worldSeed, 'things');
  const props: Prop[] = [];
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) {
      const i = y * CHUNK + x;
      if (blocked.has(i)) continue;
      const wx = x0 + x;
      const wy = y0 + y;
      const b = BIOMES[BIOME_IDS[Number(ground[i])] as BiomeId];
      let r = hash2(sp, wx, wy, 0) % 1000;
      for (const [kind, per] of b.props) {
        if (r < per) {
          props.push({ kind, u: x * 8 + (hash2(sp, wx, wy, 1) % 8), v: y * 8 + (hash2(sp, wx, wy, 2) % 8), s: 80 + (hash2(sp, wx, wy, 3) % 41) });
          break;
        }
        r -= per;
      }
      let q = hash2(st, wx, wy, 0) % 1000;
      for (const [kind, per] of b.things) {
        if (q < per) {
          things.push(mkThing(kind, wx, wy));
          blocked.add(i);
          break;
        }
        q -= per;
      }
    }
  }
  return { cx, cy, ground, statics, props, things };
}

export const chunkHash = (c: Chunk): string => hashCanonical(c);

export const biomeOfCell = (c: Chunk, x: number, y: number): BiomeId => BIOME_IDS[Number(c.ground[cellIndex(x, y)])] as BiomeId;
