export type HLC = { t: number; c: number };

export type CellKind = 'floor' | 'wall' | 'object' | 'door';
export type Cell = {
  kind: CellKind;
  owner?: string;
  hlc: HLC;
  targetRoomId?: string;
};

export type AssetRef = {
  /** SHA-256 of the asset bytes, not a URL. */
  hash: string;
  sizeBytes: number;
  mimeType: string;
};

export type EntityLocation =
  | { kind: 'room'; roomId: string; x: number; y: number }
  | { kind: 'inventory'; owner: string }
  | { kind: 'container'; containerId: string };

export type WorldEntity = {
  id: string;
  kind: 'object';
  createdBy: string;
  location: EntityLocation;
  blocksMovement: boolean;
  lockedBy?: string;
  asset?: AssetRef;
};

export type EventPointer = {
  /** `${author}:${seq}` identifies one signed event in an author's chain. */
  eventId: string;
  author: string;
  seq: number;
  type: string;
  hlc: HLC;
  entityId?: string;
  fromCell?: string;
  toCell?: string;
  interaction?: string;
};

export type CellActivity = {
  playerVisits: number;
  objectPlacements: number;
  objectMoves: number;
  interactions: number;
  visitsByAuthor: Record<string, number>;
  uniqueVisitors: number;
  lastActivityAt: number;
};

export type EntityStats = {
  eventCount: number;
  clickCount: number;
  movementCount: number;
  pickupCount: number;
  dropCount: number;
  clicksSinceLastMove: number;
  lastMovedAt: number | null;
  uniqueActors: string[];
};

export type World = {
  roomId: string;
  size: { w: number; h: number };
  cells: Record<string, Cell>;
  players: Record<string, { x: number; y: number; hlc: HLC }>;
  entities: Record<string, WorldEntity>;
  inventories: Record<string, string[]>;
  spawn: { x: number; y: number };
  /** Semilla de generación (hex). null en salas antiguas sin generación. */
  seed: string | null;

  // Rebuildable projections. Each signed event is represented once in eventRefs;
  // the maps below contain integer pointers, never copied event payloads.
  eventRefs: EventPointer[];
  eventIndex: Record<string, number>;
  entityHistory: Record<string, number[]>;
  authorHistory: Record<string, number[]>;
  cellHistory: Record<string, number[]>;
  cellActivity: Record<string, CellActivity>;
  entityStats: Record<string, EntityStats>;
};

export const ROOM_W = 20;
export const ROOM_H = 15;
export const key = (x: number, y: number) => `${x},${y}`;
export const playerEntityId = (author: string) => `player:${author}`;

const GENESIS_HLC: HLC = { t: 0, c: 0 };

export function createGenesisRoom(
  roomId = 'room-genesis',
  spawn = { x: 3, y: 3 },
  options: { legacyCube?: boolean; seed?: string; doorTo?: string; pillars?: Array<{ x: number; y: number }> } = { legacyCube: true },
): World {
  const cells: Record<string, Cell> = {};
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const border = x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1;
      cells[key(x, y)] = { kind: border ? 'wall' : 'floor', hlc: GENESIS_HLC };
    }
  }

  // Old v1 rooms had a cube embedded in the tile map. Keep it visible and solid
  // when replaying those logs; new v2 rooms create movable cubes with PLACE events.
  for (const p of options.pillars ?? []) cells[key(p.x, p.y)] = { kind: 'wall', hlc: GENESIS_HLC };
  if (options.legacyCube) cells[key(6, 5)] = { kind: 'object', hlc: GENESIS_HLC };
  cells[key(ROOM_W - 1, 7)] = {
    kind: 'door',
    targetRoomId: options.doorTo ?? 'room-demo',
    hlc: GENESIS_HLC,
  };

  return {
    roomId,
    size: { w: ROOM_W, h: ROOM_H },
    cells,
    players: {},
    entities: {},
    inventories: {},
    spawn,
    seed: options.seed ?? null,
    eventRefs: [],
    eventIndex: {},
    entityHistory: {},
    authorHistory: {},
    cellHistory: {},
    cellActivity: {},
    entityStats: {},
  };
}

export function cellActivity(world: World, x: number, y: number): CellActivity {
  const k = key(x, y);
  return world.cellActivity[k] ?? {
    playerVisits: 0,
    objectPlacements: 0,
    objectMoves: 0,
    interactions: 0,
    visitsByAuthor: {},
    uniqueVisitors: 0,
    lastActivityAt: 0,
  };
}

export function entityAt(world: World, x: number, y: number, exceptId?: string): WorldEntity | undefined {
  return Object.values(world.entities).find((entity) =>
    entity.id !== exceptId && entity.location.kind === 'room' &&
    entity.location.roomId === world.roomId && entity.location.x === x && entity.location.y === y,
  );
}

export function canWalk(world: World, x: number, y: number, exceptEntityId?: string): boolean {
  if (x < 0 || y < 0 || x >= world.size.w || y >= world.size.h) return false;
  const cell = world.cells[key(x, y)];
  if (cell?.kind !== 'floor' && cell?.kind !== 'door') return false;
  const occupant = entityAt(world, x, y, exceptEntityId);
  return !occupant?.blocksMovement;
}

export function canStep(world: World, x: number, y: number, dx: number, dy: number): boolean {
  if (!Number.isInteger(x + dx) || !Number.isInteger(y + dy)) return false;
  if (dx === 0 && dy === 0) return false;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (!canWalk(world, x + dx, y + dy)) return false;
  if (dx !== 0 && dy !== 0) {
    return canWalk(world, x + dx, y) && canWalk(world, x, y + dy);
  }
  return true;
}

export function distanceChebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
