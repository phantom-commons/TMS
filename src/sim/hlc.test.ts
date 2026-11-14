import { describe, it, expect } from 'vitest';
import { HLClock } from './hlc';

describe('HLClock', () => {
  it('es monótono aunque el reloj físico retroceda', () => {
    let now = 100;
    const c = new HLClock(() => now);
    expect(c.tick()).toEqual({ t: 100, c: 0 });
    expect(c.tick()).toEqual({ t: 100, c: 1 });
    now = 50;
    expect(c.tick()).toEqual({ t: 100, c: 2 });
    now = 200;
    expect(c.tick()).toEqual({ t: 200, c: 0 });
  });

  it('observe adopta un reloj remoto adelantado', () => {
    const c = new HLClock(() => 100);
    c.tick();
    expect(c.observe({ t: 500, c: 7 })).toEqual({ t: 500, c: 8 });
  });
});