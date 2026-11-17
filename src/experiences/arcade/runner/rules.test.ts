import { describe, expect, it } from 'vitest';
import { createKV, type StorageLike } from '../../../core/kv';
import { validateManifest } from '../../../sim/nodes/manifest';
import { RUNNER_MANIFEST } from '../../../sim/nodes/presets/runner';
import { getBest, submitScore } from '../scores';
import { isDefaultRules, loadRules, resetRules, saveRules, scoreIdFor } from './rules';

const memoryStorage = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const custom = (strength: number) => {
  const m = structuredClone(RUNNER_MANIFEST);
  (m.world.find((n) => n.type === 'gravity')!.params as Record<string, unknown>).strength = strength;
  return m;
};

describe('reglas de Salto en el dispositivo', () => {
  it('sin nada guardado usa las de fábrica', () => {
    const kv = createKV('t', memoryStorage());
    expect(loadRules(kv)).toBe(RUNNER_MANIFEST);
    expect(isDefaultRules(loadRules(kv))).toBe(true);
  });
  it('guarda y recarga unas reglas personalizadas; guardar las de fábrica borra el guardado', () => {
    const storage = memoryStorage();
    const kv = createKV('t', storage);
    saveRules(kv, custom(3000));
    expect(loadRules(createKV('t', storage))).toEqual(custom(3000));
    saveRules(kv, RUNNER_MANIFEST);
    expect(loadRules(createKV('t', storage))).toBe(RUNNER_MANIFEST);
  });
  it('restablecer devuelve las de fábrica', () => {
    const kv = createKV('t', memoryStorage());
    saveRules(kv, custom(3000));
    expect(resetRules(kv)).toBe(RUNNER_MANIFEST);
    expect(loadRules(kv)).toBe(RUNNER_MANIFEST);
  });
  it('un guardado manipulado se acota o se descarta, nunca rompe', () => {
    const kv = createKV('t', memoryStorage());
    kv.set('rules.runner', custom(999999));
    const loaded = loadRules(kv);
    expect(validateManifest(loaded)).toBeNull();
    expect(loaded.world.find((n) => n.type === 'gravity')!.params.strength).toBe(8000);
    kv.set('rules.runner', { v: 1, basura: true });
    expect(loadRules(kv)).toBe(RUNNER_MANIFEST);
    kv.set('rules.runner', 'texto');
    expect(loadRules(kv)).toBe(RUNNER_MANIFEST);
  });
  it('cada combinación de reglas tiene su propio récord', () => {
    const kv = createKV('t', memoryStorage());
    expect(scoreIdFor(RUNNER_MANIFEST)).toBe('runner');
    const a = scoreIdFor(custom(3000));
    const b = scoreIdFor(custom(3500));
    expect(a).not.toBe('runner');
    expect(a).not.toBe(b);
    expect(scoreIdFor(custom(3000))).toBe(a);
    submitScore(kv, 'runner', 500);
    submitScore(kv, a, 80);
    expect(getBest(kv, 'runner')).toBe(500);
    expect(getBest(kv, a)).toBe(80);
    expect(getBest(kv, b)).toBe(0);
  });
});
