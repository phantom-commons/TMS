import { describe, expect, it } from 'vitest';
import { createKV } from './kv';
import { knownObject, loadLibrary, registerObject, saveToLibrary } from './object-registry';
import {
  MAX_SIDE,
  VPC,
  cellIndex,
  compileObject,
  emptyObject,
  filledCount,
  footprint,
  gridOf,
  isObjectKind,
  objectId,
  swordTemplate,
  toV2,
  validateObject,
  type VoxelObject,
  type VoxelObjectV1,
} from './objects';

const filledBox = (o: VoxelObject, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c = 1) => {
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.cells[cellIndex(o, x, y, z)] = c;
};

const legacy = (): VoxelObjectV1 => {
  const cells = new Array<number>(4 * 4 * 8).fill(0);
  for (let z = 0; z < 8; z++) for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) cells[x + 4 * (y + 4 * z)] = z < 2 ? 2 : 1;
  return { v: 1, name: 'Vieja', icon: 'x', w: 1, d: 1, h: 2, res: 4, palette: ['#c9ced9', '#8a5a2b'], cells, solid: false };
};

describe('validateObject', () => {
  it('acepta la plantilla y rechaza lo vacío', () => {
    expect(validateObject(swordTemplate())).toBeNull();
    expect(validateObject(emptyObject())).toBe('el objeto está vacío');
  });
  it('rechaza datos incoherentes', () => {
    const base = () => {
      const o = emptyObject(4, 4, 4);
      o.cells[0] = 1;
      return o;
    };
    expect(validateObject({ ...base(), name: '' })).not.toBeNull();
    expect(validateObject({ ...base(), name: 'x'.repeat(25) })).not.toBeNull();
    expect(validateObject({ ...base(), palette: ['rojo'] })).not.toBeNull();
    expect(validateObject({ ...base(), palette: [] })).not.toBeNull();
    expect(validateObject({ ...base(), cells: [1, 0, 0] })).not.toBeNull();
    expect(validateObject({ ...base(), cells: base().cells.map((c) => c + 99) })).not.toBeNull();
    expect(validateObject({ ...base(), sx: 0 })).not.toBeNull();
    expect(validateObject({ ...base(), sz: 17 })).not.toBeNull();
    expect(validateObject({ ...base(), sx: 2.5 })).not.toBeNull();
    expect(validateObject({ ...base(), v: 3 } as never)).not.toBeNull();
  });
  it('acepta el lado máximo y no más', () => {
    const o = emptyObject(MAX_SIDE, MAX_SIDE, MAX_SIDE);
    o.cells[0] = 1;
    expect(validateObject(o)).toBeNull();
  });
});

describe('escala: 1 casilla = 8 voxeles', () => {
  it('la huella son casillas enteras y el tamaño real, voxeles / 8', () => {
    expect(footprint({ sx: 3, sy: 1, sz: 9 })).toEqual({ w: 1, d: 1, h: 2 });
    expect(footprint({ sx: 16, sy: 8, sz: 9 })).toEqual({ w: 2, d: 1, h: 2 });
    const c = compileObject(swordTemplate());
    expect(c.size).toEqual({ x: 3 / VPC, y: 1 / VPC, z: 9 / VPC });
    expect([c.w, c.d, c.h]).toEqual([1, 1, 2]);
  });
  it('una espada mide mucho menos que una cama, aunque ambas sean voxeles', () => {
    const bed = emptyObject(16, 8, 4);
    filledBox(bed, 0, 0, 0, 15, 7, 3);
    expect(compileObject(bed).size.x).toBeGreaterThan(compileObject(swordTemplate()).size.x * 3);
  });
});

describe('objectId', () => {
  it('es estable y cambia con el contenido', () => {
    const a = swordTemplate();
    const b = swordTemplate();
    expect(objectId(a)).toBe(objectId(b));
    expect(isObjectKind(objectId(a))).toBe(true);
    b.cells[cellIndex(b, 0, 0, 0)] = 5;
    expect(objectId(b)).not.toBe(objectId(a));
  });
  it('rechaza ids mal formados', () => {
    expect(isObjectKind('obj:xyz')).toBe(false);
    expect(isObjectKind('bed')).toBe(false);
  });
});

