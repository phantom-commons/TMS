import { describe, expect, it } from 'vitest';
import { countKinds, freeUnits, mergeCounts } from './inventory';

describe('contadores de objetos', () => {
  it('las libres descuentan las usadas y nunca son negativas', () => {
    expect(freeUnits({ a: 3 }, { a: 1 }, 'a')).toBe(2);
    expect(freeUnits({ a: 3 }, { a: 5 }, 'a')).toBe(0);
    expect(freeUnits({}, {}, 'zzz')).toBe(0);
  });
  it('cuenta y mezcla', () => {
    expect(mergeCounts(countKinds(['a', 'a', 'b']), { b: 2 })).toEqual({ a: 2, b: 3 });
  });
});
