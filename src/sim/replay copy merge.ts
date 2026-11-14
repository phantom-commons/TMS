import type { LogEntry } from './log';
import {
  createGenesisRoom,
  canStep,
  canWalk,
  distanceChebyshev,
  emptyEntityStats,
  entityAt,
  key,
  playerEntityId,
  type CellActivity,
  type EntityStats,
  type EventPointer,
  type World,
  type WorldEntity,
} from './world';
import { contaminateEntity, contaminatePlayer, tickIfDue } from './behaviors';
import { isMaterialId } from './materials';

function ensureCellActivity(world: World, cellKey: string): CellActivity {
  return (world.cellActivity[cellKey] ??= {
    playerVisits: 0,
    objectPlacements: 0,
    objectMoves: 0,
    interactions: 0,
    visitsByAuthor: {},
    uniqueVisitors: 0,
    lastActivityAt: 0,
  });
}

function ensureEntityStats(world: World, id: string): EntityStats {
  return (world.entityStats[id] ??= emptyEntityStats());
}

function recordEvent(
  world: World,
  entry: LogEntry,
  details: {
    entityId?: string;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
    interaction?: string;
    visit?: boolean;
    placement?: boolean;
    objectMove?: boolean;
    movement?: boolean;
    click?: boolean;
  },
): void {
  const eventId = `${entry.author}:${entry.seq}`;
  if (world.eventIndex[eventId] !== undefined) return;

  const pointer: EventPointer = {
    eventId,
    author: entry.author,
    seq: entry.seq,
    type: entry.type,
    hlc: entry.hlc,
    ...(details.entityId ? { entityId: details.entityId } : {}),
    ...(details.from ? { fromCell: key(details.from.x, details.from.y) } : {}),
    ...(details.to ? { toCell: key(details.to.x, details.to.y) } : {}),
    ...(details.interaction ? { interaction: details.interaction } : {}),
  };
  const index = world.eventRefs.push(pointer) - 1;
  world.eventIndex[eventId] = index;
  (world.authorHistory[entry.author] ??= []).push(index);
  if (details.entityId) (world.entityHistory[details.entityId] ??= []).push(index);

  const cells = new Set<string>();
  if (details.from) cells.add(key(details.from.x, details.from.y));
  if (details.to) cells.add(key(details.to.x, details.to.y));
  for (const cellKey of cells) (world.cellHistory[cellKey] ??= []).push(index);

  const at = entry.hlc.t;
  for (const cellKey of cells) ensureCellActivity(world, cellKey).lastActivityAt = at;
  if (details.visit && details.to) {
    const activity = ensureCellActivity(world, key(details.to.x, details.to.y));
    activity.playerVisits++;
    activity.visitsByAuthor[entry.author] = (activity.visitsByAuthor[entry.author] ?? 0) + 1;
    activity.uniqueVisitors = Object.keys(activity.visitsByAuthor).length;
    activity.lastActivityAt = at;
  }
  if (details.placement && details.to) ensureCellActivity(world, key(details.to.x, details.to.y)).objectPlacements++;
  if (details.objectMove) {
    if (details.from) ensureCellActivity(world, key(details.from.x, details.from.y)).objectMoves++;
    if (details.to) ensureCellActivity(world, key(details.to.x, details.to.y)).objectMoves++;
  }
  if (details.click) {
    const cell = details.to ?? details.from;
    if (cell) ensureCellActivity(world, key(cell.x, cell.y)).interactions++;
  }

  if (details.entityId) {
    const stats = ensureEntityStats(world, details.entityId);
    stats.eventCount++;
    if (!stats.uniqueActors.includes(entry.author)) stats.uniqueActors.push(entry.author);
    if (details.click) {
      stats.clickCount++;
      stats.clicksSinceLastMove++;
    }
    if (details.objectMove || details.movement) {
      stats.movementCount++;
      stats.lastMovedAt = at;
      stats.clicksSinceLastMove = 0;
    }
    if (entry.type === 'PICK_UP') stats.pickupCount++;
    if (entry.type === 'DROP') stats.dropCount++;
  }
}

function asObjectPayload(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
}

function validCell(world: World, point: { x: unknown; y: unknown }): point is { x: number; y: number } {
  const { x, y } = point;
  return (
    typeof x === 'number' && typeof y === 'number' &&
    Number.isInteger(x) && Number.isInteger(y) &&
    x >= 0 && y >= 0 && x < world.size.w && y < world.size.h
  );
}

function getPlayer(world: World, author: string) {
  return world.players[author];
}

function isNearPlayer(world: World, author: string, x: number, y: number): boolean {
  const p = getPlayer(world, author);
  return !!p && distanceChebyshev(p, { x, y }) <= 1;
}

