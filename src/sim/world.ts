export type HLC = { t: number; c: number };

export type CellKind = 'floor' | 'wall' | 'object' | 'door';

export type Cell = {
  kind: CellKind;
  owner?: string;
  hlc: HLC;
  targetRoomId?: string;
};

export type World = {
  roomId: string;
  size: { w: number; h: number };
  cells: Record<string, Cell>;
  players: Record<string, { x: number; y: number; hlc: HLC }>;
};

export const ROOM_W = 20;
export const ROOM_H = 15;

export const key = (x: number, y: number) => `${x},${y}`;

const GENESIS_HLC: HLC = { t: 0, c: 0 };

export function createGenesisRoom(roomId = 'room-genesis'): World {
  const cells: Record<string, Cell> = {};

  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const border = x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1;
      cells[key(x, y)] = { kind: border ? 'wall' : 'floor', hlc: GENESIS_HLC };
    }
  }

  cells[key(6, 5)] = { kind: 'object', hlc: GENESIS_HLC };
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
  };
}

export function canWalk(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size.w || y >= world.size.h) return false;
  const cell = world.cells[key(x, y)];
  return cell?.kind === 'floor' || cell?.kind === 'door';
}