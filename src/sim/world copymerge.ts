import type { MaterialId } from './materials';

export type HLC = { t: number; c: number };

export type CellKind = 'floor' | 'wall' | 'object' | 'door';

export type CellLiquid = { material: MaterialId; amount: number };

export type Cell = {
  kind: CellKind;
  owner?: string;
  hlc: HLC;
  targetRoomId?: string;
  /** Líquido en la celda (charco). amount en ml. */
  liquid?: CellLiquid;
};

export type Residue = {
  material: MaterialId;
  amount: number; // ml
  where: 'paws' | 'body' | 'mouth' | 'clothes';
};

export type AssetRef = {
  /** SHA-256 del contenido, no una URL. */
  hash: string;
  sizeBytes: number;
  mimeType: string;
};

export type EntityLocation =
  | { kind: 'room'; roomId: string; x: number; y: number }
  | { kind: 'inventory'; owner: string }
  | { kind: 'container'; containerId: string };

export type CreatureState = {
  species: string;
  massKg: number;
  needs: { grooms: boolean; drinks: boolean; eats: boolean };
  /** 0..1 */
  bloodAlcohol: number;
  /** Bucket lógico hasta el que la criatura está aturdida (vómito). */
  stunUntilBucket: number;
};

export type WorldEntity = {
  id: string;
  kind: 'object' | 'creature';
  createdBy: string;
  location: EntityLocation;
  blocksMovement: boolean;
  lockedBy?: string;
  asset?: AssetRef;
  /** Líquido contenido (barriles). */
  liquid?: CellLiquid;
  /** Residuos adheridos (patas, boca, cuerpo). */
  residue?: Residue[];
  /** Presente sólo cuando kind === 'creature'. */
  creature?: CreatureState;
};

export type Player = {
  x: number;
  y: number;
  hlc: HLC;
  residue?: Residue[];
  bloodAlcohol?: number;
};

export type CausalEffect = {
  effect: 'contaminated' | 'groomed' | 'ingested' | 'intoxicated' | 'vomited' | 'wandered' | 'poured';
  material?: MaterialId;
  amount?: number;
  causedByEventId?: string;
  atBucket?: number;
};

export type EventPointer = {
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
  effects: CausalEffect[];
};

export type World = {
  roomId: string;
  size: { w: number; h: number };
  cells: Record<string, Cell>;
  players: Record<string, Player>;
  entities: Record<string, WorldEntity>;
  inventories: Record<string, string[]>;
  spawn: { x: number; y: number };

  // Proyecciones reconstruibles.
  eventRefs: EventPointer[];
  eventIndex: Record<string, number>;
  entityHistory: Record<string, number[]>;
  authorHistory: Record<string, number[]>;
  cellHistory: Record<string, number[]>;
  cellActivity: Record<string, CellActivity>;
  entityStats: Record<string, EntityStats>;

  /** Último bucket lógico aplicado. Determinista (no Date.now). */
  lastTickBucket: number;
  /** Mayor hlc.t visto; protege contra saltos de bucket de clientes maliciosos. */
  lastHlcTime: number;
};

export const ROOM_W = 20;
export const ROOM_H = 15;
export const key = (x: number, y: number) => `${x},${y}`;
export const playerEntityId = (author: string) => `player:${author}`;

const GENESIS_HLC: HLC = { t: 0, c: 0 };

export function emptyEntityStats(): EntityStats {
  return {
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

export function createGenesisRoom(
  roomId = 'room-genesis',
  spawn = { x: 3, y: 3 },
  options: { legacyCube?: boolean } = { legacyCube: true },
): World {
  const cells: Record<string, Cell> = {};
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const border = x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1;
      cells[key(x, y)] = { kind: border ? 'wall' : 'floor', hlc: GENESIS_HLC };
    }
  }

  if (options.legacyCube) cells[key(6, 5)] = { kind: 'object', hlc: GENESIS_HLC };
  cells[key(ROOM_W - 1, 7)] = {
    kind: 'door',
    targetRoomId: 'room-demo',
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
    eventRefs: [],
    eventIndex: {},
    entityHistory: {},
    authorHistory: {},
    cellHistory: {},
    cellActivity: {},
    entityStats: {},
    lastTickBucket: 0,
    lastHlcTime: 0,
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