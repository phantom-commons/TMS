import { describe, expect, it } from 'vitest';
import { cleanParams, DEFAULT_PARAMS, loadParams, paramsFromSeed, paramsFromText, paramsToText, PARAM_RANGES, saveParams } from './ship-params';

const mem = () => {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string, f: T) => (m.has(k) ? (m.get(k) as T) : f), set: (k: string, v: unknown) => void m.set(k, v) };
};

describe('ship-params', () => {
  it('garbage becomes defaults', () => {
    expect(cleanParams(null)).toEqual(DEFAULT_PARAMS);
    expect(cleanParams('x')).toEqual(DEFAULT_PARAMS);
    expect(cleanParams({ radius: NaN, wingSpan: 'a' })).toEqual(DEFAULT_PARAMS);
  });
  it('clamps to ranges and rounds sides', () => {
    const p = cleanParams({ radius: 99, wingSpan: -5, sides: 7.6, hue: 725 });
    expect(p.radius).toBe(PARAM_RANGES.radius.max);
    expect(p.wingSpan).toBe(PARAM_RANGES.wingSpan.min);
    expect(p.sides).toBe(8);
    expect(p.hue).toBe(5);
  });
  it('is idempotent and round-trips through text', () => {
    const p = cleanParams({ radius: 1.1, finHeight: 2, hue: 40 });
    expect(cleanParams(p)).toEqual(p);
    expect(paramsFromText(paramsToText(p))).toEqual(p);
    expect(paramsFromText('{no')).toBeNull();
  });
  it('seed variants are deterministic and in range', () => {
    const h = (a: number) => (a * 2654435761) >>> 0;
    expect(paramsFromSeed(h)).toEqual(paramsFromSeed(h));
    const p = paramsFromSeed(h);
    expect(cleanParams(p)).toEqual(p);
  });
  it('persists', () => {
    const kv = mem();
    expect(loadParams(kv)).toEqual(DEFAULT_PARAMS);
    saveParams(kv, { ...DEFAULT_PARAMS, cabin: 1.2 });
    expect(loadParams(kv).cabin).toBe(1.2);
  });
});
