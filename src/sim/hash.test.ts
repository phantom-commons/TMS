import { describe, it, expect } from 'vitest';
import { canonical, chainHash, bytesToHex, hexToBytes } from './hash';

describe('hash', () => {
  it('canonical no depende del orden de las claves', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('chainHash es determinista y sensible a cada campo', () => {
    const base = ['0'.repeat(64), 'r', { x: 1 }, { t: 1, c: 0 }, 'aa'] as const;
    const h = chainHash(...base);
    expect(chainHash(...base)).toBe(h);
    expect(chainHash(base[0], 'otra', base[2], base[3], base[4])).not.toBe(h);
    expect(chainHash(base[0], base[1], { x: 2 }, base[3], base[4])).not.toBe(h);
    expect(chainHash(base[0], base[1], base[2], { t: 1, c: 1 }, base[4])).not.toBe(h);
    expect(chainHash(base[0], base[1], base[2], base[3], 'bb')).not.toBe(h);
    expect(chainHash('1'.repeat(64), base[1], base[2], base[3], base[4])).not.toBe(h);
  });

  it('hex ida y vuelta', () => {
    const b = new Uint8Array([0, 1, 254, 255]);
    expect(hexToBytes(bytesToHex(b))).toEqual(b);
  });
});