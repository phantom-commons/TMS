import { describe, expect, it } from 'vitest';
import type { KV } from '../kv';
import { acceptOffer, decodePacket, encodePacket, ensureLedger, heldBy, housekeeping, integrate, loadForks, loadReceipts, mintUnits, offerUnit, pickFreeUnit, unitStates, usableCounts } from './ledger';
import { append, pubkeyOf } from './unit';

const memKV = (): KV => {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string, d: T) => (m.has(k) ? (JSON.parse(JSON.stringify(m.get(k))) as T) : d), set: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))), remove: (k: string) => void m.delete(k) } as unknown as KV;
};
const key = (n: number) => new Uint8Array(32).fill(n);
const [A, B] = [key(1), key(2)] as [Uint8Array, Uint8Array];
const [pa, pb] = [pubkeyOf(A), pubkeyOf(B)];
const T = 1_000_000;
const H = 3_600_000;

describe('libro de unidades', () => {
  it('migra contadores a unidades una sola vez', () => {
    const kv = memKV();
    ensureLedger(kv, A, { lamp: 2, bed: 1 }, T);
    ensureLedger(kv, A, { lamp: 9 }, T);
    expect(usableCounts(kv, pa, T)).toEqual({ lamp: 2, bed: 1 });
  });
  it('regalo entre dos libros distintos con paquetes: A ofrece, B acepta, A integra la respuesta', () => {
    const kvA = memKV();
    const kvB = memKV();
    mintUnits(kvA, A, 'lamp', 1, T);
    const unit = pickFreeUnit(kvA, pa, 'lamp', T)!;
    const offer = offerUnit(kvA, A, unit.unit, pb, { k: 'gift' }, H, T + 1);
    expect(usableCounts(kvA, pa, T + 2)).toEqual({}); // comprometida: no se puede usar ni ofrecer otra vez
    // B recibe el paquete por fuera (copiar/pegar, red…) y lo integra
    const received = decodePacket(encodePacket(offer))!.chain;
    expect(integrate(kvB, received, T + 2)).toEqual({ ok: true, result: 'new' });
    const accepted = acceptOffer(kvB, B, unit.unit, T + 3);
    expect(usableCounts(kvB, pb, T + 3)).toEqual({ lamp: 1 });
    // A recibe la respuesta
    expect(integrate(kvA, decodePacket(encodePacket(accepted))!.chain, T + 4)).toEqual({ ok: true, result: 'extended' });
    expect(usableCounts(kvA, pa, T + 5)).toEqual({});
    expect(heldBy(kvA, pa, T + 5)).toHaveLength(0);
    // los dos tienen el mismo recibo
    expect(loadReceipts(kvA).map((r) => r.id)).toEqual(loadReceipts(kvB).map((r) => r.id));
    expect(loadReceipts(kvA)[0]).toMatchObject({ type: 'gift', from: pa, to: pb });
  });
  it('doble gasto: la segunda historia de la misma unidad se rechaza y queda guardada como prueba', () => {
    const kvA = memKV();
    const kvC = memKV();
    mintUnits(kvA, A, 'lamp', 1, T);
    const u = pickFreeUnit(kvA, pa, 'lamp', T)!;
    const chain = kvA.get<Record<string, never>>('units.v1', {})[u.unit] as never;
    integrate(kvC, chain, T);
    const toB = append(chain, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 1);
    const toC = append(chain, { t: 'offer', to: pubkeyOf(key(3)), terms: { k: 'gift' }, until: T + H }, A, T + 1);
    expect(integrate(kvC, toB, T + 2).ok).toBe(true);
    const r = integrate(kvC, toC, T + 2);
    expect(r).toMatchObject({ ok: false, fork: true });
    expect(loadForks(kvC)).toHaveLength(1);
  });
  it('rechaza cadenas manipuladas', () => {
    const kv = memKV();
    mintUnits(kv, A, 'lamp', 1, T);
    const u = unitStates(kv, T)[0]!;
    const chain = JSON.parse(JSON.stringify(kv.get('units.v1', {}))) as Record<string, Array<{ at: number }>>;
    chain[u.unit]![0]!.at += 1;
    expect(integrate(memKV(), chain[u.unit] as never, T).ok).toBe(false);
  });
  it('los contratos vencen solos: oferta caducada y préstamo vencido', () => {
    const kvA = memKV();
    const kvB = memKV();
    mintUnits(kvA, A, 'lamp', 2, T);
    const [u1, u2] = unitStates(kvA, T);
    // oferta que nadie acepta
    offerUnit(kvA, A, u1!.unit, pb, { k: 'gift' }, H, T + 1);
    expect(housekeeping(kvA, A, T + 2)).toHaveLength(0);
    expect(housekeeping(kvA, A, T + H + 5)).toHaveLength(1);
    expect(usableCounts(kvA, pa, T + H + 6).lamp).toBe(2);
    // préstamo que vence
    const offer = offerUnit(kvA, A, u2!.unit, pb, { k: 'loan', returnBy: T + 10 * H }, H, T + 10);
    integrate(kvB, offer, T + 11);
    const acc = acceptOffer(kvB, B, u2!.unit, T + 12);
    integrate(kvA, acc, T + 13);
    expect(usableCounts(kvB, pb, T + 5 * H)).toEqual({ lamp: 1 });
    expect(usableCounts(kvB, pb, T + 10 * H)).toEqual({}); // vencido: deja de valer
    expect(housekeeping(kvB, B, T + 10 * H)).toHaveLength(1); // el prestatario lo devuelve solo
    expect(usableCounts(kvB, pb, T + 10 * H + 1)).toEqual({});
    expect(housekeeping(kvA, A, T + 10 * H + 2)).toHaveLength(1); // o el dueño lo recupera
    expect(usableCounts(kvA, pa, T + 10 * H + 3).lamp).toBe(2);
  });
  it('paquetes malos no se aceptan', () => {
    expect(decodePacket('hola')).toBeNull();
    expect(decodePacket('tms1.@@@')).toBeNull();
  });
});
