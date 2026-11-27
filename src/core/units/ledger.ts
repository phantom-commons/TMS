import type { KV } from '../kv';
import type { Counts } from '../inventory';
import type { AnyObject } from '../objects';
import { receiptsOf, type SignedReceipt, type WitnessSig } from './receipt';
import { append, canUse, mint, pubkeyOf, relate, verifyUnit, unitIdOf, type Terms, type UnitLink, type UnitState } from './unit';

// Libro local de unidades: las cadenas que conoces (las tuyas y las que te han llegado) y los recibos derivados.
// La verdad está en las cadenas firmadas; esto es una caché verificable y reconstruible (ver docs/UNITS.md).

const CHAINS = 'units.v1';
const RECEIPTS = 'receipts.v1';
const FORKS = 'units.forks.v1';

type Chains = Record<string, UnitLink[]>;

export const loadChains = (kv: KV): Chains => {
  const raw = kv.get<unknown>(CHAINS, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Chains) : {};
};
const saveChains = (kv: KV, c: Chains): void => kv.set(CHAINS, c);
export const hasLedger = (kv: KV): boolean => kv.get<unknown>(CHAINS, null) !== null;

export const loadReceipts = (kv: KV): SignedReceipt[] => Object.values(kv.get<Record<string, SignedReceipt>>(RECEIPTS, {}));

function storeReceipts(kv: KV, chain: readonly UnitLink[], extra: WitnessSig[] = []): void {
  const all = kv.get<Record<string, SignedReceipt>>(RECEIPTS, {});
  for (const r of receiptsOf(chain)) {
    const prev = all[r.id];
    const witnesses = [...(prev?.witnesses ?? [])];
    for (const w of extra) if (!witnesses.some((x) => x.by === w.by)) witnesses.push(w);
    all[r.id] = { ...r, witnesses };
  }
  kv.set(RECEIPTS, all);
}

/** Bifurcaciones vistas (doble gasto): se guardan como prueba; la cadena que se vio primero es la que vale. */
export const loadForks = (kv: KV): UnitLink[][] => kv.get<UnitLink[][]>(FORKS, []);

export type Integrated = { ok: true; result: 'new' | 'same' | 'extended' | 'older' } | { ok: false; reason: string; fork?: boolean };

/** Incorpora una cadena recibida: la verifica entera y solo la acepta si continúa lo que ya se sabía. */
export function integrate(kv: KV, chain: readonly UnitLink[], now: number): Integrated {
  const v = verifyUnit(chain, { now });
  if (!v.ok) return { ok: false, reason: v.reason };
  const chains = loadChains(kv);
  const id = unitIdOf(chain);
  const have = chains[id];
  if (!have) {
    chains[id] = [...chain];
    saveChains(kv, chains);
    storeReceipts(kv, chain);
    return { ok: true, result: 'new' };
  }
  const rel = relate(have, chain);
  if (rel === 'fork') {
    kv.set(FORKS, [...loadForks(kv), [...chain]]);
    return { ok: false, reason: 'bifurcación: otra historia de la misma unidad (primero visto gana)', fork: true };
  }
  if (rel === 'same') return { ok: true, result: 'same' };
  if (rel === 'behind') return { ok: true, result: 'older' };
  chains[id] = [...chain];
  saveChains(kv, chains);
  storeReceipts(kv, chain);
  return { ok: true, result: 'extended' };
}

/** Añade firmas de testigos a un recibo conocido. */
export function addWitness(kv: KV, receiptId: string, w: WitnessSig): void {
  const all = kv.get<Record<string, SignedReceipt>>(RECEIPTS, {});
  const r = all[receiptId];
  if (!r || r.witnesses.some((x) => x.by === w.by)) return;
  all[receiptId] = { ...r, witnesses: [...r.witnesses, w] };
  kv.set(RECEIPTS, all);
}

const nonce = (): string => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export function mintUnits(kv: KV, privateKey: Uint8Array, kind: string, n: number, now: number): void {
  const chains = loadChains(kv);
  for (let i = 0; i < n; i++) {
    const c = mint(kind, privateKey, now, nonce());
    chains[unitIdOf(c)] = c;
  }
  saveChains(kv, chains);
}

/** Primera vez: convierte lo que ya tenías (contadores) en unidades firmadas por ti. Después no vuelve a tocarse. */
export function ensureLedger(kv: KV, privateKey: Uint8Array, initial: Counts, now: number): void {
  if (hasLedger(kv)) return;
  saveChains(kv, {});
  for (const [kind, n] of Object.entries(initial)) if (n > 0) mintUnits(kv, privateKey, kind, n, now);
}

