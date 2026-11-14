import { describe, it, expect } from 'vitest';
import { replay } from './replay';
import { RoomState } from './room';
import { generatePillars, homeCode, homeRoomId, homeSeed, mulberry32, starterCubes } from './worldgen';
import { makeActor, emit } from './test-util';
import { key } from './world';

describe('worldgen', () => {
  it('mulberry32 es determinista', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('el código de la home son 12 caracteres base32 y es estable', () => {
    const pk = 'ab'.repeat(32);
    expect(homeCode(pk)).toMatch(/^[a-z2-7]{12}$/);
    expect(homeCode(pk)).toBe(homeCode(pk));
    expect(homeCode(pk)).not.toBe(homeCode('cd'.repeat(32)));
    expect(homeRoomId(pk)).toBe(`home-${homeCode(pk)}`);
  });

  it('pilares y cubos: deterministas, separados y fuera del spawn y la puerta', () => {
    const seed = homeSeed('ab'.repeat(32));
    const spawn = { x: 3, y: 3 };
    const p1 = generatePillars(seed, spawn);
    expect(generatePillars(seed, spawn)).toEqual(p1);
    expect(p1.length).toBeGreaterThanOrEqual(3);
    for (const p of p1) {
      expect(Math.max(Math.abs(p.x - 3), Math.abs(p.y - 3))).toBeGreaterThan(2);
      expect(p.x >= 17 && p.y >= 5 && p.y <= 9).toBe(false);
    }
    const cubes = starterCubes(seed, spawn, p1);
    expect(cubes.length).toBeGreaterThan(0);
    for (const c of cubes) expect(p1.some((p) => p.x === c.x && p.y === c.y)).toBe(false);
  });

  it('la home se reconstruye igual desde el INIT con semilla', () => {
    const a = makeActor();
    a.roomId = homeRoomId(a.id);
    const seed = homeSeed(a.id);
    const init = emit(a, 'INIT', { spawn: { x: 3, y: 3 }, owner: a.id, seed, doorTo: 'lobby' });
    const w1 = replay([init]);
    const w2 = replay([init]);
    expect(w1.seed).toBe(seed);
    expect(w1.cells).toEqual(w2.cells);
    const pillars = generatePillars(seed, { x: 3, y: 3 });
    for (const p of pillars) expect(w1.cells[key(p.x, p.y)].kind).toBe('wall');
    expect(w1.cells[key(19, 7)].targetRoomId).toBe('lobby');
  });

  it('nadie puede reclamar la home de otro', () => {
    const owner = makeActor();
    const thief = makeActor();
    thief.roomId = homeRoomId(owner.id);
    const init = emit(thief, 'INIT', { spawn: { x: 3, y: 3 }, owner: thief.id, seed: homeSeed(thief.id) });
    const room = new RoomState(thief.roomId);
    const res = room.applyConfirmed([{ rseq: 1, relayTime: 0, entry: init }]);
    expect(res.error).toContain('invalid INIT');
  });
});
