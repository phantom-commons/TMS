import { describe, expect, it } from 'vitest';
import { configErrors, configOfDef, deleteRoomDef, loadRoomDefs, newRoomDef, normalizeRoomDef, saveRoomDef, validateRoomDef } from './room-def';
import type { KV } from './kv';

const memKV = (): KV => {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string, d: T) => (m.has(k) ? (m.get(k) as T) : d), set: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))), remove: (k: string) => void m.delete(k) } as unknown as KV;
};

describe('rooms creadas por el usuario', () => {
  it('una room nueva es válida y su config también', () => {
    const d = newRoomDef();
    expect(validateRoomDef(d)).toBeNull();
    expect(configErrors(d)).toEqual([]);
    expect(configOfDef(d).experience).toBe('house');
  });
  it('acota tamaños, vistas y reglas', () => {
    const d = normalizeRoomDef({ v: 1, id: 'c-1', name: '  x '.repeat(30), seed: 's', w: 99, d: 1, views: ['iso', 'ui', 'iso'], defaultView: 'fps', rules: [
      { when: { t: 'step', cx: 50, cy: -3 }, then: { t: 'say', text: 'a'.repeat(200) } },
      { when: { t: 'nope' }, then: { t: 'say', text: 'x' } },
    ] })!;
    expect(d.w).toBe(14);
    expect(d.d).toBe(4);
    expect(d.views).toEqual(['iso']);
    expect(d.defaultView).toBe('iso');
    expect(d.rules).toHaveLength(1);
    expect(d.rules[0]!.when).toEqual({ t: 'step', cx: 13, cy: 0 });
    expect((d.rules[0]!.then as { text: string }).text.length).toBe(80);
  });
  it('rechaza ids ajenos y guarda, lista y borra', () => {
    expect(normalizeRoomDef({ v: 1, id: 'house' })).toBeNull();
    const kv = memKV();
    const d = saveRoomDef(kv, newRoomDef('Una'));
    saveRoomDef(kv, { ...d, name: 'Otra' });
    expect(loadRoomDefs(kv).map((r) => r.name)).toEqual(['Otra']);
    deleteRoomDef(kv, d.id);
    expect(loadRoomDefs(kv)).toEqual([]);
  });
});
