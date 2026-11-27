import * as ed from '@noble/ed25519';
import { bytesToHex, hashCanonical, hexToBytes } from '../../sim/hash';
import { pubkeyOf, verifyUnit, type Terms, type UnitLink } from './unit';

// Recibo: el registro de UNA transacción de UNA unidad. No es una moneda ni se intercambia por objetos: sirve para saber
// qué ocurrió y qué objetos circulan, se prestan o se buscan. Se deriva de las cadenas (cualquiera obtiene el mismo recibo
// y el mismo id); los testigos añaden firmas sobre ese id.

export type ReceiptType = 'gift' | 'loan' | 'return' | 'reclaim';

export type Receipt = {
  v: 1;
  /** hash del contenido; igual para todo el que lo derive */
  id: string;
  type: ReceiptType;
  unit: string;
  kind: string;
  from: string;
  to: string;
  terms?: Terms;
  /** hash del eslabón que lo cierra (accept / return / reclaim) */
  link: string;
  at: number;
};

export type WitnessSig = { by: string; sig: string };
export type SignedReceipt = Receipt & { witnesses: WitnessSig[] };

const idOf = (r: Omit<Receipt, 'id'>): string => hashCanonical({ domain: 'TMS_RECEIPT', ...r });

/** Recibos de toda una cadena (verificada). Cadena inválida → ninguno. */
export function receiptsOf(chain: readonly UnitLink[]): Receipt[] {
  const v = verifyUnit(chain);
  if (!v.ok) return [];
  const out: Receipt[] = [];
  const kind = v.state.kind;
  const unit = v.state.unit;
  let offer: { by: string; to: string; terms: Terms } | undefined;
  let lender: string | undefined;
  let borrower: string | undefined;
  for (const l of chain) {
    const b = l.body;
    if (b.t === 'offer') offer = { by: l.by, to: b.to, terms: b.terms };
    else if (b.t === 'cancel') offer = undefined;
    else if (b.t === 'accept' && offer) {
      const base = { v: 1 as const, type: (offer.terms.k === 'gift' ? 'gift' : 'loan') as ReceiptType, unit, kind, from: offer.by, to: l.by, terms: offer.terms, link: l.hash, at: l.at };
      out.push({ ...base, id: idOf(base) });
      if (offer.terms.k === 'loan') {
        lender = offer.by;
        borrower = l.by;
      }
      offer = undefined;
    } else if ((b.t === 'return' || b.t === 'reclaim') && lender && borrower) {
      const base = { v: 1 as const, type: b.t as ReceiptType, unit, kind, from: borrower, to: lender, link: l.hash, at: l.at };
      out.push({ ...base, id: idOf(base) });
      lender = borrower = undefined;
    }
  }
  return out;
}

/** Un testigo (alguien que no es parte) firma que vio la transacción. */
export function witness(r: Receipt, privateKey: Uint8Array): WitnessSig {
  return { by: pubkeyOf(privateKey), sig: bytesToHex(ed.sign(hexToBytes(r.id), privateKey)) };
}

export function validWitnesses(r: SignedReceipt): WitnessSig[] {
  const seen = new Set<string>();
  const out: WitnessSig[] = [];
  for (const w of r.witnesses) {
    if (w.by === r.from || w.by === r.to || seen.has(w.by)) continue; // las partes no cuentan como testigos; uno solo vale una vez
    try {
      if (ed.verify(hexToBytes(w.sig), hexToBytes(r.id), hexToBytes(w.by))) {
        seen.add(w.by);
        out.push(w);
      }
    } catch {
      /* firma mal formada: no cuenta */
    }
  }
  return out;
}

/** Un recibo está «testificado» con al menos `min` testigos distintos y ajenos al trato. */
export const isWitnessed = (r: SignedReceipt, min = 2): boolean => validWitnesses(r).length >= min;

// ───────────── señales de valor (hechos, no precios) ─────────────

export type ValueStats = {
  kind: string;
  /** unidades creadas conocidas */
  units: number;
  /** traspasos definitivos (regalos) */
  gifts: number;
  /** préstamos iniciados */
  loans: number;
  /** personas distintas que lo han tenido, contando al creador */
  holders: number;
  /** de los traspasos y préstamos, cuántos son entre personas distintas del creador de la unidad y con testigos */
  witnessed: number;
  lastAt: number;
};

/**
 * Hechos sobre un objeto a partir de los recibos conocidos. No produce un precio: enseña cuánto circula y cuánta gente
 * lo ha tenido. Los tratos de una persona consigo misma no existen (no se puede ofrecer a uno mismo), y `holders` cuenta
 * identidades, no transacciones, para que repetir un trato entre las mismas dos cuentas no infle nada.
 */
export function valueStats(kind: string, receipts: readonly SignedReceipt[], creators: Readonly<Record<string, string>> = {}): ValueStats {
  const mine = receipts.filter((r) => r.kind === kind);
  const holders = new Set<string>();
  const units = new Set<string>();
  let gifts = 0;
  let loans = 0;
  let witnessed = 0;
  let lastAt = 0;
  for (const r of mine) {
    units.add(r.unit);
    const c = creators[r.unit];
    if (c) holders.add(c);
    if (r.type === 'gift' || r.type === 'loan') {
      holders.add(r.to);
      if (r.type === 'gift') gifts++;
      else loans++;
      if (isWitnessed(r)) witnessed++;
    }
    lastAt = Math.max(lastAt, r.at);
  }
  return { kind, units: units.size, gifts, loans, holders: holders.size, witnessed, lastAt };
}
