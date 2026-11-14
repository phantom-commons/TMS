import { canWalk, distanceChebyshev, entityAt, type World, type WorldEntity } from './world';

// Planificadores puros: deciden qué entrada firmar a partir del mundo actual.
// Reflejan las reglas de replay.ts; la autoridad final siempre es replay/relay.

export type PushPlan = { entityId: string; x: number; y: number };
export type DropPlan = { entityId: string; x: number; y: number };
export type Planned<T> = T | { error: string };

export const isError = <T extends object>(p: Planned<T>): p is { error: string } => 'error' in p;

/** Convierte un vector de pantalla (-1..1) a dirección de rejilla según el giro de la cámara. */
export function screenToGrid(sx: number, sy: number, yaw: number): { dx: number; dy: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const clamp = (n: number) => Math.max(-1, Math.min(1, Math.round(n))) || 0;
  return { dx: clamp(sx * c + sy * s), dy: clamp(-sx * s + sy * c) };
}

function roomPos(e: WorldEntity, world: World): { x: number; y: number } | null {
  return e.location.kind === 'room' && e.location.roomId === world.roomId
    ? { x: e.location.x, y: e.location.y }
    : null;
}

/** Objetos en la sala a una casilla o menos del jugador, del más cercano al más lejano. */
export function entitiesNear(world: World, author: string): WorldEntity[] {
  const p = world.players[author];
  if (!p) return [];
  return Object.values(world.entities)
    .map((e) => ({ e, pos: roomPos(e, world) }))
    .filter((r): r is { e: WorldEntity; pos: { x: number; y: number } } => r.pos !== null)
    .filter((r) => distanceChebyshev(p, r.pos) <= 1)
    .sort((a, b) => distanceChebyshev(p, a.pos) - distanceChebyshev(p, b.pos) || a.e.id.localeCompare(b.e.id))
    .map((r) => r.e);
}

export function planPushTo(
  world: World,
  author: string,
  entityId: string,
  tx: number,
  ty: number,
): Planned<PushPlan> {
  const p = world.players[author];
  const entity = world.entities[entityId];
  const from = entity ? roomPos(entity, world) : null;
  if (!p || !entity || !from) return { error: 'ese objeto no está en la sala' };
  if (distanceChebyshev(p, from) > 1) return { error: 'acércate al objeto' };
  if (entity.lockedBy) return { error: 'el objeto está bloqueado' };

  const dx = tx - from.x;
  const dy = ty - from.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return { error: 'solo una casilla contigua' };
  if (dx !== 0 && dy !== 0 && (!canWalk(world, from.x + dx, from.y, entityId) || !canWalk(world, from.x, from.y + dy, entityId))) {
    return { error: 'esquina bloqueada' };
  }
  if (!canWalk(world, tx, ty, entityId) || entityAt(world, tx, ty, entityId)) return { error: 'no cabe ahí' };
  if (Object.values(world.players).some((pl) => pl.x === tx && pl.y === ty)) return { error: 'hay alguien ahí' };
  return { entityId, x: tx, y: ty };
}

/** Empujar caminando: si la casilla en esa dirección tiene un objeto, ¿se puede empujar un paso más allá? */
export function planPush(world: World, author: string, dx: number, dy: number): PushPlan | null {
  const p = world.players[author];
  if (!p) return null;
  const entity = entityAt(world, p.x + dx, p.y + dy);
  if (!entity) return null;
  const plan = planPushTo(world, author, entity.id, p.x + 2 * dx, p.y + 2 * dy);
  return isError(plan) ? null : plan;
}

export function planPickUp(world: World, author: string): Planned<{ entityId: string }> {
  if (!world.players[author]) return { error: 'aún no has entrado' };
  const near = entitiesNear(world, author);
  if (near.length === 0) return { error: 'no hay nada cerca' };
  const free = near.find((e) => !e.lockedBy);
  return free ? { entityId: free.id } : { error: 'el objeto está bloqueado' };
}

const NEIGHBORS: Array<[number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1],
];

export function planDrop(
  world: World,
  author: string,
  prefer: { dx: number; dy: number } = { dx: 0, dy: 1 },
): Planned<DropPlan> {
  const p = world.players[author];
  const entityId = world.inventories[author]?.[0];
  if (!p) return { error: 'aún no has entrado' };
  if (!entityId) return { error: 'la mochila está vacía' };

  const order = [[prefer.dx, prefer.dy] as [number, number], ...NEIGHBORS];
  for (const [dx, dy] of order) {
    if (dx === 0 && dy === 0) continue;
    const x = p.x + dx;
    const y = p.y + dy;
    if (!canWalk(world, x, y) || entityAt(world, x, y)) continue;
    if (Object.values(world.players).some((pl) => pl.x === x && pl.y === y)) continue;
    return { entityId, x, y };
  }
  return { error: 'no hay espacio para soltarlo' };
}

export function planLock(world: World, author: string): Planned<{ entityId: string; type: 'LOCK' | 'UNLOCK' }> {
  if (!world.players[author]) return { error: 'aún no has entrado' };
  const near = entitiesNear(world, author);
  if (near.length === 0) return { error: 'no hay nada cerca' };
  const mine = near.find((e) => e.lockedBy === author);
  if (mine) return { entityId: mine.id, type: 'UNLOCK' };
  const lockable = near.find((e) => !e.lockedBy && e.createdBy === author);
  if (lockable) return { entityId: lockable.id, type: 'LOCK' };
  return { error: 'solo quien lo creó puede bloquearlo' };
}
