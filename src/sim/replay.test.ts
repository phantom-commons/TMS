import { describe, it, expect } from 'vitest';
import { replay } from './replay';
import { createGenesisRoom, canStep } from './world';
import { makeActor, emit } from './test-util';

function start() {
  const a = makeActor();
  const init = emit(a, 'INIT', { roomId: 'r', spawn: { x: 3, y: 3 }, owner: a.id });
  return { a, init };
}

describe('canStep', () => {
  const w = createGenesisRoom();
  it('permite pasos ortogonales y diagonales libres', () => {
    expect(canStep(w, 5, 5, -1, 0)).toBe(true);
    expect(canStep(w, 5, 5, -1, 1)).toBe(true);
  });
  it('bloquea muros y saltos de más de una celda', () => {
    expect(canStep(w, 1, 5, -1, 0)).toBe(false);
    expect(canStep(w, 5, 5, 2, 0)).toBe(false);
  });
  it('bloquea cortar esquinas (objeto en 6,5)', () => {
    expect(canStep(w, 5, 5, 1, -1)).toBe(false);
  });
});

describe('replay', () => {
  it('reconstruye la posición desde el log', () => {
    const { a, init } = start();
    const w = replay([init, emit(a, 'MOVE', { x: 4, y: 3 }), emit(a, 'MOVE', { x: 5, y: 3 })]);
    expect(w.players[a.id]).toMatchObject({ x: 5, y: 3 });
  });

  it('ignora un MOVE ilegal (teletransporte)', () => {
    const { a, init } = start();
    const w = replay([init, emit(a, 'MOVE', { x: 10, y: 10 })]);
    expect(w.players[a.id]).toMatchObject({ x: 3, y: 3 });
  });

  it('un jugador que no ha entrado no se mueve', () => {
    const { a, init } = start();
    const b = makeActor();
    const w = replay([init, emit(b, 'MOVE', { x: 4, y: 3 }), emit(a, 'MOVE', { x: 4, y: 3 })]);
    expect(w.players[b.id]).toBeUndefined();
  });

  it('ENTER ocupado coloca en la celda libre más cercana', () => {
    const { a, init } = start();
    const b = makeActor();
    const w = replay([init, emit(b, 'ENTER', { x: 3, y: 3 })]);
    const pb = w.players[b.id];
    expect(pb).toBeDefined();
    expect(Math.max(Math.abs(pb.x - 3), Math.abs(pb.y - 3))).toBe(1);
    expect(w.players[a.id]).toMatchObject({ x: 3, y: 3 });
  });

  it('es determinista', () => {
    const { a, init } = start();
    const b = makeActor();
    const log = [init, emit(b, 'ENTER', { x: 3, y: 3 }), emit(a, 'MOVE', { x: 4, y: 3 })];
    expect(JSON.stringify(replay(log))).toBe(JSON.stringify(replay(log)));
  });
});