import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { GENESIS_HASH, bytesToHex, hashCanonical, hexToBytes } from '../../sim/hash';

ed.hashes.sha512 = sha512;

// Unidad firmada: UNA espada concreta (no «la espada»). Cada unidad tiene su propia cadena de eslabones; cada eslabón lo
// firma quien tiene derecho a darlo en ese momento (el dueño, el receptor, el prestatario…). La historia viaja con el
// objeto y cualquiera puede verificarla sin preguntar a nadie. Ver docs/UNITS.md.

export const MAX_SKEW_MS = 5 * 60_000; // tolerancia de reloj al rechazar eslabones fechados en el futuro

export type Terms = { k: 'gift' } | { k: 'loan'; returnBy: number };

export type LinkBody =
  | { t: 'mint'; kind: string; creator: string; nonce: string }
  | { t: 'offer'; to: string; terms: Terms; until: number }
  | { t: 'accept' }
  | { t: 'cancel' }
  | { t: 'return' }
  | { t: 'reclaim' };

export type UnitLink = {
  v: 1;
  /** id de la unidad (= hash del eslabón mint); '' en el propio mint */
  unit: string;
  seq: number;
  prev: string;
  body: LinkBody;
  /** fecha que declara quien firma (ms). El tiempo que cuenta para caducidades lo aportan los testigos; ver docs. */
  at: number;
  by: string;
  hash: string;
  sig: string;
};

export type UnitStatus = 'free' | 'offered' | 'loaned';

export type UnitState = {
  unit: string;
  kind: string;
  creator: string;
  /** a quién pertenece */
  owner: string;
  /** quién lo tiene ahora y puede usarlo (en un préstamo, el prestatario) */
  holder: string;
  status: UnitStatus;
  offer?: { to: string; terms: Terms; until: number; hash: string };
  loan?: { returnBy: number };
  head: { seq: number; hash: string };
  length: number;
};

const HEX64 = /^[0-9a-f]{64}$/i;

const bodyHash = (l: Omit<UnitLink, 'hash' | 'sig'>): string =>
  hashCanonical({ domain: 'TMS_UNIT_LINK', v: l.v, unit: l.unit, seq: l.seq, prev: l.prev, body: l.body, at: l.at, by: l.by });

export const pubkeyOf = (privateKey: Uint8Array): string => bytesToHex(ed.getPublicKey(privateKey));

function sign(l: Omit<UnitLink, 'hash' | 'sig'>, privateKey: Uint8Array): UnitLink {
  const hash = bodyHash(l);
  return { ...l, hash, sig: bytesToHex(ed.sign(hexToBytes(hash), privateKey)) };
}

export const unitIdOf = (chain: readonly UnitLink[]): string => chain[0]?.hash ?? '';

/** Crea una unidad nueva: el mint lo firma el creador. */
export function mint(kind: string, privateKey: Uint8Array, at: number, nonce: string): UnitLink[] {
  const creator = pubkeyOf(privateKey);
  return [sign({ v: 1, unit: '', seq: 0, prev: GENESIS_HASH, body: { t: 'mint', kind, creator, nonce }, at, by: creator }, privateKey)];
}

// ───────────── estado y reglas ─────────────

const validTerms = (t: Terms): boolean => (t.k === 'gift' ? true : t.k === 'loan' && Number.isFinite(t.returnBy));

/**
 * Aplica un eslabón a un estado. Devuelve el estado nuevo o un motivo de rechazo.
 * Reglas (quién firma qué):
 *  - offer: el dueño, si la unidad está libre. Bloquea la unidad hasta `until`.
 *  - accept: el destinatario de la oferta, antes de `until`. Regalo: pasa a ser dueño. Préstamo: pasa a ser tenedor.
 *  - cancel: el dueño, solo cuando la oferta ya caducó (mientras vale, la unidad está comprometida).
 *  - return: el tenedor devuelve un préstamo cuando quiera.
 *  - reclaim: el dueño recupera un préstamo vencido (at >= returnBy).
 */
