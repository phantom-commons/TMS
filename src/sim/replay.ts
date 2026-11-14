import type { LogEntry } from './log';
import { createGenesisRoom, canStep, key, type World } from './world';

// Celda de suelo libre más cercana a (x, y). Orden de búsqueda fijo → determinista.
function findFree(world: World, x: number, y: number): { x: number; y: number } | null {
  const taken = new Set(Object.values(world.players).map((p) => key(p.x, p.y)));
  const maxR = Math.max(world.size.w, world.size.h);
  for (let r = 0; r < maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (world.cells[key(nx, ny)]?.kind === 'floor' && !taken.has(key(nx, ny))) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}

export function applyEntry(world: World, entry: LogEntry): void {
  if (entry.type === 'ENTER') {
    const p = entry.payload as { x: number; y: number };
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return;
    delete world.players[entry.author]; // re-entrar no te bloquea a ti mismo
    const spot = findFree(world, p.x, p.y);
    if (!spot) return; // sala llena (el relay devolverá ROOM_FULL más adelante)
    world.players[entry.author] = { ...spot, hlc: entry.hlc };
    return;
  }

  if (entry.type === 'MOVE') {
    const p = entry.payload as { x: number; y: number };
    const cur = world.players[entry.author];
    if (!cur) return; // quien no ha entrado no se mueve
    if (!canStep(world, cur.x, cur.y, p.x - cur.x, p.y - cur.y)) return;
    world.players[entry.author] = { x: p.x, y: p.y, hlc: entry.hlc };
  }
}

export function replay(entries: LogEntry[]): World {
  let world: World | null = null;

  for (const e of entries) {
    if (e.type === 'INIT') {
      if (world) continue; // solo el primer INIT crea la room
      const { spawn } = e.payload as { spawn: { x: number; y: number } };
      world = createGenesisRoom(e.roomId, spawn);
      world.players[e.author] = { x: spawn.x, y: spawn.y, hlc: e.hlc };
      continue;
    }
    if (!world) throw new Error(`entry before INIT at seq ${e.seq}`);
    applyEntry(world, e);
  }

  if (!world) throw new Error('log has no INIT entry');
  return world;
}