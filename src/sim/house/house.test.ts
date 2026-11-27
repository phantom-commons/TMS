import { describe, expect, it } from 'vitest';
import { VPC, cellIndex, emptyObject, objectId, type VoxelObject } from '../../core/objects';
import { luma, paletteFromSeed } from './procedural';
import { defsFromObjects, starterHouse, starterObjects } from './starter';
import { DIRS, MOVE_TICKS, applyEdit, cellBlocked, createHouse, houseHash, nearestFreeCell, objectAt, stepHouse, type HouseState } from './state';

const box = (sx: number, sy: number, sz: number, solid = true): VoxelObject => {
  const o = emptyObject(sx, sy, sz);
  o.solid = solid;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) o.cells[cellIndex(o, x, y, z)] = 1;
  return o;
};
const crate = box(8, 8, 8);
const slab = box(16, 8, 2, false);
const defs = defsFromObjects([crate, slab, box(5, 3, 9)]);
const CRATE = objectId(crate);
const SLAB = objectId(slab);

const run = (s: HouseState, ...moves: Array<0 | 1 | 2 | 3 | null>) => {
  for (const m of moves) {
    s = stepHouse(s, { move: m }, defs);
    for (let i = 0; i < MOVE_TICKS; i++) s = stepHouse(s, {}, defs);
  }
  return s;
};

describe('movimiento por ticks', () => {
  it('avanza una casilla por paso y anima con from/moveLeft', () => {
    let s = createHouse('s');
    const { cx, cy } = s.player;
    s = stepHouse(s, { move: 0 }, defs);
    expect(s.player).toMatchObject({ cx, cy: cy - 1, fromX: cx, fromY: cy, moveLeft: MOVE_TICKS });
    // mientras dura el paso se ignora otro movimiento
    const mid = stepHouse(s, { move: 1 }, defs);
    expect(mid.player.cx).toBe(cx);
    expect(mid.player.moveLeft).toBe(MOVE_TICKS - 1);
  });
  it('mantener pulsado encadena pasos a ritmo fijo', () => {
    let s = createHouse('s');
    const y0 = s.player.cy;
    for (let i = 0; i < MOVE_TICKS * 3; i++) s = stepHouse(s, { move: 0 }, defs);
    expect(s.player.cy).toBe(y0 - 3);
  });
  it('las paredes y los objetos sólidos bloquean; los no sólidos no', () => {
    let s = createHouse('s');
    s = run(s, 3, 3, 3, 3, 3, 3, 3, 3); // contra la pared oeste
    expect(s.player.cx).toBe(0);
    const placed = applyEdit(s, { t: 'place', kind: CRATE, x: 1 * VPC, y: s.player.cy * VPC }, defs);
    if (!placed.ok) throw new Error(placed.error);
    expect(cellBlocked(placed.state, defs, 1, s.player.cy)).toBe(true);
    expect(run(placed.state, 1).player.cx).toBe(0);
    const rug = applyEdit(s, { t: 'place', kind: SLAB, x: 8, y: s.player.cy * VPC }, defs);
    if (!rug.ok) throw new Error(rug.error);
    expect(run(rug.state, 1).player.cx).toBe(1);
  });
  it('es determinista: la misma secuencia da el mismo hash', () => {
    const seq: Array<0 | 1 | 2 | 3 | null> = [0, 0, 1, null, 2, 3, 3, 0];
    expect(houseHash(run(createHouse('a'), ...seq))).toBe(houseHash(run(createHouse('a'), ...seq)));
    expect(houseHash(run(createHouse('a'), ...seq))).not.toBe(houseHash(run(createHouse('b'), ...seq)));
  });
  it('los cuatro rumbos coinciden con el convenio de la cámara (0 norte, 1 este)', () => {
    expect(DIRS[0]).toEqual([0, -1]);
    expect(DIRS[1]).toEqual([1, 0]);
  });
});