function step(s: UnitState, l: UnitLink): UnitState | string {
  const b = l.body;
  const head = { seq: l.seq, hash: l.hash };
  const length = s.length + 1;
  switch (b.t) {
    case 'mint':
      return 'mint solo puede ser el primer eslabón';
    case 'offer': {
      if (s.status !== 'free') return 'la unidad no está libre';
      if (l.by !== s.owner) return 'solo el dueño ofrece';
      if (!HEX64.test(b.to) || b.to === s.owner) return 'destinatario inválido';
      if (!validTerms(b.terms) || !Number.isFinite(b.until) || b.until <= l.at) return 'condiciones inválidas';
      if (b.terms.k === 'loan' && b.terms.returnBy <= l.at) return 'el préstamo ya vence antes de empezar';
      return { ...s, status: 'offered', offer: { to: b.to, terms: b.terms, until: b.until, hash: l.hash }, head, length };
    }
    case 'accept': {
      if (s.status !== 'offered' || !s.offer) return 'no hay oferta que aceptar';
      if (l.by !== s.offer.to) return 'solo el destinatario acepta';
      if (l.at > s.offer.until) return 'la oferta ya caducó';
      if (s.offer.terms.k === 'gift') return { ...s, owner: l.by, holder: l.by, status: 'free', offer: undefined, loan: undefined, head, length };
      if (s.offer.terms.returnBy <= l.at) return 'el préstamo ya venció';
      return { ...s, holder: l.by, status: 'loaned', loan: { returnBy: s.offer.terms.returnBy }, offer: undefined, head, length };
    }
    case 'cancel': {
      if (s.status !== 'offered' || !s.offer) return 'no hay oferta que cancelar';
      if (l.by !== s.owner) return 'solo el dueño cancela';
      if (l.at <= s.offer.until) return 'la oferta sigue vigente';
      return { ...s, status: 'free', offer: undefined, head, length };
    }
    case 'return': {
      if (s.status !== 'loaned') return 'no hay préstamo';
      if (l.by !== s.holder) return 'solo quien lo tiene lo devuelve';
      return { ...s, holder: s.owner, status: 'free', loan: undefined, head, length };
    }
    case 'reclaim': {
      if (s.status !== 'loaned' || !s.loan) return 'no hay préstamo';
      if (l.by !== s.owner) return 'solo el dueño recupera';
      if (l.at < s.loan.returnBy) return 'el préstamo no ha vencido';
      return { ...s, holder: s.owner, status: 'free', loan: undefined, head, length };
    }
  }
}

export type Verified = { ok: true; state: UnitState } | { ok: false; reason: string; at: number };

/** Verifica una cadena completa: firmas, encadenado y reglas de cada eslabón. `now` rechaza eslabones del futuro. */
export function verifyUnit(chain: readonly UnitLink[], opts: { now?: number } = {}): Verified {
  const first = chain[0];
  if (!first) return { ok: false, reason: 'cadena vacía', at: 0 };
  let state: UnitState | undefined;
  let prev = GENESIS_HASH;
  let lastAt = -Infinity;
  const unit = first.hash;
  for (let i = 0; i < chain.length; i++) {
    const l = chain[i] as UnitLink;
    const bad = (reason: string): Verified => ({ ok: false, reason, at: i });
    if (l.v !== 1 || l.seq !== i || l.prev !== prev) return bad('cadena rota');
    if (!HEX64.test(l.hash) || !HEX64.test(l.by) || !/^[0-9a-f]{128}$/i.test(l.sig)) return bad('formato inválido');
    if (!Number.isFinite(l.at)) return bad('fecha inválida');
    if (bodyHash(l) !== l.hash) return bad('hash incorrecto');
    try {
      if (!ed.verify(hexToBytes(l.sig), hexToBytes(l.hash), hexToBytes(l.by))) return bad('firma incorrecta');
    } catch {
      return bad('firma incorrecta');
    }
    if (l.at < lastAt) return bad('fechas desordenadas');
    if (opts.now !== undefined && l.at > opts.now + MAX_SKEW_MS) return bad('fechado en el futuro');
    lastAt = l.at;
    if (i === 0) {
      const b = l.body;
      if (b.t !== 'mint' || l.unit !== '') return bad('falta el mint');
      if (!HEX64.test(b.creator) || b.creator !== l.by) return bad('el mint lo firma el creador');
      if (typeof b.kind !== 'string' || !b.kind) return bad('mint sin objeto');
      state = { unit, kind: b.kind, creator: b.creator, owner: b.creator, holder: b.creator, status: 'free', head: { seq: 0, hash: l.hash }, length: 1 };
    } else {
      if (l.unit !== unit) return bad('eslabón de otra unidad');
      const r = step(state as UnitState, l);
      if (typeof r === 'string') return bad(r);
      state = r;
    }
    prev = l.hash;
  }
  return { ok: true, state: state as UnitState };
}

/** Añade un eslabón firmado con `privateKey`. Lanza si las reglas no lo permiten (nadie firma lo que no puede). */
export function append(chain: readonly UnitLink[], body: Exclude<LinkBody, { t: 'mint' }>, privateKey: Uint8Array, at: number): UnitLink[] {
  const head = chain[chain.length - 1];
  if (!head) throw new Error('cadena vacía');
  const link = sign({ v: 1, unit: unitIdOf(chain), seq: head.seq + 1, prev: head.hash, body, at, by: pubkeyOf(privateKey) }, privateKey);
  const next = [...chain, link];
  const v = verifyUnit(next);
  if (!v.ok) throw new Error(v.reason);
  return next;
}

// ───────────── consultas ─────────────

/** ¿Puede `who` usar la unidad (colocarla en una room) en este instante? */
export function canUse(s: UnitState, who: string, now: number): boolean {
  if (s.holder !== who) return false;
  if (s.status === 'loaned') return !!s.loan && now < s.loan.returnBy;
  return s.status === 'free';
}

/** Compara dos cadenas de la misma unidad: 'same', 'extends' (b continúa a a), 'behind' (a continúa a b) o 'fork'. */
export function relate(a: readonly UnitLink[], b: readonly UnitLink[]): 'same' | 'extends' | 'behind' | 'fork' {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if ((a[i] as UnitLink).hash !== (b[i] as UnitLink).hash) return 'fork';
  if (a.length === b.length) return 'same';
  return b.length > a.length ? 'extends' : 'behind';
}
