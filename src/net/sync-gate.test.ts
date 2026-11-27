import { describe, expect, it } from 'vitest';
import { MAX_RESYNCS, holdsAction, nextSyncAction } from './sync-gate';

const base = { error: false, gap: false, behind: false, rebuilt: false, resyncs: 0 };

describe('puesta al día con el relay', () => {
  it('termina en ready cuando ya está al día', () => {
    expect(nextSyncAction(base)).toBe('ready');
  });
  it('pide lo que falta con hueco o retraso, pero no para siempre', () => {
    expect(nextSyncAction({ ...base, gap: true })).toBe('resync');
    expect(nextSyncAction({ ...base, behind: true, resyncs: MAX_RESYNCS - 1 })).toBe('resync');
    expect(nextSyncAction({ ...base, behind: true, resyncs: MAX_RESYNCS })).toBe('rebuild');
    expect(nextSyncAction({ ...base, behind: true, resyncs: MAX_RESYNCS, rebuilt: true })).toBe('fail');
  });
  it('una caché que no encaja se reconstruye una vez; si vuelve a fallar se declara fallo en vez de quedarse colgado', () => {
    expect(nextSyncAction({ ...base, error: true })).toBe('rebuild');
    expect(nextSyncAction({ ...base, error: true, rebuilt: true })).toBe('fail');
  });
  it('retiene solo mover/interactuar y solo mientras sincroniza', () => {
    const syncing = { online: true, connected: true, ready: false, failed: false };
    expect(holdsAction('MOVE', syncing)).toBe(true);
    expect(holdsAction('INTERACT', syncing)).toBe(true);
    expect(holdsAction('INIT', syncing)).toBe(false);
    expect(holdsAction('PLACE', syncing)).toBe(false);
    expect(holdsAction('MOVE', { ...syncing, ready: true })).toBe(false);
    expect(holdsAction('MOVE', { ...syncing, failed: true })).toBe(false);
    expect(holdsAction('MOVE', { ...syncing, connected: false })).toBe(false);
    expect(holdsAction('MOVE', { ...syncing, online: false })).toBe(false);
  });
});
