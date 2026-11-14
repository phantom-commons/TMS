import { describe, it, expect } from 'vitest';
import { replay } from './replay';
import { presenceState } from './presence';
import {
  isError,
  planDrop,
  planLock,
  planPickUp,
  planPush,
  planPushTo,
  screenToGrid,
} from './actions';
import { makeActor, emit } from './test-util';

function scene(spawn = { x: 3, y: 3 }, cube = { x: 4, y: 3 }) {
  const a = makeActor();
  const log = [
    emit(a, 'INIT', { spawn }),
    emit(a, 'PLACE', { entityId: 'cube-1', x: cube.x, y: cube.y, blocksMovement: true }),
  ];
  return { a, log };
}

describe('screenToGrid', () => {
  it('sin giro, arriba es -y', () => {
    expect(screenToGrid(0, -1, 0)).toEqual({ dx: 0, dy: -1 });
    expect(screenToGrid(1, 0, 0)).toEqual({ dx: 1, dy: 0 });
  });
  it('en isométrica "arriba" es la diagonal -x,-y', () => {
    expect(screenToGrid(0, -1, Math.PI / 4)).toEqual({ dx: -1, dy: -1 });
    expect(screenToGrid(1, -1, Math.PI / 4)).toEqual({ dx: 0, dy: -1 });
  });
  it('en primera persona girando a la derecha, adelante es +x', () => {
    expect(screenToGrid(0, -1, -Math.PI / 2)).toEqual({ dx: 1, dy: 0 });
  });
});

describe('planPush', () => {
  it('empuja un objeto libre un paso más allá', () => {
    const { a, log } = scene();
    const w = replay(log);
    const plan = planPush(w, a.id, 1, 0);
    expect(plan).toEqual({ entityId: 'cube-1', x: 5, y: 3 });
    if (!plan) throw new Error('sin plan');
    const w2 = replay([...log, emit(a, 'PUSH', plan)]);
    expect(w2.entities['cube-1'].location).toMatchObject({ kind: 'room', x: 5, y: 3 });
  });

  it('no empuja contra un muro', () => {
    const { a, log } = scene({ x: 2, y: 3 }, { x: 1, y: 3 });
    expect(planPush(replay(log), a.id, -1, 0)).toBeNull();
  });

  it('no empuja un objeto bloqueado', () => {
    const { a, log } = scene();
    const w = replay([...log, emit(a, 'LOCK', { entityId: 'cube-1' })]);
    expect(planPush(w, a.id, 1, 0)).toBeNull();
    const p = planPushTo(w, a.id, 'cube-1', 5, 3);
    expect(isError(p) && p.error).toContain('bloqueado');
  });
});

describe('recoger, soltar y bloquear', () => {
  it('recoger y soltar lo deja en una casilla libre contigua', () => {
    const { a, log } = scene();
    let w = replay(log);
    const up = planPickUp(w, a.id);
    if (isError(up)) throw new Error(up.error);
    w = replay([...log, emit(a, 'PICK_UP', up)]);
    expect(w.inventories[a.id]).toEqual(['cube-1']);

    const down = planDrop(w, a.id);
    if (isError(down)) throw new Error(down.error);
    const w2 = replay([...log, emit(a, 'PICK_UP', up), emit(a, 'DROP', down)]);
    expect(w2.entities['cube-1'].location).toMatchObject({ kind: 'room', x: down.x, y: down.y });
    expect(w2.inventories[a.id]).toEqual([]);
  });

  it('mochila vacía → error', () => {
    const { a, log } = scene();
    const d = planDrop(replay(log), a.id);
    expect(isError(d)).toBe(true);
  });

  it('solo el creador bloquea, y luego desbloquea', () => {
    const { a, log } = scene();
    const w = replay(log);
    expect(planLock(w, a.id)).toEqual({ entityId: 'cube-1', type: 'LOCK' });
    const w2 = replay([...log, emit(a, 'LOCK', { entityId: 'cube-1' })]);
    expect(planLock(w2, a.id)).toEqual({ entityId: 'cube-1', type: 'UNLOCK' });

    const b = makeActor();
    const w3 = replay([...log, emit(b, 'ENTER', { x: 3, y: 4 })]);
    const lb = planLock(w3, b.id);
    expect(isError(lb)).toBe(true);
  });
});

describe('presenceState', () => {
  const online = new Set(['a']);
  it('tú y los conectados están sólidos', () => {
    expect(presenceState('me', 'me', online, 0, 1e12)).toBe('online');
    expect(presenceState('a', 'me', online, 0, 1e12)).toBe('online');
  });
  it('desconectado: fantasma y luego oculto', () => {
    expect(presenceState('b', 'me', online, 1000, 2000, 5000)).toBe('ghost');
    expect(presenceState('b', 'me', online, 1000, 9000, 5000)).toBe('hidden');
  });
});
