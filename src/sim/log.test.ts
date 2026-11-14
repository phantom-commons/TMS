import { describe, it, expect } from 'vitest';
import { verifyChain } from './log';
import { makeActor, emit } from './test-util';

function chain() {
  const a = makeActor();
  const entries = [
    emit(a, 'INIT', { roomId: 'r', spawn: { x: 3, y: 3 }, owner: a.id }),
    emit(a, 'MOVE', { x: 4, y: 3 }),
    emit(a, 'MOVE', { x: 5, y: 3 }),
  ];
  return { a, entries };
}

describe('verifyChain', () => {
  it('acepta una cadena íntegra', () => {
    const { a, entries } = chain();
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
});