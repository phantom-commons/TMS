import type { LogEntry } from './log';
import { emptyEntityStats } from './world';
import type { CausalEffect, EventPointer, World } from './world';

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
  return world.entityStats[entityId] ?? emptyEntityStats();
}

/** Efectos derivados (no firmados) que afectaron a la entidad. */
export function getEntityEffects(world: World, entityId: string): CausalEffect[] {
  return world.entityStats[entityId]?.effects ?? [];
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
  return `${entry.hlc.t} ms${entry.hlc.c ? ` · logical ${entry.hlc.c}` : ''}`;
}