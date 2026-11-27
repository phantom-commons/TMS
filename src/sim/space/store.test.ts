import { describe, expect, it } from 'vitest';
import { createKV } from '../../core/kv';
import { crash, newShip } from './ship';
import { loadShip, saveShip, validShip } from './store';
import { hatchSpot, nearHatch, nearObject } from './tutorial';

describe('guardado de la nave', () => {
  it('guarda y recupera', () => {
    const kv = createKV('ship', null);
    const s = crash(newShip('semilla'));
    saveShip(kv, s);
    expect(loadShip(kv, 'semilla')).toEqual(s);
  });
  it('sin guardado, o con basura, o de otra semilla: nave nueva en vuelo', () => {
    const kv = createKV('ship2', null);
    expect(loadShip(kv, 'a').status).toBe('flying');
    kv.set('star.ship.v1', { v: 1, seed: 'otra', status: 'crashed', at: { x: 1, y: 1 }, modules: {} });
    expect(loadShip(kv, 'a').status).toBe('flying');
    kv.set('star.ship.v1', 'basura');
    expect(loadShip(kv, 'a').status).toBe('flying');
  });
  it('rechaza estrellada sin posición o con módulos incompletos', () => {
    const ok = crash(newShip('s'));
    expect(validShip({ ...ok, at: null }, 's')).toBeNull();
    expect(validShip({ ...ok, at: { x: 1.5, y: 2 } }, 's')).toBeNull();
    expect(validShip({ ...ok, modules: { casco: true } }, 's')).toBeNull();
    expect(validShip(ok, 's')).toEqual(ok);
  });
});

describe('hechos del tutorial', () => {
  it('la escotilla está en el centro de la pared sur y se detecta cerca', () => {
    expect(hatchSpot(8, 8)).toEqual({ x: 4, y: 7 });
    expect(nearHatch(4, 6, 8, 8)).toBe(true);
    expect(nearHatch(5, 7, 8, 8)).toBe(true);
    expect(nearHatch(4, 4, 8, 8)).toBe(false);
    expect(nearHatch(0, 0, 8, 8)).toBe(false);
  });
  it('objeto cerca: a dos celdas o menos', () => {
    expect(nearObject(3, 3, [{ x: 5, y: 3 }])).toBe(true);
    expect(nearObject(3, 3, [{ x: 6, y: 3 }])).toBe(false);
    expect(nearObject(3, 3, [])).toBe(false);
  });
});
