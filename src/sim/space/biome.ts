import { fbm, seedOf } from './noise';

// Biomas: dos campos de ruido suaves (altitud y humedad) y una tabla. Es una función pura de (semilla, celda).
// Cada bioma fija el suelo (3 tonos para la textura), qué props salen y con qué densidad (por mil celdas).

export const BIOME_IDS = ['pradera', 'arena', 'roca', 'nieve', 'ceniza'] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export type BiomeDef = {
  id: BiomeId;
  name: string;
  ground: { base: string; alt: string; speck: string };
  /** props sin colisión: [kind, por mil] */
  props: ReadonlyArray<readonly [string, number]>;
  /** objetos con estado repartidos fuera de estructuras: [kind, por mil] */
  things: ReadonlyArray<readonly [string, number]>;
};

export const BIOMES: Record<BiomeId, BiomeDef> = {
  pradera: { id: 'pradera', name: 'Pradera', ground: { base: '#5f9a4a', alt: '#6aa856', speck: '#88c070' }, props: [['arbusto', 60], ['pino', 25]], things: [['cubo-empujable', 3], ['cubo-recogible', 2]] },
  arena: { id: 'arena', name: 'Arenal', ground: { base: '#d2b56e', alt: '#dcc07c', speck: '#b99a52' }, props: [['roca-suelta', 25], ['arbusto', 8]], things: [['hierro', 4], ['cubo-recogible', 2]] },
  roca: { id: 'roca', name: 'Roquedal', ground: { base: '#80828c', alt: '#8c8e98', speck: '#666873' }, props: [['roca-suelta', 70]], things: [['hierro', 9], ['cubo-fijo', 6]] },
  nieve: { id: 'nieve', name: 'Nevada', ground: { base: '#dfe8f0', alt: '#eaf1f7', speck: '#b9c9d8' }, props: [['pino', 35], ['roca-suelta', 12]], things: [['cubo-recogible', 2]] },
  ceniza: { id: 'ceniza', name: 'Ceniza', ground: { base: '#4b4a52', alt: '#55545d', speck: '#2f2e35' }, props: [['roca-suelta', 30]], things: [['hierro', 7], ['cubo-fijo', 4]] },
};

/** Campos de altitud y humedad en [0,1). */
export function fields(worldSeed: string, x: number, y: number): { alt: number; moist: number } {
  return { alt: fbm(seedOf(worldSeed, 'alt'), x, y, 40, 3), moist: fbm(seedOf(worldSeed, 'moist'), x, y, 56, 3) };
}

export function biomeAt(worldSeed: string, x: number, y: number): BiomeId {
  const { alt, moist } = fields(worldSeed, x, y);
  if (alt > 0.66) return 'nieve';
  if (alt > 0.56) return 'roca';
  if (moist < 0.4) return 'arena';
  if (moist < 0.46 && alt < 0.44) return 'ceniza';
  return 'pradera';
}
