import type { LogEntry } from './log';
import type { World } from './world';

function resolvePointers(world: World, entries: readonly LogEntry[], indexes: number[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const index of indexes) {
    const pointer = world.eventRefs[index];
    if (!pointer) continue;
    const entryIndex = world.eventIndex[pointer.eventId];
    const entry = entryIndex === undefined ? undefined : entries[entryIndex];
    if (entry) out.push(entry);
  }
  return out;
}

export function getEntityHistory(world: World, entries: readonly LogEntry[], entityId: string): LogEntry[] {
  return resolvePointers(world, entries, world.entityHistory[entityId] ?? []);
}

export function getCellHistory(world: World, entries: readonly LogEntry[], x: number, y: number): LogEntry[] {
  return resolvePointers(world, entries, world.cellHistory[`${x},${y}`] ?? []);
}

export function getAuthorHistory(world: World, entries: readonly LogEntry[], author: string): LogEntry[] {
  return resolvePointers(world, entries, world.authorHistory[author] ?? []);
}

export function getEntityStats(world: World, entityId: string) {
  return world.entityStats[entityId] ?? {
    eventCount: 0,
    clickCount: 0,
    movementCount: 0,
    pickupCount: 0,
    dropCount: 0,
    clicksSinceLastMove: 0,
    lastMovedAt: null,
    uniqueActors: [],
    effects: [],
  };
}

export function getCellStats(world: World, x: number, y: number) {
  return world.cellActivity[`${x},${y}`] ?? {
    playerVisits: 0,
    objectPlacements: 0,
    objectMoves: 0,
    interactions: 0,
    visitsByAuthor: {},
    uniqueVisitors: 0,
    lastActivityAt: 0,
  };
}