function moveEntityToRoom(entity: WorldEntity, roomId: string, x: number, y: number): void {
  entity.location = { kind: 'room', roomId, x, y };
}

function validateCreaturePayload(payload: unknown): {
  species: string;
  massKg: number;
} | null {
  const c = asObjectPayload(payload);
  if (!c) return null;
  if (typeof c.species !== 'string' || c.species.length === 0 || c.species.length > 32) return null;
  if (typeof c.massKg !== 'number' || !Number.isFinite(c.massKg) || c.massKg <= 0 || c.massKg > 500) return null;
  return { species: c.species, massKg: c.massKg };
}

/** Aplica un evento ya autenticado. Devuelve false si la acción es semánticamente inválida. */
export function applyEntryRaw(world: World, entry: LogEntry): boolean {
  const p = asObjectPayload(entry.payload);
  if (!p) return false;

  if (entry.type === 'ENTER') {
    const x = p.x;
    const y = p.y;
    const requested = { x, y };
    if (!validCell(world, requested)) return false;
    const previous = world.players[entry.author];
    delete world.players[entry.author];
    const spot = findFree(world, requested.x, requested.y);
    if (!spot) {
      if (previous) world.players[entry.author] = previous;
      return false;
    }
    world.players[entry.author] = {
      ...(previous ?? { x: spot.x, y: spot.y, hlc: entry.hlc }),
      x: spot.x,
      y: spot.y,
      hlc: entry.hlc,
    };
    recordEvent(world, entry, { entityId: playerEntityId(entry.author), to: spot, visit: true });
    return true;
  }

  if (entry.type === 'MOVE') {
    const target = { x: p.x, y: p.y };
    const cur = world.players[entry.author];
    if (!cur || !validCell(world, target)) return false;
    const dx = target.x - cur.x;
    const dy = target.y - cur.y;
    if (
      Object.entries(world.players).some(
        ([id, player]) => id !== entry.author && player.x === target.x && player.y === target.y,
      )
    ) return false;
    if (!canStep(world, cur.x, cur.y, dx, dy)) return false;

    const from = { x: cur.x, y: cur.y };
    world.players[entry.author] = { ...cur, x: target.x, y: target.y, hlc: entry.hlc };

    const destCell = world.cells[key(target.x, target.y)];
    if (destCell) contaminatePlayer(world, entry.author, destCell);

    recordEvent(world, entry, {
      entityId: playerEntityId(entry.author),
      from,
      to: target,
      visit: true,
      movement: true,
    });
    return true;
  }

  if (entry.type === 'POUR') {
    const material = p.material;
    const ml = p.ml;
    const target = { x: p.x, y: p.y };
    if (!isMaterialId(material)) return false;
    if (typeof ml !== 'number' || !Number.isFinite(ml) || ml <= 0 || ml > 100_000) return false;
    if (!validCell(world, target)) return false;
    if (!world.players[entry.author]) return false;
    if (!isNearPlayer(world, entry.author, target.x, target.y)) return false;

    const cell = world.cells[key(target.x, target.y)];
    if (!cell) return false;
    if (cell.liquid) {
      if (cell.liquid.material !== material) return false;
      cell.liquid.amount += ml;
    } else {
      cell.liquid = { material, amount: ml };
    }
    ensureEntityStats(world, playerEntityId(entry.author)).effects.push({
      effect: 'poured', material, amount: ml, atBucket: entry.hlc.t,
    });
    recordEvent(world, entry, { entityId: playerEntityId(entry.author), to: target });
    return true;
  }

  if (entry.type === 'PLACE') {
    const id = p.entityId;
    const target = { x: p.x, y: p.y };
    if (!world.players[entry.author]) return false;
    if (
      typeof id !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(id) ||
      id.startsWith('player:') ||
      world.entities[id] ||
      !validCell(world, target)
    ) return false;
    if (!isNearPlayer(world, entry.author, target.x, target.y)) return false;
    if (
      Object.values(world.players).some(
        (player) => player.x === target.x && player.y === target.y,
      )
    ) return false;

    const tile = world.cells[key(target.x, target.y)];
    const legacyObjectTile = tile?.kind === 'object';
    if ((!legacyObjectTile && !canWalk(world, target.x, target.y)) || entityAt(world, target.x, target.y)) {
      return false;
    }

    const isCreature = p.creature !== undefined;
    const creaturePayload = isCreature ? validateCreaturePayload(p.creature) : null;
    if (isCreature && !creaturePayload) return false;

    if (
      p.assetHash !== undefined &&
      (typeof p.assetHash !== 'string' || !/^[0-9a-f]{64}$/i.test(p.assetHash))
    ) return false;
    if (
      p.assetSize !== undefined &&
      (typeof p.assetSize !== 'number' || !Number.isSafeInteger(p.assetSize) || p.assetSize < 0)
    ) return false;

    const entity: WorldEntity = {
      id,
      kind: isCreature ? 'creature' : 'object',
      createdBy: entry.author,
      location: { kind: 'room', roomId: world.roomId, x: target.x, y: target.y },
      blocksMovement: isCreature ? false : p.blocksMovement !== false,
      ...(creaturePayload
        ? {
            creature: {
              species: creaturePayload.species,
              massKg: creaturePayload.massKg,
              needs: { grooms: true, drinks: true, eats: true },
              bloodAlcohol: 0,
              stunUntilBucket: 0,
            },
          }
        : {}),
      ...(typeof p.assetHash === 'string'
        ? {
            asset: {
              hash: p.assetHash,
              sizeBytes:
                typeof p.assetSize === 'number' && Number.isFinite(p.assetSize) && p.assetSize >= 0
                  ? p.assetSize
                  : 0,
              mimeType: typeof p.mimeType === 'string' ? p.mimeType : 'application/octet-stream',
            },
          }
        : {}),
    };
    world.entities[id] = entity;
    if (legacyObjectTile && tile) tile.kind = 'floor';

    const destCell = world.cells[key(target.x, target.y)];
    if (destCell) contaminateEntity(world, entity, destCell);

    recordEvent(world, entry, { entityId: id, to: target, placement: true });
    return true;
  }

  if (entry.type === 'PICK_UP') {
    const id = p.entityId;
    if (typeof id !== 'string') return false;
    const entity = world.entities[id];
    if (!entity || entity.location.kind !== 'room' || entity.location.roomId !== world.roomId) return false;
    const from = { x: entity.location.x, y: entity.location.y };
    if (!isNearPlayer(world, entry.author, from.x, from.y)) return false;
    if (entity.lockedBy) return false;
    entity.location = { kind: 'inventory', owner: entry.author };
    const bag = (world.inventories[entry.author] ??= []);
    if (!bag.includes(id)) bag.push(id);
    recordEvent(world, entry, { entityId: id, from, objectMove: true });
    return true;
  }

  if (entry.type === 'DROP') {
    const id = p.entityId;
    const target = { x: p.x, y: p.y };
    if (typeof id !== 'string' || !validCell(world, target)) return false;
    const entity = world.entities[id];
    if (!entity || entity.location.kind !== 'inventory' || entity.location.owner !== entry.author) return false;
    if (!canWalk(world, target.x, target.y) || entityAt(world, target.x, target.y)) return false;
    if (!isNearPlayer(world, entry.author, target.x, target.y)) return false;
    if (Object.values(world.players).some((player) => player.x === target.x && player.y === target.y)) return false;
    moveEntityToRoom(entity, world.roomId, target.x, target.y);
    world.inventories[entry.author] = (world.inventories[entry.author] ?? []).filter((v) => v !== id);
    const destCell = world.cells[key(target.x, target.y)];
    if (destCell) contaminateEntity(world, entity, destCell);
    recordEvent(world, entry, { entityId: id, to: target, objectMove: true });
    return true;
  }

  if (entry.type === 'PUSH') {
    const id = p.entityId;
    const target = { x: p.x, y: p.y };
    if (typeof id !== 'string' || !validCell(world, target)) return false;
    const entity = world.entities[id];
    if (!entity || entity.location.kind !== 'room' || entity.location.roomId !== world.roomId) return false;
    if (entity.lockedBy) return false;
    const from = { x: entity.location.x, y: entity.location.y };
    if (!isNearPlayer(world, entry.author, from.x, from.y)) return false;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
    if (dx !== 0 && dy !== 0 && (!canWalk(world, from.x + dx, from.y, id) || !canWalk(world, from.x, from.y + dy, id))) {
      return false;
    }
    if (!canWalk(world, target.x, target.y, id) || entityAt(world, target.x, target.y, id)) return false;
    if (Object.values(world.players).some((player) => player.x === target.x && player.y === target.y)) return false;
    moveEntityToRoom(entity, world.roomId, target.x, target.y);
    const destCell = world.cells[key(target.x, target.y)];
    if (destCell) contaminateEntity(world, entity, destCell);
    recordEvent(world, entry, { entityId: id, from, to: target, objectMove: true });
    return true;
  }

  if (entry.type === 'LOCK' || entry.type === 'UNLOCK') {
    const id = p.entityId;
    if (typeof id !== 'string') return false;
    const entity = world.entities[id];
    if (!entity || !world.players[entry.author]) return false;
    if (entity.location.kind !== 'room' || !isNearPlayer(world, entry.author, entity.location.x, entity.location.y)) {
      return false;
    }
    if (entry.type === 'LOCK') {
      if (entity.createdBy !== entry.author || entity.lockedBy) return false;
      entity.lockedBy = entry.author;
    } else {
      if (entity.lockedBy !== entry.author) return false;
      delete entity.lockedBy;
    }
    const location = entity.location.kind === 'room' ? { x: entity.location.x, y: entity.location.y } : undefined;
    recordEvent(world, entry, { entityId: id, to: location });
    return true;
  }

  if (entry.type === 'INTERACT') {
    if (p.kind !== 'click' || !world.players[entry.author]) return false;
    if (typeof p.entityId === 'string') {
      const entity = world.entities[p.entityId];
      if (entity) {
        if (entity.location.kind !== 'room' || entity.location.roomId !== world.roomId) return false;
        const to = { x: entity.location.x, y: entity.location.y };
        if (!isNearPlayer(world, entry.author, to.x, to.y)) return false;
        recordEvent(world, entry, { entityId: p.entityId, to, interaction: 'click', click: true });
        return true;
      }
      const playerId = p.entityId.startsWith('player:') ? p.entityId.slice('player:'.length) : '';
      const player = world.players[playerId];
      if (player && isNearPlayer(world, entry.author, player.x, player.y)) {
        recordEvent(world, entry, { entityId: p.entityId, to: { x: player.x, y: player.y }, interaction: 'click', click: true });
        return true;
      }
      return false;
    }
    const cell = asObjectPayload(p.cell);
    const target = cell ? { x: cell.x, y: cell.y } : null;
    if (target && validCell(world, target) && isNearPlayer(world, entry.author, target.x, target.y)) {
      recordEvent(world, entry, { to: { x: target.x, y: target.y }, interaction: 'click', click: true });
      return true;
    }
    return false;
  }

  // DOOR y NOTE están reservados pero sin semántica definida; se rechazan.
  if (entry.type === 'DOOR' || entry.type === 'NOTE') return false;
  return false;
}

