import type { LogEntry } from './log';
import type { EventPointer, World } from './world';

const eventKey = (entry: Pick<LogEntry, 'author' | 'seq'>) => `${entry.author}:${entry.seq}`;

function resolvePointers(world: World, entries: readonly LogEntry[], indexes: number[]): LogEntry[] {
  const byId = new Map(entries.map((entry) => [eventKey(entry), entry]));
  return indexes
    .map((index) => world.eventRefs[index])
    .filter((pointer): pointer is EventPointer => !!pointer)
    .map((pointer) => byId.get(pointer.eventId))
    .filter((entry): entry is LogEntry => !!entry);
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

export function getEventTime(entry: LogEntry): string {
  return new Date(entry.hlc.t).toLocaleString();
}
