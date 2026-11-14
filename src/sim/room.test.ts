import { describe, it, expect } from 'vitest';
import { RoomState, type RelayEntry } from './room';
import type { LogEntry } from './log';
import { makeActor, emit } from './test-util';

function relay() {
  let n = 0;
  return (entry: LogEntry): RelayEntry => ({ rseq: ++n, relayTime: 0, entry });
}

describe('RoomState', () => {
  it('construye el mundo con varios autores', () => {
    const rel = relay();
    const a = makeActor();
    const b = makeActor();
    const room = new RoomState('r');
    const res = room.applyConfirmed([
      rel(emit(a, 'INIT', { spawn: { x: 3, y: 3 } })),
      rel(emit(b, 'ENTER', { x: 3, y: 3 })),
      rel(emit(a, 'MOVE', { x: 4, y: 3 })),
    ]);
    expect(res.error).toBeUndefined();
    expect(res.accepted).toHaveLength(3);
    const w = room.world();
    if (!w) throw new Error('no world');
    expect(w.players[a.id]).toMatchObject({ x: 4, y: 3 });
    expect(w.players[b.id]).toBeDefined();
  });

  it('rechaza una cadena rota', () => {
    const rel = relay();
    const a = makeActor();
    const e0 = emit(a, 'INIT', { spawn: { x: 3, y: 3 } });
    emit(a, 'MOVE', { x: 4, y: 3 }); // omitida
    const e2 = emit(a, 'MOVE', { x: 5, y: 3 });
    const res = new RoomState('r').applyConfirmed([rel(e0), rel(e2)]);
    expect(res.error).toContain('broken chain');
  });

  it('detecta huecos de rseq', () => {
    const a = makeActor();
    const e0 = emit(a, 'INIT', { spawn: { x: 3, y: 3 } });
    const e1 = emit(a, 'MOVE', { x: 4, y: 3 });
    const res = new RoomState('r').applyConfirmed([
      { rseq: 1, relayTime: 0, entry: e0 },
      { rseq: 3, relayTime: 0, entry: e1 },
    ]);
    expect(res.gap).toBe(true);
    expect(res.accepted).toHaveLength(1);
  });

  it('rechaza entradas de otra room', () => {
    const a = makeActor('otra');
    const e0 = emit(a, 'INIT', { spawn: { x: 3, y: 3 } });
    const res = new RoomState('r').applyConfirmed([{ rseq: 1, relayTime: 0, entry: e0 }]);
    expect(res.error).toContain('wrong room');
  });


  it('rechaza una acción firmada pero semánticamente inválida', () => {
    const rel = relay();
    const a = makeActor();
    const room = new RoomState('r');
    room.applyConfirmed([rel(emit(a, 'INIT', { spawn: { x: 3, y: 3 } }))]);
    const invalid = emit(a, 'PICK_UP', { entityId: 'does-not-exist' });
    const res = room.applyConfirmed([rel(invalid)]);
    expect(res.error).toContain('invalid PICK_UP action');
    expect(room.lastRseq).toBe(1);
  });


  it('rechaza una acción firmada pero semánticamente inválida', () => {
    const rel = relay();
    const a = makeActor();
    const room = new RoomState('r');
    room.applyConfirmed([rel(emit(a, 'INIT', { spawn: { x: 3, y: 3 } }))]);
    const invalid = emit(a, 'PICK_UP', { entityId: 'does-not-exist' });
    const res = room.applyConfirmed([rel(invalid)]);
    expect(res.error).toContain('invalid PICK_UP action');
    expect(room.lastRseq).toBe(1);
  });

  it('el pendiente es optimista y se limpia al confirmarse', () => {
    const rel = relay();
    const a = makeActor();
    const room = new RoomState('r');
    room.applyConfirmed([rel(emit(a, 'INIT', { spawn: { x: 3, y: 3 } }))]);

    const mv = emit(a, 'MOVE', { x: 4, y: 3 });
    room.addPending(mv);
    expect(room.world()?.players[a.id]).toMatchObject({ x: 4, y: 3 });
    expect(room.nextFor(a.id).seq).toBe(2);

    room.applyConfirmed([rel(mv)]);
    expect(room.world()?.players[a.id]).toMatchObject({ x: 4, y: 3 });
    expect(room.nextFor(a.id)).toEqual({ seq: 2, prevHash: mv.hash });
  });
});