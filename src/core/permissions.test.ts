import { describe, expect, it } from 'vitest';
import { can, canRole, roleOf, type Access } from './permissions';
import { roomById } from './room-config';

const OWNER = 'a'.repeat(64);
const EDITOR = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);
const access = (over: Partial<Access> = {}): Access => ({ owner: OWNER, editors: [EDITOR], visitors: 'view', ...over });
const room = roomById('my-room')!.policy;
const snake = roomById('snake')!.policy;

describe('roles', () => {
  it('distingue dueño, editor y visitante (sin importar mayúsculas)', () => {
    expect(roleOf(access(), OWNER.toUpperCase())).toBe('owner');
    expect(roleOf(access(), EDITOR)).toBe('editor');
    expect(roleOf(access(), STRANGER)).toBe('visitor');
  });
});

describe('Tu Room (política: cámara libre, editable)', () => {
  it('el dueño puede todo', () => {
    for (const cap of ['view', 'move', 'manage', 'lock', 'share', 'camera'] as const) expect(can(access(), OWNER, cap, room)).toBe(true);
  });
  it('el editor mueve objetos pero no gestiona, bloquea ni comparte', () => {
    expect(can(access(), EDITOR, 'move', room)).toBe(true);
    for (const cap of ['manage', 'lock', 'share'] as const) expect(can(access(), EDITOR, cap, room)).toBe(false);
  });
  it('el visitante solo mira, y solo si el dueño lo permite', () => {
    expect(can(access(), STRANGER, 'view', room)).toBe(true);
    expect(can(access(), STRANGER, 'move', room)).toBe(false);
    expect(can(access({ visitors: 'none' }), STRANGER, 'view', room)).toBe(false);
    expect(can(access({ visitors: 'none' }), EDITOR, 'view', room)).toBe(true);
  });
  it('si el dueño fija la cámara, nadie la mueve (ni él)', () => {
    expect(can(access(), OWNER, 'camera', room, true)).toBe(false);
    expect(can(access(), OWNER, 'camera', room, false)).toBe(true);
  });
});

describe('Snake (política: cámara bloqueada, sin edición)', () => {
  it('nadie mueve la cámara ni edita, ni siquiera el dueño', () => {
    expect(canRole('owner', 'camera', { policy: snake })).toBe(false);
    for (const cap of ['move', 'manage', 'lock', 'share'] as const) expect(canRole('owner', cap, { policy: snake })).toBe(false);
  });
  it('pero se puede ver y jugar', () => {
    expect(canRole('owner', 'play', { policy: snake })).toBe(true);
    expect(canRole('owner', 'view', { policy: snake })).toBe(true);
  });
});
