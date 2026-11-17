import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCameraRig, quarterOf } from './camera';

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quarterOf', () => {
  it('redondea al cuarto de vuelta más cercano y envuelve', () => {
    expect(quarterOf(0)).toBe(0);
    expect(quarterOf(0.7)).toBe(0); // < 45°
    expect(quarterOf(0.8)).toBe(1); // > 45°
    expect(quarterOf(Math.PI)).toBe(2);
    expect(quarterOf(-Math.PI / 2)).toBe(3);
    expect(quarterOf(Math.PI * 2.1)).toBe(0);
    expect(quarterOf(-Math.PI * 2.6)).toBe(3);
  });
});

describe('mirar arrastrando', () => {
  it('en 1ª persona gira de forma continua y se ajusta a un cuarto al soltar', () => {
    const rig = createCameraRig(8, 8, 'fps');
    expect(rig.facing).toBe(0);
    rig.look(1.2); // ~69° a la derecha
    expect(rig.facing).toBe(0); // durante el arrastre la cuadrícula sigue igual
    rig.lookEnd();
    expect(rig.facing).toBe(1); // este
    expect(rig.yaw()).toBeCloseTo(-Math.PI / 2);
  });

  it('un giro corto vuelve a la dirección original', () => {
    const rig = createCameraRig(8, 8, 'third');
    rig.look(0.3);
    rig.lookEnd();
    expect(rig.facing).toBe(0);
  });

  it('hacia la izquierda y varias vueltas', () => {
    const rig = createCameraRig(8, 8, 'fps');
    rig.look(-1.5);
    rig.lookEnd();
    expect(rig.facing).toBe(3); // oeste
    rig.look(-Math.PI * 2);
    rig.lookEnd();
    expect(rig.facing).toBe(3);
  });

  it('es coherente con turn(): Q/E y arrastre comparten la misma cuenta', () => {
    const rig = createCameraRig(8, 8, 'fps');
    rig.turn(1);
    expect(rig.facing).toBe(1);
    rig.look(1.2);
    rig.lookEnd();
    expect(rig.facing).toBe(2);
    rig.turn(-1);
    expect(rig.facing).toBe(1);
  });

  it('no hace nada en cámaras que no giran', () => {
    const rig = createCameraRig(8, 8, 'iso');
    rig.look(2);
    rig.lookEnd();
    expect(rig.facing).toBe(0);
    expect(rig.yaw()).toBeCloseTo(Math.PI / 4);
  });
});
