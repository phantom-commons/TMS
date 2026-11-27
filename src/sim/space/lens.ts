import { BIOME_IDS, BIOMES } from './biome';
import { cellIndex, CHUNK, type Chunk } from './chunk';
import { sheetOf } from './sheets';

// Lentes: la misma información, otra lectura. «Normal» es lo que ve el jugador; las demás enseñan los datos
// (puntos azules sobre negro, mapas de durabilidad…). Son funciones puras: el render solo pinta lo que devuelven.

export const LENSES = ['normal', 'bioma', 'solidos', 'durabilidad', 'puntos'] as const;
export type Lens = (typeof LENSES)[number];
export type Dot = { x: number; y: number; color: string };

const gray = (v: number): string => {
  const h = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
};

export function cellColor(lens: Lens, c: Chunk, lx: number, ly: number): string {
  const i = ly * CHUNK + lx;
  const biome = BIOMES[BIOME_IDS[Number(c.ground[i])]!]!;
  const wx = c.cx * CHUNK + lx;
  const wy = c.cy * CHUNK + ly;
  const stat = c.statics.find(([k]) => k === i)?.[1];
  const thing = c.things.find((t) => t.x === wx && t.y === wy);
  switch (lens) {
    case 'bioma':
      return biome.ground.base;
    case 'solidos':
      return (stat && sheetOf(stat)?.tags.includes('solido')) || (thing && sheetOf(thing.kind)?.tags.includes('solido')) ? '#ff5d73' : '#10131a';
    case 'durabilidad': {
      if (!thing) return '#10131a';
      const max = sheetOf(thing.kind)?.durability || 1;
      const cur = typeof thing.state.dur === 'number' ? thing.state.dur : max;
      return gray((cur / max) * 255);
    }
    case 'puntos':
      return thing || stat ? '#4da3ff' : '#000000';
    default:
      return thing ? thingColor(thing.kind) : stat === 'muro' ? '#6d6a74' : stat ? '#a09a8c' : biome.ground.base;
  }
}

const TONES = { suelo: '#a09a8c', roca: '#80828c', hoja: '#4e8a3e', madera: '#8a5a32', metal: '#b9bfc9', acento: '#e0a23a', cristal: '#6fd3e0' } as const;
export const thingColor = (kind: string): string => TONES[sheetOf(kind)?.visual.tone ?? 'suelo'];

/** Capa de puntos (nivel de detalle 0): una por celda con contenido. */
export function dots(c: Chunk, lens: Lens = 'puntos'): Dot[] {
  const out: Dot[] = [];
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const wx = c.cx * CHUNK + lx;
      const wy = c.cy * CHUNK + ly;
      if (c.statics.some(([k]) => k === cellIndex(wx, wy)) || c.things.some((t) => t.x === wx && t.y === wy)) out.push({ x: wx, y: wy, color: cellColor(lens, c, lx, ly) });
    }
  }
  return out;
}

/** Nivel de detalle según la distancia en celdas: 0 puntos, 1 cubos, 2 formas, 3 texturas. */
export const lodFor = (distance: number): 0 | 1 | 2 | 3 => (distance > 64 ? 0 : distance > 32 ? 1 : distance > 12 ? 2 : 3);