describe('editar la casa', () => {
  const base = () => createHouse('e');
  it('coloca con id nuevo y no pisa a otro sólido', () => {
    const a = applyEdit(base(), { t: 'place', kind: CRATE, x: 0, y: 0 }, defs);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.id).toBe(1);
    expect(applyEdit(a.state, { t: 'place', kind: CRATE, x: 4, y: 4 }, defs)).toMatchObject({ ok: false, error: 'ahí ya hay algo' });
    expect(applyEdit(a.state, { t: 'place', kind: CRATE, x: 8, y: 0 }, defs).ok).toBe(true);
  });
  it('rechaza fuera de la habitación, objetos desconocidos y estar en medio', () => {
    expect(applyEdit(base(), { t: 'place', kind: CRATE, x: 60, y: 0 }, defs)).toMatchObject({ ok: false });
    expect(applyEdit(base(), { t: 'place', kind: CRATE, x: -1, y: 0 }, defs)).toMatchObject({ ok: false });
    expect(applyEdit(base(), { t: 'place', kind: 'obj:' + '0'.repeat(24), x: 0, y: 0 }, defs)).toMatchObject({ error: 'objeto desconocido' });
    const s = base();
    expect(applyEdit(s, { t: 'place', kind: CRATE, x: s.player.cx * VPC, y: s.player.cy * VPC }, defs)).toMatchObject({ error: 'estás en medio' });
  });
  it('girar cambia la huella y comprueba que cabe', () => {
    const wide = box(16, 8, 4);
    const d2 = defsFromObjects([wide]);
    const k = objectId(wide);
    const a = applyEdit(createHouse('g'), { t: 'place', kind: k, x: 0, y: 56 }, d2); // 16×8 pegado al borde sur
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(applyEdit(a.state, { t: 'rotate', id: 1 }, d2)).toMatchObject({ ok: false, error: 'fuera de la habitación' }); // 8×16 se saldría
    const b = applyEdit(createHouse('g'), { t: 'place', kind: k, x: 0, y: 0 }, d2);
    if (!b.ok) throw new Error(b.error);
    const r = applyEdit(b.state, { t: 'rotate', id: 1 }, d2);
    expect(r.ok && r.state.objects[0]?.rot).toBe(1);
  });
  it('mover y quitar', () => {
    const a = applyEdit(base(), { t: 'place', kind: CRATE, x: 0, y: 0 }, defs);
    if (!a.ok) throw new Error(a.error);
    const m = applyEdit(a.state, { t: 'move', id: 1, x: 16, y: 16 }, defs);
    expect(m.ok && m.state.objects[0]).toMatchObject({ x: 16, y: 16 });
    expect(applyEdit(a.state, { t: 'move', id: 9, x: 0, y: 0 }, defs)).toMatchObject({ ok: false });
    const r = applyEdit(a.state, { t: 'remove', id: 1 }, defs);
    expect(r.ok && r.state.objects).toHaveLength(0);
  });
  it('objectAt y nearestFreeCell', () => {
    const a = applyEdit(base(), { t: 'place', kind: CRATE, x: 16, y: 16 }, defs);
    if (!a.ok) throw new Error(a.error);
    expect(objectAt(a.state, defs, 20, 20)?.id).toBe(1);
    expect(objectAt(a.state, defs, 40, 40)).toBeNull();
    const free = nearestFreeCell(a.state, defs, 2, 2);
    expect(free && !cellBlocked(a.state, defs, free.cx, free.cy)).toBe(true);
    expect(free).not.toEqual({ cx: 2, cy: 2 });
  });
  it('un objeto sólido no se coloca sobre el jugador pero uno plano sí', () => {
    const s = base();
    const r = applyEdit(s, { t: 'place', kind: SLAB, x: s.player.cx * VPC, y: s.player.cy * VPC }, defs);
    expect(r.ok).toBe(true);
  });
});

describe('colores procedurales', () => {
  it('la misma semilla da la misma paleta y semillas distintas, otra', () => {
    expect(paletteFromSeed('ana')).toEqual(paletteFromSeed('ana'));
    expect(paletteFromSeed('ana').wall).not.toBe(paletteFromSeed('luis').wall);
  });
  it('todos los colores son #rrggbb y el suelo siempre es más oscuro que la pared', () => {
    for (let i = 0; i < 200; i++) {
      const p = paletteFromSeed(`semilla-${i}`);
      for (const c of Object.values(p)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(luma(p.wall) - luma(p.floor)).toBeGreaterThan(0.14);
      expect(luma(p.floorAlt)).toBeGreaterThan(luma(p.floor));
    }
  });
});

describe('casa de serie', () => {
  it('los muebles son objetos voxel válidos y caben todos', () => {
    const { state, objects, kinds } = starterHouse('ana');
    expect(state.objects).toHaveLength(7);
    expect(new Set(kinds).size).toBe(7);
    expect(objects.every((o) => o.sx <= 16 && o.sy <= 16 && o.sz <= 16)).toBe(true);
  });
  it('es determinista y cambia de color con la semilla (pero no de forma)', () => {
    expect(houseHash(starterHouse('ana').state)).toBe(houseHash(starterHouse('ana').state));
    const a = starterObjects(paletteFromSeed('ana'));
    const b = starterObjects(paletteFromSeed('luis'));
    expect(objectId(a.bed)).not.toBe(objectId(b.bed));
    expect(a.bed.cells).toEqual(b.bed.cells);
    expect(a.bed.palette).not.toEqual(b.bed.palette);
  });
  it('el jugador puede cruzar la sala hasta la mesa', () => {
    const { state, objects } = starterHouse('ana');
    const d = defsFromObjects(objects);
    expect(cellBlocked(state, d, state.player.cx, state.player.cy)).toBe(false);
    // la cama es mucho más grande que una espada y la silla más baja que la mesa
    const set = starterObjects(paletteFromSeed('ana'));
    expect(set.bed.sx * set.bed.sy).toBeGreaterThan(set.chair.sx * set.chair.sy * 4);
    expect(set.chair.sz).toBeGreaterThan(set.table.sz); // silla con respaldo, mesa baja
  });
});
