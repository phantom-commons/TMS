import { describe, expect, it } from 'vitest';
import { ROOMS, resolveView, roomBadges, roomById, validateRoomConfig, type RoomConfig } from './room-config';

const my = roomById('my-room')!;
const withView = (c: RoomConfig, view: Partial<RoomConfig['view']>, extra: Partial<RoomConfig> = {}): RoomConfig => ({
  ...c,
  ...extra,
  view: { ...c.view, ...view },
});

describe('validateRoomConfig', () => {
  it('todas las rooms registradas son válidas', () => {
    for (const r of ROOMS) expect(validateRoomConfig(r), r.id).toEqual([]);
  });

  it('detecta vistas incoherentes', () => {
    expect(validateRoomConfig(withView(my, { allowed: [] }))).toContain('view.allowed vacío');
    expect(validateRoomConfig(withView(my, { allowed: ['iso', 'iso'] }))).toContain('view.allowed repetido');
    expect(validateRoomConfig(withView(my, { default: 'fps' }))).toContain('view.default no está entre las vistas permitidas');
  });

  it('la resolución es un entero de 1 a 16', () => {
    for (const bad of [0, 1.5, 17, -2]) expect(validateRoomConfig({ ...my, resolution: bad })).not.toEqual([]);
    expect(validateRoomConfig({ ...my, resolution: 4 })).toEqual([]);
  });

  it('solo/compartido debe coincidir con multijugador', () => {
    expect(validateRoomConfig({ ...my, mode: 'shared' })).not.toEqual([]);
    expect(validateRoomConfig({ ...my, features: { ...my.features, multiplayer: true } })).not.toEqual([]);
  });
});

describe('resolveView', () => {
  it('respeta la preferencia si la room la permite y puedes elegir', () => {
    expect(resolveView(my, 'top', true)).toBe('top');
    expect(resolveView(my, 'iso', true)).toBe('iso');
  });
  it('ignora vistas no permitidas o desconocidas', () => {
    expect(resolveView(my, 'fps', true)).toBe('iso');
    expect(resolveView(my, 'nada', true)).toBe('iso');
    expect(resolveView(my, null, true)).toBe('iso');
  });
  it('sin permiso de cámara manda la vista del autor', () => {
    expect(resolveView(my, 'top', false)).toBe('iso');
  });
  it('con la política de cámara bloqueada manda la vista del autor', () => {
    const locked = { ...my, policy: { ...my.policy, camera: 'locked' as const } };
    expect(resolveView(locked, 'top', true)).toBe('iso');
  });
});

describe('roomBadges', () => {
  it('anuncia varias vistas solo si el jugador puede elegir', () => {
    expect(roomBadges(my)).toContain('2 vistas');
    expect(roomBadges(roomById('snake')!)).toContain('cenital');
    expect(roomBadges(roomById('world')!)).toContain('multijugador');
    expect(roomBadges(my)).toContain('en solitario');
  });
});
