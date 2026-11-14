import { describe, it, expect } from 'vitest';
import { verifyChain, verifyEntry } from './log';
import { makeActor, emit, emitLegacy } from './test-util';

function chain() {
  const a = makeActor();
  const entries = [
    emit(a, 'INIT', { spawn: { x: 3, y: 3 } }),
    emit(a, 'MOVE', { x: 4, y: 3 }),
    emit(a, 'MOVE', { x: 5, y: 3 }),
  ];
  return { a, entries };
}

describe('verifyChain / v2 signatures', () => {
  it('acepta una cadena íntegra', () => {
    const { a, entries } = chain();
    expect(entries.every((entry) => entry.version === 2)).toBe(true);
    expect(verifyChain(entries, a.id).ok).toBe(true);
  });

  it('detecta un payload alterado', () => {
    const { entries } = chain();
    entries[1] = { ...entries[1], payload: { x: 999, y: 3 } };
    const v = verifyChain(entries);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('bad hash or sig at seq 1');
  });

  it('detecta una entrada omitida', () => {
    const { entries } = chain();
    expect(verifyChain([entries[0], entries[2]]).ok).toBe(false);
  });

  it('detecta un autor inesperado', () => {
    const { entries } = chain();
    const other = makeActor();
    expect(verifyChain(entries, other.id).ok).toBe(false);
  });


  it('sigue verificando cadenas v1 y permite continuar con entradas v2', () => {
    const actor = makeActor();
    const oldInit = emitLegacy(actor, 'INIT', { spawn: { x: 3, y: 3 } });
    const oldMove = emitLegacy(actor, 'MOVE', { x: 4, y: 3 });
    const newMove = emit(actor, 'MOVE', { x: 5, y: 3 });
    expect(oldInit.version).toBeUndefined();
    expect(newMove.version).toBe(2);
    expect(verifyChain([oldInit, oldMove, newMove], actor.id).ok).toBe(true);
  });

  it('protege type y seq, no solo payload', () => {
    const { entries } = chain();
    expect(verifyEntry({ ...entries[1], type: 'NOTE' })).toBe(false);
    expect(verifyEntry({ ...entries[1], seq: 17 })).toBe(false);
  });
});