describe('compatibilidad con v1', () => {
  it('un objeto v1 es válido, conserva su id y se lee como v2 del mismo tamaño en casillas', () => {
    const v1 = legacy();
    expect(validateObject(v1)).toBeNull();
    const v2 = toV2(v1);
    expect([v2.sx, v2.sy, v2.sz]).toEqual([8, 8, 16]); // res 4 → x2 voxeles
    expect(filledCount(v2)).toBe(filledCount({ cells: v1.cells }) * 8);
    expect(compileObject(v1).size).toEqual({ x: 1, y: 1, z: 2 });
    expect(registerObject(v1)).toBe(objectId(v1));
    expect(knownObject(objectId(v1))?.obj.v).toBe(2);
  });
  it('v1 con resolución 8 pasa tal cual', () => {
    const cells = new Array<number>(8 * 8 * 8).fill(0);
    cells[0] = 1;
    const v2 = toV2({ ...legacy(), w: 1, d: 1, h: 1, res: 8, cells });
    expect([v2.sx, v2.sy, v2.sz]).toEqual([8, 8, 8]);
    expect(v2.cells[0]).toBe(1);
  });
});

describe('compileObject', () => {
  it('fusiona voxeles iguales en pocas cajas', () => {
    const o = emptyObject(8, 8, 8);
    filledBox(o, 0, 0, 0, 7, 7, 7);
    const c = compileObject(o);
    expect(c.parts).toHaveLength(1);
    expect(c.parts[0]).toMatchObject({ dx: 0, dy: 0, dz: 0, w: 1, d: 1, h: 1 });
    expect(c.blocks).toBe(true);
  });
  it('el volumen de las piezas es el de los voxeles llenos y no se solapan', () => {
    const o = swordTemplate();
    const c = compileObject(o);
    const vol = c.parts.reduce((s, p) => s + p.w * p.d * p.h, 0);
    expect(vol).toBeCloseTo(filledCount(o) / VPC ** 3, 9);
    const { nx, ny, nz } = gridOf(o);
    const cover = new Array(nx * ny * nz).fill(0);
    for (const p of c.parts) {
      for (let z = Math.round(p.dz * VPC); z < Math.round((p.dz + p.h) * VPC); z++)
        for (let y = Math.round(p.dy * VPC); y < Math.round((p.dy + p.d) * VPC); y++)
          for (let x = Math.round(p.dx * VPC); x < Math.round((p.dx + p.w) * VPC); x++) cover[cellIndex(o, x, y, z)]++;
    }
    for (let i = 0; i < cover.length; i++) expect(cover[i]).toBe(o.cells[i] > 0 ? 1 : 0);
  });
  it('conserva los colores', () => {
    const c = compileObject(swordTemplate());
    expect(new Set(c.parts.map((p) => p.color)).size).toBeGreaterThan(1);
    expect(c.blocks).toBe(false);
  });
});

describe('registro y biblioteca', () => {
  const mkKV = () => {
    const store = new Map<string, string>();
    return createKV('t', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
  };
  it('registrar dos veces da el mismo id y un objeto inválido lanza', () => {
    const id = registerObject(swordTemplate());
    expect(registerObject(swordTemplate())).toBe(id);
    expect(knownObject(id)?.compiled.parts.length).toBeGreaterThan(0);
    expect(() => registerObject(emptyObject())).toThrow();
  });
  it('guarda en kv sin duplicar y se recarga ignorando lo dañado', () => {
    const kv = mkKV();
    const id = saveToLibrary(kv, swordTemplate());
    saveToLibrary(kv, swordTemplate());
    expect(loadLibrary(kv)).toHaveLength(1);
    kv.set('objects.library', [swordTemplate(), { v: 2, nombre: 'roto' }, 'basura']);
    const lib = loadLibrary(kv);
    expect(lib).toHaveLength(1);
    expect(lib[0]?.id).toBe(id);
  });
  it('la biblioteca acepta objetos v1 guardados antes', () => {
    const kv = mkKV();
    kv.set('objects.library', [legacy()]);
    const lib = loadLibrary(kv);
    expect(lib).toHaveLength(1);
    expect(lib[0]?.obj.v).toBe(2);
    expect(lib[0]?.id).toBe(objectId(legacy()));
  });
});
