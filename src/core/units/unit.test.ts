import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import { append, canUse, mint, pubkeyOf, relate, verifyUnit, type UnitLink } from './unit';

const key = (n: number) => new Uint8Array(32).fill(n);
const A = key(1);
const B = key(2);
const C = key(3);
const pa = pubkeyOf(A);
const pb = pubkeyOf(B);
const T = 1_000_000;
const H = 3_600_000;

const ok = (c: UnitLink[], now?: number) => {
  const v = verifyUnit(c, { now });
  if (!v.ok) throw new Error(v.reason);
  return v.state;
};
const fails = (f: () => unknown) => expect(f).toThrow();

describe('unidad firmada', () => {
  it('se crea con el mint del creador y es suya', () => {
    const u = mint('obj:abc', A, T, 'n1');
    const s = ok(u);
    expect(s.owner).toBe(pa);
    expect(s.holder).toBe(pa);
    expect(s.status).toBe('free');
    expect(s.unit).toBe(u[0]!.hash);
  });
  it('dos mints del mismo objeto son unidades distintas', () => {
    expect(mint('obj:abc', A, T, 'n1')[0]!.hash).not.toBe(mint('obj:abc', A, T, 'n2')[0]!.hash);
  });
  it('regalo: oferta → aceptación → cambia de dueño', () => {
    let c = mint('obj:abc', A, T, 'n');
    c = append(c, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 1);
    expect(ok(c).status).toBe('offered');
    expect(canUse(ok(c), pa, T + 2)).toBe(false);
    c = append(c, { t: 'accept' }, B, T + 2);
    const s = ok(c);
    expect(s.owner).toBe(pb);
    expect(s.holder).toBe(pb);
    expect(s.status).toBe('free');
  });
  it('nadie firma lo que no puede', () => {
    const base = mint('obj:abc', A, T, 'n');
    fails(() => append(base, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, B, T + 1)); // no es el dueño
    fails(() => append(base, { t: 'offer', to: pa, terms: { k: 'gift' }, until: T + H }, A, T + 1)); // a sí mismo
    const offered = append(base, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 1);
    fails(() => append(offered, { t: 'accept' }, C, T + 2)); // no es el destinatario
    fails(() => append(offered, { t: 'accept' }, B, T + H + 1)); // caducada
    fails(() => append(offered, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 3)); // comprometida
    fails(() => append(offered, { t: 'cancel' }, A, T + 5)); // sigue vigente
  });
  it('la oferta caducada se cancela y la unidad vuelve a estar libre', () => {
    let c = mint('obj:abc', A, T, 'n');
    c = append(c, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 1);
    c = append(c, { t: 'cancel' }, A, T + H + 1);
    expect(ok(c).status).toBe('free');
  });
  it('préstamo: el prestatario lo usa hasta el vencimiento; se devuelve o se reclama', () => {
    let c = mint('obj:abc', A, T, 'n');
    c = append(c, { t: 'offer', to: pb, terms: { k: 'loan', returnBy: T + 10 * H }, until: T + H }, A, T + 1);
    c = append(c, { t: 'accept' }, B, T + 2);
    const s = ok(c);
    expect(s.owner).toBe(pa);
    expect(s.holder).toBe(pb);
    expect(canUse(s, pb, T + 5 * H)).toBe(true);
    expect(canUse(s, pb, T + 10 * H)).toBe(false); // vencido: sus derechos dejan de valer
    expect(canUse(s, pa, T + 5 * H)).toBe(false); // el dueño no lo tiene mientras dura
    fails(() => append(c, { t: 'offer', to: pa, terms: { k: 'gift' }, until: T + H }, B, T + 3)); // no se presta de nuevo
    fails(() => append(c, { t: 'reclaim' }, A, T + 5 * H)); // aún no vence
    expect(ok(append(c, { t: 'reclaim' }, A, T + 10 * H)).holder).toBe(pa);
    expect(ok(append(c, { t: 'return' }, B, T + 3 * H)).status).toBe('free');
    fails(() => append(c, { t: 'return' }, A, T + 3 * H)); // solo lo devuelve quien lo tiene
  });
  it('detecta manipulación: firma, contenido, orden y futuro', () => {
    let c = mint('obj:abc', A, T, 'n');
    c = append(c, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 1);
    const tampered = JSON.parse(JSON.stringify(c)) as UnitLink[];
    (tampered[1]!.body as { to: string }).to = pa.replace(/^./, 'f');
    expect(verifyUnit(tampered).ok).toBe(false);
    const badSig = JSON.parse(JSON.stringify(c)) as UnitLink[];
    badSig[1]!.sig = '0'.repeat(128);
    expect(verifyUnit(badSig).ok).toBe(false);
    expect(verifyUnit([c[1]!]).ok).toBe(false);
    const fut = mint('obj:abc', A, T + 10 * H, 'n3');
    expect(verifyUnit(fut, { now: T }).ok).toBe(false);
    expect(verifyUnit(fut, { now: T + 10 * H }).ok).toBe(true);
    expect(ed).toBeTruthy();
  });
  it('doble gasto: dos continuaciones distintas de la misma cabeza son una bifurcación', () => {
    let c = mint('obj:abc', A, T, 'n');
    c = append(c, { t: 'offer', to: pb, terms: { k: 'gift' }, until: T + H }, A, T + 1);
    const toB = append(c, { t: 'accept' }, B, T + 2);
    const other = append(mint('obj:abc', A, T, 'n').length ? c.slice(0, 1) : c, { t: 'offer', to: pubkeyOf(C), terms: { k: 'gift' }, until: T + H }, A, T + 1);
    expect(relate(toB, other)).toBe('fork');
    expect(relate(c, toB)).toBe('extends');
    expect(relate(toB, c)).toBe('behind');
    expect(relate(c, c)).toBe('same');
  });
});
