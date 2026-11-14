import { describe, it, expect } from 'vitest';
import { replay } from './replay';
import { createGenesisRoom, canStep } from './world';
import { makeActor, emit } from './test-util';

function start() {
  const a = makeActor();
  const init = emit(a, 'INIT', { spawn: { x: 3, y: 3 } });
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
  it('bloquea el cubo legacy de las rooms v1', () => {
    expect(canStep(w, 5, 5, 1, 0)).toBe(false);
  });
});

describe('replay', () => {
  it('reconstruye la posición desde el log', () => {
    const { a, init } = start();
    const w = replay([init, emit(a, 'MOVE', { x: 4, y: 3 }), emit(a, 'MOVE', { x: 5, y: 3 })]);
    expect(w.players[a.id]).toMatchObject({ x: 5, y: 3 });
  });

  it('permite crear el cubo inicial como objeto firmado en una room v2', () => {
    const { a, init } = start();
    const place = emit(a, 'PLACE', { entityId: 'starter-cube', x: 4, y: 3 });
    const w = replay([init, place]);
    expect(w.entities['starter-cube']).toMatchObject({
      createdBy: a.id,
      location: { kind: 'room', roomId: init.roomId, x: 4, y: 3 },
      blocksMovement: true,
    });
  });



  it('el autor firmado debe coincidir con el owner declarado en INIT', () => {
    const actor = makeActor();
    const init = emit(actor, 'INIT', { spawn: { x: 3, y: 3 }, owner: 'not-the-author' });
    expect(() => replay([init])).toThrow('INIT owner must match its signing author');
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



  it('rechaza colocar objetos fuera del alcance del jugador', () => {
    const { a, init } = start();
    const world = replay([init, emit(a, 'PLACE', { entityId: 'far-cube', x: 8, y: 8 })]);
    expect(world.entities['far-cube']).toBeUndefined();
  });

  it('rechaza interacciones con entidades lejanas o guardadas en inventario', () => {
    const { a, init } = start();
    const entries = [
      init,
      emit(a, 'PLACE', { entityId: 'near-cube', x: 4, y: 4, blocksMovement: false }),
      emit(a, 'MOVE', { x: 4, y: 3 }),
      emit(a, 'PICK_UP', { entityId: 'near-cube' }),
      emit(a, 'INTERACT', { entityId: 'near-cube', kind: 'click' }),
    ];
    const world = replay(entries);
    expect(world.entities['near-cube'].location).toEqual({ kind: 'inventory', owner: a.id });
    expect(world.entityStats['near-cube'].clickCount).toBe(0);
  });

  it('no trata DOOR o NOTE como eventos exitosos sin semántica', () => {
    const { a, init } = start();
    const world = replay([init, emit(a, 'NOTE', { text: 'hello' })]);
    expect(world.authorHistory[a.id]).toHaveLength(1);
  });

  it('es determinista', () => {
    const { a, init } = start();
    const b = makeActor();
    const log = [init, emit(b, 'ENTER', { x: 3, y: 3 }), emit(a, 'MOVE', { x: 4, y: 3 })];
    expect(JSON.stringify(replay(log))).toBe(JSON.stringify(replay(log)));
  });
});
