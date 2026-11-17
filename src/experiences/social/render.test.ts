import { describe, expect, it } from 'vitest';
import { ROOM_SIZE, WALL_H } from './model';
import { fitView, project, toScreen, unprojectFloor, type RoomView } from './render';

const KINDS: RoomView[] = ['iso', 'top'];

describe('proyección por vista', () => {
  it('iso conserva la proyección 2:1 original', () => {
    expect(project(2, 0, 0)).toEqual({ x: 64, y: 32 });
    expect(project(0, 2, 0, 'iso')).toEqual({ x: -64, y: 32 });
    expect(project(0, 0, 1)).toEqual({ x: 0, y: -32 });
  });

  it('cenital: x va a la derecha, y hacia abajo y la altura sube', () => {
    const o = project(0, 0, 0, 'top');
    const px = project(1, 0, 0, 'top');
    const py = project(0, 1, 0, 'top');
    const pz = project(0, 0, 1, 'top');
    expect(px.x).toBeGreaterThan(o.x);
    expect(px.y).toBe(o.y);
    expect(py.y).toBeGreaterThan(o.y);
    expect(py.x).toBe(o.x);
    expect(pz.y).toBeLessThan(o.y);
  });

  for (const kind of KINDS) {
    it(`${kind}: pantalla → suelo es la inversa de suelo → pantalla`, () => {
      const v = fitView(390, 600, 1.3, 12, -9, kind);
      for (const [x, y] of [[0, 0], [3, 5], [ROOM_SIZE - 0.5, 2.25], [7.5, ROOM_SIZE]]) {
        const s = toScreen(v, x, y, 0);
        const f = unprojectFloor(v, s.x, s.y);
        expect(f.x).toBeCloseTo(x, 6);
        expect(f.y).toBeCloseTo(y, 6);
      }
    });

    it(`${kind}: la habitación entera cabe en pantalla`, () => {
      const w = 390;
      const h = 640;
      const v = fitView(w, h, 1, 0, 0, kind);
      for (const x of [0, ROOM_SIZE]) {
        for (const y of [0, ROOM_SIZE]) {
          for (const z of [0, WALL_H]) {
            const p = toScreen(v, x, y, z);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(w);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(h);
          }
        }
      }
    });
  }

  it('iso centra igual que antes (ox = mitad del ancho)', () => {
    expect(fitView(400, 500).ox).toBeCloseTo(200);
  });
});
