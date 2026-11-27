import { cellIndex, emptyObject, objectId, type ObjectKind, type VoxelObject } from '../../core/objects';
import { applyEdit, createHouse, type EditOp, type HouseState, type ObjectDefs } from './state';
import { paletteFromSeed, type HousePalette } from './procedural';

// Muebles de serie: son objetos voxel como los que crea cualquiera en el Taller, pero con colores que salen de la
// paleta procedural de la casa. Así la misma cama es distinta en cada casa y es un objeto más, sin código aparte.

type Painter = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) => void;

function make(name: string, sx: number, sy: number, sz: number, palette: string[], solid: boolean, paint: (b: Painter) => void): VoxelObject {
  const o = emptyObject(sx, sy, sz);
  o.name = name;
  o.solid = solid;
  o.palette = palette;
  const b: Painter = (x0, y0, z0, x1, y1, z1, c) => {
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.cells[cellIndex(o, x, y, z)] = c;
  };
  paint(b);
  return o;
}

/** Colores de cada mueble: 1 madera, 2 tela, 3 claro, 4 oscuro, 5 hoja, 6 metal, 7 acento, 8 acento 2. */
const pal = (p: HousePalette) => [p.wood, p.fabric, p.light, p.dark, p.leaf, p.metal, p.accent, p.accent2];

export type StarterKey = 'bed' | 'table' | 'chair' | 'lamp' | 'plant' | 'rug' | 'shelf';

export function starterObjects(p: HousePalette): Record<StarterKey, VoxelObject> {
  const c = pal(p);
  return {
    bed: make('Cama', 16, 10, 6, c, true, (b) => {
      b(0, 0, 0, 15, 9, 1, 1); // somier
      b(0, 0, 2, 15, 9, 3, 2); // colchón
      b(0, 0, 4, 15, 0, 5, 1); // cabecero
      b(1, 1, 4, 6, 3, 4, 3); // almohada
      b(0, 5, 3, 15, 9, 3, 7); // manta
    }),
    table: make('Mesa', 14, 8, 7, c, true, (b) => {
      b(0, 0, 6, 13, 7, 6, 1);
      for (const [x, y] of [[0, 0], [12, 0], [0, 6], [12, 6]] as const) b(x, y, 0, x + 1, y + 1, 5, 1);
    }),
    chair: make('Silla', 5, 5, 10, c, true, (b) => {
      b(0, 0, 3, 4, 4, 4, 2);
      for (const [x, y] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) b(x, y, 0, x, y, 2, 1);
      b(0, 4, 5, 4, 4, 9, 1);
    }),
    lamp: make('Lámpara', 4, 4, 14, c, true, (b) => {
      b(0, 0, 0, 3, 3, 0, 6);
      b(1, 1, 1, 2, 2, 8, 4);
      b(0, 0, 9, 3, 3, 13, 3);
    }),
    plant: make('Planta', 5, 5, 9, c, true, (b) => {
      b(1, 1, 0, 3, 3, 2, 7);
      b(2, 2, 3, 2, 2, 4, 5);
      b(0, 0, 5, 4, 4, 6, 5);
      b(1, 1, 7, 3, 3, 8, 5);
    }),
    rug: make('Alfombra', 16, 12, 1, c, false, (b) => {
      b(0, 0, 0, 15, 11, 0, 8);
      b(2, 2, 0, 13, 9, 0, 7);
    }),
    shelf: make('Estantería', 12, 4, 16, c, true, (b) => {
      b(0, 0, 0, 11, 0, 15, 1); // fondo
      b(0, 0, 0, 0, 3, 15, 1);
      b(11, 0, 0, 11, 3, 15, 1);
      for (const z of [0, 5, 10, 15]) b(0, 0, z, 11, 3, z, 1);
      const books = [7, 2, 8, 6, 7, 2, 8, 6, 2];
      for (const [row, z0] of [[0, 1], [1, 6], [2, 11]] as const) {
        for (let i = 0; i < 9; i++) {
          if ((i + row) % 4 === 3) continue; // huecos entre libros
          b(1 + i, 1, z0, 1 + i, 3, z0 + 3 - ((i + row) % 2), books[(i + row) % books.length] as number);
        }
      }
    }),
  };
}

/** Dónde va cada mueble en la casa de serie (voxeles; 1 casilla = 8). */
const LAYOUT: Array<{ key: StarterKey; x: number; y: number; rot?: 0 | 1 | 2 | 3 }> = [
  { key: 'rug', x: 24, y: 24 },
  { key: 'bed', x: 2, y: 0 },
  { key: 'lamp', x: 20, y: 2 },
  { key: 'shelf', x: 44, y: 0 },
  { key: 'table', x: 44, y: 28 },
  { key: 'chair', x: 48, y: 37 },
  { key: 'plant', x: 58, y: 58 },
];

export function defsFromObjects(objs: Iterable<VoxelObject>): ObjectDefs {
  const map = new Map<string, VoxelObject>();
  for (const o of objs) map.set(objectId(o), o);
  return { info: (kind) => (map.has(kind) ? { sx: (map.get(kind) as VoxelObject).sx, sy: (map.get(kind) as VoxelObject).sy, sz: (map.get(kind) as VoxelObject).sz, solid: (map.get(kind) as VoxelObject).solid } : null) };
}

/** Casa inicial de un dueño: paleta procedural + muebles de serie colocados. Determinista para una semilla. */
export function starterHouse(seed: string): { state: HouseState; objects: VoxelObject[]; kinds: ObjectKind[]; palette: HousePalette } {
  const palette = paletteFromSeed(seed);
  const set = starterObjects(palette);
  const objects = Object.values(set);
  const defs = defsFromObjects(objects);
  let state = createHouse(seed);
  for (const it of LAYOUT) {
    const op: EditOp = { t: 'place', kind: objectId(set[it.key]), x: it.x, y: it.y, rot: it.rot ?? 0 };
    const r = applyEdit(state, op, defs);
    if (!r.ok) throw new Error(`casa de serie inválida (${it.key}): ${r.error}`);
    state = r.state;
  }
  return { state, objects, kinds: objects.map((o) => objectId(o)), palette };
}
