import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import { bytesToHex } from '../sim/hash';
import { addContact, CARD_PREFIX, displayName, getContact, loadContacts, makeCard, parseContact, removeContact, renameContact } from './contacts';
import { createKV } from './kv';

const key = (n: number) => new Uint8Array(32).fill(n);
const pub = (k: Uint8Array) => bytesToHex(ed.getPublicKey(k));
const A = key(1);
const B = key(2);
const kv = () => createKV('t', null);

describe('contactos', () => {
  it('la tarjeta firmada se lee y trae clave y nombre', () => {
    const p = parseContact(makeCard('Luna', B));
    expect(p).toMatchObject({ pubkey: pub(B), name: 'Luna', signed: true, how: 'card' });
  });
  it('una tarjeta manipulada se rechaza', () => {
    const card = makeCard('Luna', B);
    const raw = card.slice(CARD_PREFIX.length);
    const json = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4)));
    json.doc.name = 'Otra';
    const bad = CARD_PREFIX + btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseContact(bad)).toBeNull();
  });
  it('una tarjeta con la clave cambiada por otra no vale', () => {
    const card = makeCard('Luna', B);
    const raw = card.slice(CARD_PREFIX.length);
    const json = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4)));
    json.doc.pubkey = pub(A);
    const bad = CARD_PREFIX + btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseContact(bad)).toBeNull();
  });
  it('acepta una clave suelta, en mayúsculas, o dentro de un enlace', () => {
    const k = pub(B);
    expect(parseContact(k)).toMatchObject({ pubkey: k, signed: false, how: 'key' });
    expect(parseContact(k.toUpperCase())?.pubkey).toBe(k);
    expect(parseContact(`https://x.test/#/visit/${k}`)?.pubkey).toBe(k);
    expect(parseContact(`https://x.test/#/${makeCard('Ana', B)}`)).toMatchObject({ pubkey: k, name: 'Ana', how: 'link' });
  });
  it('rechaza basura y claves de longitud errónea', () => {
    expect(parseContact('')).toBeNull();
    expect(parseContact('hola')).toBeNull();
    expect(parseContact('ab'.repeat(31))).toBeNull();
    expect(parseContact('ab'.repeat(33))).toBeNull();
    expect(parseContact(CARD_PREFIX + '!!!')).toBeNull();
  });
  it('añade, no se añade a sí mismo y no duplica', () => {
    const s = kv();
    const me = pub(A);
    expect(addContact(s, me, { pubkey: me, how: 'key' }, 1).ok).toBe(false);
    const r = addContact(s, me, { pubkey: pub(B), name: 'Luna', how: 'tap' }, 1);
    expect(r).toMatchObject({ ok: true, created: true });
    const r2 = addContact(s, me, { pubkey: pub(B), name: 'Luna', how: 'key' }, 9);
    expect(r2).toMatchObject({ ok: true, created: false });
    expect(loadContacts(s)).toHaveLength(1);
    expect(getContact(s, pub(B))?.addedAt).toBe(1);
  });
  it('un alias propio no se pisa con el nombre de una tarjeta posterior', () => {
    const s = kv();
    const me = pub(A);
    addContact(s, me, { pubkey: pub(B), name: 'Luna', how: 'tap' }, 1);
    expect(renameContact(s, pub(B), 'Mi amiga')).toBe(true);
    addContact(s, me, { pubkey: pub(B), name: 'Luna2', how: 'card', signed: true }, 2);
    expect(displayName(s, pub(B))).toBe('Mi amiga');
    expect(getContact(s, pub(B))?.name).toBe('Luna2');
    expect(getContact(s, pub(B))?.signed).toBe(true);
    renameContact(s, pub(B), '');
    expect(displayName(s, pub(B))).toBe('Luna2');
  });
  it('sin contacto el nombre es la clave abreviada; se puede borrar', () => {
    const s = kv();
    expect(displayName(s, pub(B))).toBe(`${pub(B).slice(0, 4)}…${pub(B).slice(-4)}`);
    addContact(s, pub(A), { pubkey: pub(B), how: 'key' }, 1);
    expect(removeContact(s, pub(B))).toBe(true);
    expect(removeContact(s, pub(B))).toBe(false);
  });
  it('limpia caracteres de control y recorta el nombre', () => {
    const p = parseContact(makeCard('  Lu\u0000na' + 'x'.repeat(60), B));
    expect(p?.name).toBe(('Luna' + 'x'.repeat(60)).slice(0, 32));
  });
});
