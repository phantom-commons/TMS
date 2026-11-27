import { describe, expect, it } from 'vitest';
import { isWitnessed, receiptsOf, valueStats, validWitnesses, witness, type SignedReceipt } from './receipt';
import { append, mint, pubkeyOf } from './unit';

const key = (n: number) => new Uint8Array(32).fill(n);
const [A, B, C, W1, W2] = [1, 2, 3, 4, 5].map(key) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
const T = 1_000_000;
const H = 3_600_000;

describe('recibos', () => {
  const gift = () => {
    let c = mint('obj:x', A, T, 'n');
    c = append(c, { t: 'offer', to: pubkeyOf(B), terms: { k: 'gift' }, until: T + H }, A, T + 1);
    return append(c, { t: 'accept' }, B, T + 2);
  };
  it('un regalo completo produce un recibo, igual para todos', () => {
    const r1 = receiptsOf(gift());
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject({ type: 'gift', from: pubkeyOf(A), to: pubkeyOf(B), kind: 'obj:x' });
    expect(receiptsOf(gift())[0]!.id).not.toBe(''); // ids deterministas dentro de la misma cadena
    const c = gift();
    expect(receiptsOf(c)[0]!.id).toBe(receiptsOf(c)[0]!.id);
  });
  it('una oferta sin aceptar no genera recibo; un préstamo da inicio y fin', () => {
    let c = mint('obj:x', A, T, 'n');
    c = append(c, { t: 'offer', to: pubkeyOf(B), terms: { k: 'loan', returnBy: T + 5 * H }, until: T + H }, A, T + 1);
    expect(receiptsOf(c)).toHaveLength(0);
    c = append(c, { t: 'accept' }, B, T + 2);
    c = append(c, { t: 'return' }, B, T + 3);
    expect(receiptsOf(c).map((r) => r.type)).toEqual(['loan', 'return']);
    expect(receiptsOf(c)[1]).toMatchObject({ from: pubkeyOf(B), to: pubkeyOf(A) });
  });
  it('una cadena manipulada no da recibos', () => {
    const c = JSON.parse(JSON.stringify(gift()));
    c[2].at += 1;
    expect(receiptsOf(c)).toEqual([]);
  });
  it('los testigos cuentan una vez, y las partes no cuentan', () => {
    const r = receiptsOf(gift())[0]!;
    const s: SignedReceipt = { ...r, witnesses: [witness(r, W1), witness(r, W1), witness(r, A), witness(r, B)] };
    expect(validWitnesses(s)).toHaveLength(1);
    expect(isWitnessed(s)).toBe(false);
    expect(isWitnessed({ ...s, witnesses: [...s.witnesses, witness(r, W2)] })).toBe(true);
    const forged = { ...r, witnesses: [{ by: pubkeyOf(C), sig: '0'.repeat(128) }] };
    expect(validWitnesses(forged)).toHaveLength(0);
  });
  it('las señales de valor son hechos y repetir tratos entre dos cuentas no infla a quién lo ha tenido', () => {
    const rs: SignedReceipt[] = [];
    let c = mint('obj:x', A, T, 'n');
    const creators = { [c[0]!.hash]: pubkeyOf(A) };
    let t = T;
    for (let i = 0; i < 4; i++) {
      const [from, to] = i % 2 === 0 ? [A, B] : [B, A];
      c = append(c, { t: 'offer', to: pubkeyOf(to), terms: { k: 'gift' }, until: t + H }, from, t + 1);
      c = append(c, { t: 'accept' }, to, t + 2);
      t += 10;
    }
    for (const r of receiptsOf(c)) rs.push({ ...r, witnesses: [] });
    const st = valueStats('obj:x', rs, creators);
    expect(st.gifts).toBe(4);
    expect(st.holders).toBe(2);
    expect(st.witnessed).toBe(0);
    expect(st.units).toBe(1);
  });
});