export function unitStates(kv: KV, now: number): UnitState[] {
  const out: UnitState[] = [];
  for (const chain of Object.values(loadChains(kv))) {
    const v = verifyUnit(chain, { now });
    if (v.ok) out.push(v.state);
  }
  return out;
}

/** Unidades que puedes usar ahora (colocar en una room): las tienes y no están comprometidas ni vencidas. */
export function usableCounts(kv: KV, me: string, now: number): Counts {
  const c: Counts = {};
  for (const s of unitStates(kv, now)) if (canUse(s, me, now)) c[s.kind] = (c[s.kind] ?? 0) + 1;
  return c;
}

export const heldBy = (kv: KV, me: string, now: number): UnitState[] => unitStates(kv, now).filter((s) => s.holder === me);
export const lentOut = (kv: KV, me: string, now: number): UnitState[] => unitStates(kv, now).filter((s) => s.owner === me && s.holder !== me);
export const offeredBy = (kv: KV, me: string, now: number): UnitState[] => unitStates(kv, now).filter((s) => s.owner === me && s.status === 'offered');

/** Una unidad tuya, libre, de ese objeto. */
export const pickFreeUnit = (kv: KV, me: string, kind: string, now: number): UnitState | undefined =>
  unitStates(kv, now).find((s) => s.kind === kind && s.owner === me && s.holder === me && s.status === 'free');

// ───────────── acciones ─────────────

export function offerUnit(kv: KV, privateKey: Uint8Array, unitId: string, to: string, terms: Terms, validForMs: number, now: number): UnitLink[] {
  const chain = loadChains(kv)[unitId];
  if (!chain) throw new Error('unidad desconocida');
  const next = append(chain, { t: 'offer', to, terms, until: now + validForMs }, privateKey, now);
  const r = integrate(kv, next, now);
  if (!r.ok) throw new Error(r.reason);
  return next;
}

/** El receptor acepta una oferta que ya ha integrado en su libro. */
export function acceptOffer(kv: KV, privateKey: Uint8Array, unitId: string, now: number): UnitLink[] {
  const chain = loadChains(kv)[unitId];
  if (!chain) throw new Error('unidad desconocida');
  const next = append(chain, { t: 'accept' }, privateKey, now);
  const r = integrate(kv, next, now);
  if (!r.ok) throw new Error(r.reason);
  return next;
}

/**
 * Cumple los contratos que vencen solos: cancela tus ofertas caducadas, recupera tus préstamos vencidos y devuelve los
 * que tienes prestados. Devuelve las cadenas que cambiaron (para poder mandarlas a la otra parte).
 */
export function housekeeping(kv: KV, privateKey: Uint8Array, now: number): UnitLink[][] {
  const me = pubkeyOf(privateKey);
  const changed: UnitLink[][] = [];
  for (const s of unitStates(kv, now)) {
    const chain = loadChains(kv)[s.unit];
    if (!chain) continue;
    let body: Parameters<typeof append>[1] | undefined;
    if (s.status === 'offered' && s.owner === me && s.offer && now > s.offer.until) body = { t: 'cancel' };
    else if (s.status === 'loaned' && s.loan && now >= s.loan.returnBy) body = s.owner === me ? { t: 'reclaim' } : s.holder === me ? { t: 'return' } : undefined;
    if (!body) continue;
    try {
      const next = append(chain, body, privateKey, now);
      if (integrate(kv, next, now).ok) changed.push(next);
    } catch {
      /* no se puede (p. ej. fechas): se reintenta luego */
    }
  }
  return changed;
}

// ───────────── paquetes (cadena completa, para pasar a mano o por red) ─────────────

const PREFIX = 'tms1.';
const b64 = (s: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string): string => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(Uint8Array.from(atob(p + '='.repeat((4 - (p.length % 4)) % 4)), (ch) => ch.charCodeAt(0)));
};

/** El paquete lleva la cadena y la definición del objeto: el dato viaja con la unidad (se comprueba por id de contenido). */
export const encodePacket = (chain: readonly UnitLink[], obj?: AnyObject): string => PREFIX + b64(JSON.stringify({ v: 1, chain, obj }));

export type Packet = { chain: UnitLink[]; obj?: AnyObject };

export function decodePacket(text: string): Packet | null {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) return null;
  try {
    const o = JSON.parse(unb64(t.slice(PREFIX.length))) as { v?: number; chain?: unknown; obj?: unknown };
    if (o.v !== 1 || !Array.isArray(o.chain)) return null;
    return { chain: o.chain as UnitLink[], obj: o.obj && typeof o.obj === 'object' ? (o.obj as AnyObject) : undefined };
  } catch {
    return null;
  }
}
