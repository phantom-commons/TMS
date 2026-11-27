import { describe, expect, it } from 'vitest';
import { VPC, cellIndex, emptyObject, objectId, type VoxelObject } from '../../core/objects';
import { cellAhead, dirOfYaw, placementOrigin } from './placement';
import { defsFromObjects } from './starter';
import { createHouse } from './state';

const solidBox = (sx: number, sy: number, sz: number): VoxelObject => {
  const o = emptyObject(sx, sy, sz);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) o.cells[cellIndex(o, x, y, z)] = 1;
  return o;
};
const small = solidBox(5, 3, 9);
const big = solidBox(16, 10, 6);
const defs = defsFromObjects([small, big]);
const s = createHouse('p');
const SMALL = objectId(small);
const BIG = objectId(big);

describe('placementOrigin', () => {
  it('con encaje de voxel centra la huella en el punto', () => {
    expect(placementOrigin(s, defs, SMALL, 0, 30, 30, 'voxel')).toEqual({ x: 28, y: 29 });
  });
  it('con encaje de casilla alinea a casillas y centra lo pequeño dentro de la casilla', () => {
    const p = placementOrigin(s, defs, SMALL, 0, 30, 30, 'cell');
    expect(p).not.toBeNull();
    // x: 5 voxeles dentro de una casilla de 8 → sobran 3 → margen 1
    expect((p as { x: number }).x % VPC).toBe(1);
    expect((p as { y: number }).y % VPC).toBe(2);
  });
  it('un objeto grande con encaje de casilla queda alineado a la casilla', () => {
    const p = placementOrigin(s, defs, BIG, 0, 33, 33, 'cell') as { x: number; y: number };
    expect(p.x % VPC).toBe(0);
    expect(p.y % VPC).toBe(3); // 10 de fondo ocupa 2 casillas (16): sobran 6 → margen 3
  });
  it('nunca se sale de la habitación', () => {
    expect(placementOrigin(s, defs, BIG, 0, 0, 0, 'voxel')).toEqual({ x: 0, y: 0 });
    expect(placementOrigin(s, defs, BIG, 0, 9999, 9999, 'voxel')).toEqual({ x: s.w * VPC - 16, y: s.d * VPC - 10 });
  });
  it('girar intercambia la huella', () => {
    expect(placementOrigin(s, defs, BIG, 1, 9999, 9999, 'voxel')).toEqual({ x: s.w * VPC - 10, y: s.d * VPC - 16 });
  });
  it('objeto desconocido → null', () => {
    expect(placementOrigin(s, defs, 'obj:' + '0'.repeat(24), 0, 0, 0, 'voxel')).toBeNull();
  });
});

describe('rumbos', () => {
  it('dirOfYaw redondea al cuarto más cercano y envuelve', () => {
    expect(dirOfYaw(0)).toBe(0);
    expect(dirOfYaw(Math.PI / 2 - 0.3)).toBe(1);
    expect(dirOfYaw(Math.PI)).toBe(2);
    expect(dirOfYaw(-Math.PI / 2)).toBe(3);
    expect(dirOfYaw(Math.PI * 2 + 0.1)).toBe(0);
    expect(dirOfYaw(-Math.PI * 2.6)).toBe(3);
  });
  it('cellAhead suma el rumbo a la casilla del jugador', () => {
    const { cx, cy } = s.player;
    expect(cellAhead(s, 0)).toEqual({ cx, cy: cy - 1 });
    expect(cellAhead(s, 1)).toEqual({ cx: cx + 1, cy });
  });
});
