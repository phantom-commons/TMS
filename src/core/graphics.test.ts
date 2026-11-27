import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, detectTier, resolveGraphics, type Env } from './graphics';

const phone: Env = { dpr: 3, cores: 8, memoryGb: 0, coarse: true, width: 412 };
const desktop: Env = { dpr: 1, cores: 12, memoryGb: 16, coarse: false, width: 1920 };
const weak: Env = { dpr: 2, cores: 4, memoryGb: 2, coarse: true, width: 360 };

describe('detectTier', () => {
  it('móvil sin datos → media, equipos flojos → baja, escritorio potente → alta', () => {
    expect(detectTier(phone)).toBe('medium');
    expect(detectTier(weak)).toBe('low');
    expect(detectTier(desktop)).toBe('high');
    expect(detectTier({ ...desktop, cores: 4, memoryGb: 0 })).toBe('medium');
  });
});

describe('resolveGraphics', () => {
  it('automática usa la calidad detectada', () => {
    expect(resolveGraphics(DEFAULT_PREFS, weak)).toMatchObject({ tier: 'low', scale: 70, outlines: false });
    expect(resolveGraphics(DEFAULT_PREFS, desktop)).toMatchObject({ tier: 'high', scale: 100, outlines: true });
  });
  it('limita la densidad de píxeles y aplica la escala', () => {
    const r = resolveGraphics({ ...DEFAULT_PREFS, quality: 'medium' }, phone);
    expect(r.pixelRatio).toBeCloseTo(2 * 0.85);
    expect(resolveGraphics({ ...DEFAULT_PREFS, quality: 'low' }, phone).pixelRatio).toBeCloseTo(1.5 * 0.7);
  });
  it('las opciones sueltas mandan sobre la calidad', () => {
    const r = resolveGraphics({ quality: 'low', renderScale: 100, outlines: 'on' }, phone);
    expect(r).toMatchObject({ tier: 'low', scale: 100, outlines: true });
    expect(resolveGraphics({ quality: 'high', renderScale: 0, outlines: 'off' }, desktop).outlines).toBe(false);
  });
  it('nunca baja de medio píxel por pixel', () => {
    expect(resolveGraphics({ quality: 'low', renderScale: 70, outlines: 'off' }, { ...weak, dpr: 0.3 }).pixelRatio).toBe(0.5);
  });
});
