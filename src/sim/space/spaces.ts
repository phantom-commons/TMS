import { hashCanonical } from '../hash';

// Qué es un «espacio»: una semilla, quién puede entrar y cómo se sincroniza. Tu nave y el mundo son espacios.
// La semilla de tu nave es tu clave pública (la misma que ya usa Tu Room), así que lo guardado en `house.v1` sigue valiendo.
// La semilla de tu estrella se deriva con separación de dominio: nunca se saca de las 24 palabras directamente.

export const PUBLIC_STAR_SEED = 'tms-public-star-1';

export type Access = { who: 'owner' } | { who: 'friends'; allow: readonly string[] } | { who: 'public' };
export type Sync = 'local' | 'p2p' | 'relay';
export type SpaceRef = { kind: 'ship'; owner: string; seed: string; access: Access; sync: Sync } | { kind: 'world'; seed: string; access: Access; sync: Sync };

export const shipSpace = (owner: string): SpaceRef => ({ kind: 'ship', owner, seed: owner, access: { who: 'owner' }, sync: 'local' });
export const publicWorld = (): SpaceRef => ({ kind: 'world', seed: PUBLIC_STAR_SEED, access: { who: 'public' }, sync: 'relay' });
export const privateStarSeed = (owner: string): string => hashCanonical({ domain: 'TMS_STAR_SEED', owner });
export const privateWorld = (owner: string, friends: readonly string[]): SpaceRef => ({ kind: 'world', seed: privateStarSeed(owner), access: { who: 'friends', allow: [owner, ...friends] }, sync: 'p2p' });

export function canEnter(space: SpaceRef, who: string): boolean {
  if (space.access.who === 'public') return true;
  if (space.access.who === 'owner') return space.kind === 'ship' && space.owner === who;
  return space.access.allow.includes(who);
}
