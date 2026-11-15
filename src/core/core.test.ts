import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { createKV, type StorageLike } from './kv';
import { signDoc, verifyDoc } from './signed-doc';
import { ROOMS, roomById } from './room-config';

const fakeStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('kv', () => {
  it('guarda y lee JSON por namespace', () => {
    const st = fakeStorage();
    const a = createKV('aaa', st);
    const b = createKV('bbb', st);
    a.set('x', { n: 1 });
    expect(a.get('x', null)).toEqual({ n: 1 });
    expect(b.get('x', 'vacío')).toBe('vacío');
    a.remove('x');
    expect(a.get('x', 0)).toBe(0);
  });
  it('cae a memoria si el almacenamiento falla', () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    const kv = createKV('z', broken);
    kv.set('k', 5);
    expect(kv.get('k', 0)).toBe(5);
  });
  it('un valor corrupto devuelve el valor por defecto', () => {
    const st = fakeStorage();
    st.setItem('tms.x.n.k', '{no json');
    expect(createKV('n', st).get('k', 'def')).toBe('def');
  });
});

describe('signed-doc', () => {
  const priv = ed.utils.randomSecretKey();
  it('firma y verifica; detecta manipulación y firmante distinto', () => {
    const s = signDoc('D', { a: 1, b: [2, 3], c: undefined }, priv);
    expect(verifyDoc('D', s)).toBe(true);
    expect(verifyDoc('D', s, s.signer)).toBe(true);
    expect(verifyDoc('OTRO', s)).toBe(false);
    expect(verifyDoc('D', { ...s, doc: { ...s.doc, a: 2 } })).toBe(false);
    expect(verifyDoc('D', s, 'f'.repeat(64))).toBe(false);
  });
  it('sobrevive a un viaje por JSON', () => {
    const s = signDoc('D', { x: null, y: 'z' }, priv);
    expect(verifyDoc('D', JSON.parse(JSON.stringify(s)))).toBe(true);
  });
});

describe('room-config', () => {
  it('ids únicos y cada room declara su política', () => {
    expect(new Set(ROOMS.map((r) => r.id)).size).toBe(ROOMS.length);
    expect(roomById('snake')?.policy).toEqual({ camera: 'locked', edit: 'none' });
    expect(roomById('my-room')?.policy.edit).toBe('access');
  });
  it('las rooms de página traen href', () => {
    for (const r of ROOMS.filter((x) => x.launch === 'page')) expect(r.href).toBeTruthy();
  });
});
