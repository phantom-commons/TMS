import {
  canWalk,
  key,
  playerEntityId,
  type CausalEffect,
  type Cell,
  type CreatureState,
  type Player,
  type Residue,
  type World,
  type WorldEntity,
} from './world';
import { MATERIALS, type MaterialId } from './materials';
import { mulberry32, seedFromString } from './prng';

const TICK_MS = 500;
const CONTAMINATE_ML_PER_STEP = 5;
const VOMIT_THRESHOLD = 0.15;
const STUN_BUCKETS_AFTER_VOMIT = 4;
const HANGOVER_DECAY_PER_BUCKET = 0.002;
const MAX_EFFECTS_PER_ENTITY = 500;

/**
 * Avanza el mundo derivado una vez por bucket lógico.
 * Se invoca desde applyEntry() tras aplicar un evento firmado con éxito.
 * Determinista: cliente y relay obtienen el mismo resultado.
 */
export function tickIfDue(world: World, eventHlcTime: number): void {
  if (!Number.isFinite(eventHlcTime)) return;
  if (eventHlcTime > world.lastHlcTime) world.lastHlcTime = eventHlcTime;
  const bucket = Math.floor(world.lastHlcTime / TICK_MS);
  if (bucket <= world.lastTickBucket) return;
  world.lastTickBucket = bucket;
  runTick(world, bucket);
}

function runTick(world: World, bucket: number): void {
  for (const author of Object.keys(world.players)) {
    const player = world.players[author]!;
    decayPlayer(player);
    if (player.residue?.some((r) => r.where === 'paws' && r.amount > 0)) {
      const paw = player.residue.find((r) => r.where === 'paws' && r.amount > 0)!;
      groomPlayer(world, author, paw, bucket);
    }
  }

  for (const entity of Object.values(world.entities)) {
    if (!entity.creature) continue;
    if (entity.location.kind !== 'room' || entity.location.roomId !== world.roomId) continue;
    if (bucket < entity.creature.stunUntilBucket) continue;
    decayCreature(entity.creature);

    const paw = entity.residue?.find((r) => r.where === 'paws' && r.amount > 0);
    if (paw && entity.creature.needs.grooms) {
      groomEntity(world, entity, paw, bucket);
    }

    if (entity.creature.bloodAlcohol > VOMIT_THRESHOLD) {
      vomit(world, entity, bucket);
      continue;
    }
    wander(world, entity, bucket);
  }
}

function decayPlayer(player: Player): void {
  const v = player.bloodAlcohol ?? 0;
  if (v > 0) player.bloodAlcohol = Math.max(0, v - HANGOVER_DECAY_PER_BUCKET);
}

function decayCreature(c: CreatureState): void {
  if (c.bloodAlcohol > 0) c.bloodAlcohol = Math.max(0, c.bloodAlcohol - HANGOVER_DECAY_PER_BUCKET);
}

/** Llamado desde applyEntry(MOVE): un jugador pisa una celda mojada. */
export function contaminatePlayer(world: World, author: string, cell: Cell): void {
  const player = world.players[author];
  if (!player || !cell.liquid) return;
  const ml = Math.min(cell.liquid.amount, CONTAMINATE_ML_PER_STEP);
  if (ml <= 0) return;
  const material = cell.liquid.material;
  player.residue ??= [];
  addResidue(player.residue, material, ml, 'paws');
  cell.liquid.amount -= ml;
  if (cell.liquid.amount <= 0) delete cell.liquid;
  pushEffect(world, playerEntityId(author), {
    effect: 'contaminated', material, amount: ml,
  });
}

/** Llamado desde applyEntry(PLACE|DROP|PUSH|POUR): una entidad acaba sobre una celda mojada. */
export function contaminateEntity(world: World, entity: WorldEntity, cell: Cell): void {
  if (!cell.liquid) return;
  const ml = Math.min(cell.liquid.amount, CONTAMINATE_ML_PER_STEP);
  if (ml <= 0) return;
  const material = cell.liquid.material;
  entity.residue ??= [];
  addResidue(entity.residue, material, ml, 'paws');
  cell.liquid.amount -= ml;
  if (cell.liquid.amount <= 0) delete cell.liquid;
  pushEffect(world, entity.id, {
    effect: 'contaminated', material, amount: ml,
  });
}

function addResidue(residues: Residue[], material: MaterialId, ml: number, where: Residue['where']): void {
  const existing = residues.find((r) => r.where === where && r.material === material);
  if (existing) existing.amount += ml;
  else residues.push({ material, amount: ml, where });
}

function groomPlayer(world: World, author: string, paw: Residue, bucket: number): void {
  const player = world.players[author];
  if (!player?.residue) return;
  const amount = paw.amount;
  const material = paw.material;
  transferToMouth(player.residue, paw);
  ingestPlayer(world, author, material, amount, bucket);
  pushEffect(world, playerEntityId(author), { effect: 'groomed', material, amount, atBucket: bucket });
}

