import type { LogEntry } from './log';
import { createGenesisRoom, type World } from './world';

export function applyEntry(world: World, entry: LogEntry): void {
  if (entry.type === 'MOVE') {
    const p = entry.payload as { x: number; y: number };
    world.players.local = { x: p.x, y: p.y, hlc: entry.hlc };
  }
}

export function replay(entries: LogEntry[]): World {
  let world: World | null = null;

  for (const e of entries) {
    if (e.type === 'INIT') {
      const { roomId, spawn } = e.payload as {
        roomId: string;
        spawn: { x: number; y: number };
      };
      world = createGenesisRoom(roomId);
      world.players.local = { x: spawn.x, y: spawn.y, hlc: e.hlc };
      continue;
    }
    if (!world) throw new Error(`entry before INIT at seq ${e.seq}`);
    applyEntry(world, e);
  }

  if (!world) throw new Error('log has no INIT entry');
  return world;
}