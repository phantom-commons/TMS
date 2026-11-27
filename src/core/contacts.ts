import { signDoc, verifyDoc, type SignedDoc } from './signed-doc';
import type { KV } from './kv';

// Contactos: una libreta local de claves públicas con nombre, para no pegar 64 caracteres cada vez.
// Se añaden tocando a otro jugador en una sala, pegando su clave, o leyendo su tarjeta firmada.
// La tarjeta es un documento firmado por su dueño: demuestra que esa clave dice llamarse así,
// pero el nombre sigue siendo solo una etiqueta (nadie garantiza que sea único); la clave es la identidad.

export const CARD_PREFIX = 'tms-c.';
const DOMAIN = 'tms.contact.v1';
const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_NAME = 32;
export const MAX_CONTACTS = 500;

export type Card = { v: 1; pubkey: string; name: string };
export type Contact = { pubkey: string; name: string; alias?: string; addedAt: number; how: 'tap' | 'key' | 'card' | 'link'; signed?: boolean };
type Book = Record<string, Contact>;

const KEY = 'contacts.v1';

export const isPubkey = (s: string): boolean => HEX64.test(s);

const cleanName = (s: string): string =>
  [...s]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, MAX_NAME);

const b64 = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string): string => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Tarjeta de contacto firmada, lista para pasar por texto. */
export function makeCard(name: string, privateKey: Uint8Array): string {
  const probe = signDoc<Card>(DOMAIN, { v: 1, pubkey: '', name: cleanName(name) }, privateKey);
  const doc: Card = { v: 1, pubkey: probe.signer, name: cleanName(name) };
  return CARD_PREFIX + b64(JSON.stringify(signDoc(DOMAIN, doc, privateKey)));
}

export type Parsed = { pubkey: string; name?: string; how: Contact['how']; signed: boolean };

/** Lee una tarjeta, una clave de 64 hex, o un texto/enlace que contenga cualquiera de las dos. */
export function parseContact(input: string): Parsed | null {
  const t = input.trim();
  if (!t) return null;
  const at = t.indexOf(CARD_PREFIX);
  if (at >= 0) {
    const token = t.slice(at + CARD_PREFIX.length).match(/^[A-Za-z0-9_-]+/)?.[0] ?? '';
    try {
      const signed = JSON.parse(unb64(token)) as SignedDoc<Card>;
      const d = signed?.doc;
      if (d?.v !== 1 || typeof d.pubkey !== 'string' || typeof d.name !== 'string') return null;
      const pubkey = d.pubkey.toLowerCase();
      if (!isPubkey(pubkey) || !verifyDoc(DOMAIN, signed, pubkey)) return null;
      return { pubkey, name: cleanName(d.name), how: t.startsWith(CARD_PREFIX) ? 'card' : 'link', signed: true };
    } catch {
      return null;
    }
  }
  const hex = t.toLowerCase().match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/)?.[0];
  return hex ? { pubkey: hex, how: 'key', signed: false } : null;
}

export const loadContacts = (kv: KV): Contact[] => Object.values(kv.get<Book>(KEY, {})).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es'));

const nameOf = (c: Contact): string => c.alias || c.name || c.pubkey;

export const getContact = (kv: KV, pubkey: string): Contact | undefined => kv.get<Book>(KEY, {})[pubkey.toLowerCase()];

export type AddResult = { ok: true; contact: Contact; created: boolean } | { ok: false; reason: string };

/** Añade o actualiza. `self` impide añadirte a ti mismo. Un alias propio no se pisa con el nombre de la tarjeta. */
export function addContact(kv: KV, self: string, p: Parsed | { pubkey: string; name?: string; how: Contact['how']; signed?: boolean }, now: number): AddResult {
  const pubkey = p.pubkey.toLowerCase();
  if (!isPubkey(pubkey)) return { ok: false, reason: 'La clave pública son 64 caracteres (0-9, a-f).' };
  if (pubkey === self.toLowerCase()) return { ok: false, reason: 'Esa eres tú.' };
  const book = kv.get<Book>(KEY, {});
  const prev = book[pubkey];
  if (!prev && Object.keys(book).length >= MAX_CONTACTS) return { ok: false, reason: 'Libreta llena.' };
  const name = cleanName(p.name ?? '') || prev?.name || '';
  const contact: Contact = { pubkey, name, addedAt: prev?.addedAt ?? now, how: prev?.how ?? p.how, signed: Boolean(prev?.signed || p.signed) };
  if (prev?.alias) contact.alias = prev.alias;
  book[pubkey] = contact;
  kv.set(KEY, book);
  return { ok: true, contact, created: !prev };
}

export function renameContact(kv: KV, pubkey: string, alias: string): boolean {
  const book = kv.get<Book>(KEY, {});
  const c = book[pubkey.toLowerCase()];
  if (!c) return false;
  const a = cleanName(alias);
  if (a) c.alias = a;
  else delete c.alias;
  kv.set(KEY, book);
  return true;
}

export function removeContact(kv: KV, pubkey: string): boolean {
  const book = kv.get<Book>(KEY, {});
  if (!book[pubkey.toLowerCase()]) return false;
  delete book[pubkey.toLowerCase()];
  kv.set(KEY, book);
  return true;
}

/** Nombre para mostrar: alias tuyo > nombre de la tarjeta > clave abreviada. */
export function displayName(kv: KV, pubkey: string): string {
  const c = getContact(kv, pubkey);
  return (c && nameOf(c)) || `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

export const contactLabel = (c: Contact): string => nameOf(c);