function groomEntity(world: World, entity: WorldEntity, paw: Residue, bucket: number): void {
  if (!entity.residue) return;
  const amount = paw.amount;
  const material = paw.material;
  transferToMouth(entity.residue, paw);
  ingestEntity(world, entity, material, amount, bucket);
  pushEffect(world, entity.id, { effect: 'groomed', material, amount, atBucket: bucket });
}

function transferToMouth(residues: Residue[], paw: Residue): void {
  const mouth = residues.find((r) => r.where === 'mouth' && r.material === paw.material);
  if (mouth) mouth.amount += paw.amount;
  else residues.push({ material: paw.material, amount: paw.amount, where: 'mouth' });
  paw.amount = 0;
  for (let i = residues.length - 1; i >= 0; i--) {
    if (residues[i]!.amount <= 0) residues.splice(i, 1);
  }
}

function ingestPlayer(world: World, author: string, material: MaterialId, ml: number, bucket: number): void {
  const player = world.players[author];
  if (!player) return;
  const delta = doseFor(material, ml, 60);
  if (delta <= 0) return;
  player.bloodAlcohol = Math.min(1, (player.bloodAlcohol ?? 0) + delta);
  pushEffect(world, playerEntityId(author), {
    effect: 'ingested', material, amount: ml, atBucket: bucket,
  });
  pushEffect(world, playerEntityId(author), {
    effect: 'intoxicated', material, amount: player.bloodAlcohol, atBucket: bucket,
  });
}

function ingestEntity(world: World, entity: WorldEntity, material: MaterialId, ml: number, bucket: number): void {
  if (!entity.creature) return;
  const delta = doseFor(material, ml, entity.creature.massKg);
  if (delta <= 0) return;
  entity.creature.bloodAlcohol = Math.min(1, entity.creature.bloodAlcohol + delta);
  pushEffect(world, entity.id, {
    effect: 'ingested', material, amount: ml, atBucket: bucket,
  });
  pushEffect(world, entity.id, {
    effect: 'intoxicated', material, amount: entity.creature.bloodAlcohol, atBucket: bucket,
  });
}

/**
 * Dosis normalizada: 5 ml de cerveza en un gato de 4 kg ≈ 0.004 BAC.
 * Un humano de 60 kg recibe 15× menos por la misma cantidad.
 */
function doseFor(material: MaterialId, ml: number, massKg: number): number {
  const props = MATERIALS[material];
  if (props.intoxicating <= 0) return 0;
  const litres = ml / 1000;
  return props.intoxicating * litres * (4 / Math.max(1, massKg));
}

function vomit(world: World, entity: WorldEntity, bucket: number): void {
  if (entity.location.kind !== 'room') return;
  const cell = world.cells[key(entity.location.x, entity.location.y)];
  if (cell) {
    cell.liquid = { material: 'vomit', amount: 3 };
  }
  entity.creature!.bloodAlcohol = Math.max(0, entity.creature!.bloodAlcohol * 0.5);
  entity.creature!.stunUntilBucket = bucket + STUN_BUCKETS_AFTER_VOMIT;
  pushEffect(world, entity.id, { effect: 'vomited', material: 'vomit', amount: 3, atBucket: bucket });
}

function wander(world: World, entity: WorldEntity, bucket: number): void {
  if (entity.location.kind !== 'room') return;
  const rng = mulberry32(seedFromString(`${entity.id}:${bucket}`));
  const dirs: Array<[number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const [dx, dy] = dirs[Math.floor(rng() * dirs.length)]!;
  const from = entity.location;
  const nx = from.x + dx;
  const ny = from.y + dy;
  if (!canWalk(world, nx, ny, entity.id)) return;
  if (Object.values(world.players).some((p) => p.x === nx && p.y === ny)) return;
  const targetCell = world.cells[key(nx, ny)];
  if (!targetCell) return;
  entity.location = { kind: 'room', roomId: world.roomId, x: nx, y: ny };
  contaminateEntity(world, entity, targetCell);
  pushEffect(world, entity.id, { effect: 'wandered', atBucket: bucket });
}

function pushEffect(world: World, entityId: string, effect: CausalEffect): void {
  const stats = (world.entityStats[entityId] ??= {
    eventCount: 0,
    clickCount: 0,
    movementCount: 0,
    pickupCount: 0,
    dropCount: 0,
    clicksSinceLastMove: 0,
    lastMovedAt: null,
    uniqueActors: [],
    effects: [],
  });
  stats.effects.push(effect);
  if (stats.effects.length > MAX_EFFECTS_PER_ENTITY) {
    stats.effects.splice(0, stats.effects.length - MAX_EFFECTS_PER_ENTITY);
  }
}