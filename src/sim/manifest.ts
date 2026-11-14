// src/sim/manifest.ts
import type { MaterialId } from './materials';

export type InteractionPolicy = 'none' | 'aggregate' | 'full';
export type Visibility = 'private' | 'friends' | 'public';

/** Lo que se firmó en INIT. Inmutable una vez creada la sala. */
export type RoomManifest = {
  schemaVersion: 1;
  roomId: string;
  owner: string;             // pubkey hex
  spawn: { x: number; y: number };
  size: { w: number; h: number };
  seed?: string;             // hex 64; sin él, sala legacy
  pillars?: Array<{ x: number; y: number }>;
  doorTo?: string;
  isHome: boolean;
};

/** Reglas mutables (en dev: las que se pueden tocar sin recrear la sala). */
export type RoomPolicy = {
  interactionPolicy: InteractionPolicy;
  visibility: Visibility;
  // futuras:
  // maxPlayers?: number;
  // allowedEvents?: LogEntryType[];
  // materials?: Partial<Record<MaterialId, Partial<MaterialProps>>>;
};

/** Valores de simulación que hoy son constantes pero el dev quiere ver. */
export type RoomConstants = {
  tickMs: number;
  contaminateMlPerStep: number;
  vomitThreshold: number;
  stunBucketsAfterVomit: number;
  hangoverDecayPerBucket: number;
  maxEffectsPerEntity: number;
  ghostTtlMs: number;
  chunkSize: number;
  renderDistance: number;
  moveCooldownCardinalMs: number;
  moveCooldownDiagonalMs: number;
};

export const DEFAULT_POLICY: RoomPolicy = {
  interactionPolicy: 'full',
  visibility: 'private',
};

export const ROOM_CONSTANTS: RoomConstants = {
  tickMs: 500,
  contaminateMlPerStep: 5,
  vomitThreshold: 0.15,
  stunBucketsAfterVomit: 4,
  hangoverDecayPerBucket: 0.002,
  maxEffectsPerEntity: 500,
  ghostTtlMs: 24 * 60 * 60 * 1000,
  chunkSize: 16,
  renderDistance: 2,
  moveCooldownCardinalMs: 120,
  moveCooldownDiagonalMs: 170,
};

export function manifestFromWorld(world: {
  roomId: string;
  size: { w: number; h: number };
  spawn: { x: number; y: number };
  seed: string | null;
  cells: Record<string, { kind: string; targetRoomId?: string }>;
}): RoomManifest {
  const door = Object.values(world.cells).find((c) => c.kind === 'door' && c.targetRoomId);
  return {
    schemaVersion: 1,
    roomId: world.roomId,
    owner: '',                 // rellenar desde el autor del INIT
    spawn: world.spawn,
    size: world.size,
    ...(world.seed ? { seed: world.seed } : {}),
    ...(door?.targetRoomId ? { doorTo: door.targetRoomId } : {}),
    isHome: world.roomId.startsWith('home-'),
  };
}