/**
 * Aplica un evento firmado y, si es válido, avanza el tick determinista.
 * Cliente y relay deben usar esta función para que el mundo derivado coincida.
 */
export function applyEntry(world: World, entry: LogEntry): boolean {
  const ok = applyEntryRaw(world, entry);
  if (ok) tickIfDue(world, entry.hlc.t);
  return ok;
}

function findFree(world: World, x: number, y: number): { x: number; y: number } | null {
  const taken = new Set(Object.values(world.players).map((p) => key(p.x, p.y)));
  const maxR = Math.max(world.size.w, world.size.h);
  for (let r = 0; r < maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (
          world.cells[key(nx, ny)]?.kind === 'floor' &&
          !taken.has(key(nx, ny)) &&
          canWalk(world, nx, ny)
        ) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}

export function previewEntry(world: World, entry: LogEntry): World | null {
  const copy = typeof structuredClone === 'function'
    ? (structuredClone(world) as World)
    : (JSON.parse(JSON.stringify(world)) as World);
  return applyEntry(copy, entry) ? copy : null;
}

export function replay(entries: LogEntry[]): World {
  let world: World | null = null;
  for (const entry of entries) {
    if (entry.type === 'INIT') {
      if (world) continue;
      const payload = asObjectPayload(entry.payload);
      if (payload?.owner !== undefined && payload.owner !== entry.author) {
        throw new Error('INIT owner must match its signing author');
      }
      const spawn = asObjectPayload(payload?.spawn) ?? { x: 3, y: 3 };
      if (!validSpawn(spawn.x) || !validSpawn(spawn.y)) throw new Error('INIT has invalid spawn coordinates');
      const sx = spawn.x;
      const sy = spawn.y;
      world = createGenesisRoom(entry.roomId, { x: sx, y: sy }, { legacyCube: entry.version !== 2 });
      if (world.cells[key(sx, sy)]?.kind !== 'floor') throw new Error('INIT spawn must be a walkable floor cell');
      world.players[entry.author] = { x: sx, y: sy, hlc: entry.hlc };
      world.lastHlcTime = Math.max(world.lastHlcTime, entry.hlc.t);
      recordEvent(world, entry, { entityId: playerEntityId(entry.author), to: { x: sx, y: sy }, visit: true });
      continue;
    }
    if (!world) throw new Error(`entry before INIT at seq ${entry.seq}`);
    applyEntry(world, entry);
  }
  if (!world) throw new Error('log has no INIT entry');
  return world;
}

function validSpawn(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export type LogEntryType =
  | 'INIT'
  | 'ENTER'
  | 'MOVE'
  | 'POUR'         // ← NUEVO
  | 'PLACE'
  | 'PICK_UP'
  | 'DROP'
  | 'PUSH'
  | 'LOCK'
  | 'UNLOCK'
  | 'INTERACT'
  | 'DOOR'
  | 'NOTE';