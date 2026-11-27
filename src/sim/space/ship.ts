import type { Counts } from '../../core/inventory';
import { hash2, seedOf } from './noise';
import { findSpawn, openSpace, type Space } from './world';
import type { Thing } from './chunk';

// La nave es un espacio (su interior, que es tu Room) con una posición en otro espacio (el mundo).
// Estados: «flying» (en el espacio: sin escotilla al suelo), «crashed» (estrellada con módulos rotos), «landed» (reparada).
// Entrar/salir son transiciones de ubicación puras; el render se limita a mostrarlas (cámara, animación de caída…).

export const MODULE_IDS = ['casco', 'energia', 'motor', 'comunicaciones'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const MODULES: Record<ModuleId, { name: string; needs: Counts }> = {
  casco: { name: 'Casco', needs: { placa: 2 } },
  energia: { name: 'Energía', needs: { nucleo: 1 } },
  motor: { name: 'Motor', needs: { nucleo: 1, cable: 2 } },
  comunicaciones: { name: 'Comunicaciones', needs: { cable: 1 } },
};

export type ShipStatus = 'flying' | 'crashed' | 'landed';
export type Ship = { v: 1; seed: string; status: ShipStatus; at: { x: number; y: number } | null; modules: Record<ModuleId, boolean> };
export type Loc = { space: 'ship' } | { space: 'world'; x: number; y: number } | { space: 'orbit' };

/**
 * Casco exterior visto desde arriba (morro a la izquierda, motores a la derecha; z0 norte, z4 sur).
 * Solo las celdas con # son sólidas: el resto del rectángulo es suelo libre. La escotilla queda justo al sur del ala sur.
 */
export const HULL_MASK: readonly string[] = ['....###..', '..#######', '#########', '..#######', '....###..'];
export const HULL_W = 9;
export const HULL_D = 5;
export const HATCH_X = 4;

export const newShip = (seed: string): Ship => ({ v: 1, seed, status: 'flying', at: null, modules: { casco: true, energia: true, motor: true, comunicaciones: true } });

export const hullCells = (ship: Ship): Array<[number, number]> => {
  if (!ship.at) return [];
  const out: Array<[number, number]> = [];
  for (let z = 0; z < HULL_D; z++) for (let x = 0; x < HULL_W; x++) if (HULL_MASK[z]![x] === '#') out.push([ship.at.x + x, ship.at.y + z]);
  return out;
};
export const hatchCell = (ship: Ship): { x: number; y: number } | null => (ship.at ? { x: ship.at.x + HATCH_X, y: ship.at.y + HULL_D } : null);

/** Sitio de la caída: cerca del origen, sin tocar estructuras. Determinista. */
export function crashSite(worldSeed: string): { x: number; y: number } {
  const s = seedOf(worldSeed, 'crash');
  const probe = openSpace(worldSeed);
  for (let k = 0; k < 200; k++) {
    const x = (hash2(s, k, 1) % 64) - 32;
    const y = (hash2(s, k, 2) % 64) - 32;
    let ok = true;
    for (let dy = -2; dy <= HULL_D + 2 && ok; dy++) for (let dx = -2; dx <= HULL_W + 1; dx++) if (probe.solidAt(x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return findSpawn(probe, { x: 40, y: 40 });
}

/** La caída: la nave queda en el suelo y se rompen módulos (casco y motor siempre; los demás según la semilla). */
export function crash(ship: Ship): Ship {
  const s = seedOf(ship.seed, 'broken');
  const modules = { ...ship.modules, casco: false, motor: false };
  if (hash2(s, 1, 1) % 2 === 0) modules.energia = false;
  if (hash2(s, 2, 2) % 2 === 0) modules.comunicaciones = false;
  return { ...ship, status: 'crashed', at: crashSite(ship.seed), modules };
}

const has = (have: Counts, need: Counts): boolean => Object.entries(need).every(([k, n]) => (have[k] ?? 0) >= n);

export type RepairResult = { ok: true; ship: Ship; consumed: Counts } | { ok: false; reason: string };

/** Repara un módulo gastando lo que llevas encima. La nave debe estar en el suelo. */
export function repair(ship: Ship, id: ModuleId, carried: Counts): RepairResult {
  if (ship.status === 'flying') return { ok: false, reason: 'La nave no está en el suelo.' };
  if (ship.modules[id]) return { ok: false, reason: 'Ya está reparado.' };
  const need = MODULES[id].needs;
  if (!has(carried, need)) return { ok: false, reason: 'Te faltan piezas.' };
  const modules = { ...ship.modules, [id]: true };
  const all = MODULE_IDS.every((m) => modules[m]);
  return { ok: true, ship: { ...ship, modules, status: all ? 'landed' : ship.status }, consumed: { ...need } };
}

export const broken = (ship: Ship): ModuleId[] => MODULE_IDS.filter((m) => !ship.modules[m]);
export const readyToFly = (ship: Ship): boolean => broken(ship).length === 0;

const near = (ship: Ship, x: number, y: number): boolean => {
  const h = hatchCell(ship);
  return h !== null && Math.max(Math.abs(h.x - x), Math.abs(h.y - y)) <= 1;
};

/** Entrar: desde el mundo, cerca de la escotilla. */
export function enterShip(ship: Ship, loc: Loc): Loc | { error: string } {
  if (loc.space === 'ship') return { error: 'Ya estás dentro.' };
  if (loc.space === 'orbit') return ship.status === 'flying' ? { space: 'ship' } : { error: 'No estás junto a la nave.' };
  if (ship.status === 'flying' || !ship.at) return { error: 'La nave no está aquí.' };
  return near(ship, loc.x, loc.y) ? { space: 'ship' } : { error: 'Acércate a la escotilla.' };
}

/** Salir: al suelo junto a la escotilla; en vuelo solo con traje y al vacío. */
export function exitShip(ship: Ship, carried: Counts): Loc | { error: string } {
  if (ship.status === 'flying') return (carried.traje ?? 0) > 0 ? { space: 'orbit' } : { error: 'Sin traje no puedes salir al vacío.' };
  const h = hatchCell(ship);
  return h ? { space: 'world', x: h.x, y: h.y } : { error: 'La nave no tiene posición.' };
}

/** Espacio del mundo con el casco de la nave como obstáculo. */
export function worldWithShip(ship: Ship, space: Space): Space {
  space.setBlockers(hullCells(ship));
  return space;
}

// ───────────── restos de la nave: suministros garantizados ─────────────

/**
 * Dos cajones de salvamento junto al casco con EXACTAMENTE las piezas que pide reparar lo que se rompió en la caída
 * (más un cable de sobra). El botín aleatorio de los cofres del mundo no basta siempre: con esto la historia nunca se
 * queda sin final. El contenido va en `state.loot` y es el mismo aunque ya hayas reparado algo (se calcula de la caída).
 */
export function salvage(ship: Ship, space: Pick<Space, 'solidAt'>): Thing[] {
  if (!ship.at) return [];
  const atCrash = crash(newShip(ship.seed)).modules; // true = funciona
  const items: string[] = ['cable'];
  for (const m of MODULE_IDS) if (!atCrash[m]) for (const [k, n] of Object.entries(MODULES[m].needs)) for (let i = 0; i < n; i++) items.push(k);
  const cells: Array<[number, number]> = [[-1, 2], [HULL_W, 2], [-1, 1], [HULL_W, 3], [-1, 3], [HULL_W, 1], [4, -1], [2, -1]];
  const free = cells.map(([dx, dy]) => ({ x: ship.at!.x + dx, y: ship.at!.y + dy })).filter((c) => !space.solidAt(c.x, c.y)).slice(0, 2);
  return free.map((c, n) => ({
    id: `gen:${Math.floor(c.x / 16)},${Math.floor(c.y / 16)}:salvage:${n}`,
    kind: 'cofre',
    x: c.x,
    y: c.y,
    state: { open: false, loot: items.filter((_, i) => i % 2 === n).join(',') },
  }));
}

// ───────────── casco en voxels ─────────────

export type HullTone = 'casco' | 'casco2' | 'quemado' | 'luz' | 'motor' | 'antena' | 'franja';
export type HullVoxel = { x: number; y: number; z: number; tone: HullTone };

/**
 * Casco en voxels con silueta de nave: morro afilado, cuerpo, alas planas, cabina de cristal, aleta con antena y dos
 * toberas. El daño se ve: huecos y quemaduras con el casco roto, cabina oscura sin energía, toberas apagadas sin motor.
 */
export function hullVoxels(ship: Ship): HullVoxel[] {
  const out: HullVoxel[] = [];
  const s = seedOf(ship.seed, 'hull');
  const m = ship.modules;
  const at = (x: number, y: number, z: number, tone: HullTone) => out.push({ x, y, z, tone });
  const wingTip = (x: number, z: number) => z === 0 || z === HULL_D - 1 ? x >= 4 && x <= 6 : false;
  for (let z = 0; z < HULL_D; z++) {
    for (let x = 0; x < HULL_W; x++) {
      if (HULL_MASK[z]![x] !== '#') continue;
      if (x === 8 && (z === 1 || z === 3)) continue; // ahí van las toberas
      const wing = wingTip(x, z);
      // el ala rota pierde la punta
      if (!m.casco && wing && hash2(s, x, z, 3) % 100 < 55) continue;
      const burned = !m.casco && hash2(s, x, z, 2) % 100 < 30;
      const stripe = x === 3 && !wing;
      at(x, 0, z, burned ? 'quemado' : stripe ? 'franja' : wing || z === 1 || z === 3 ? 'casco2' : 'casco');
    }
  }
  // cuerpo: segunda capa entre el morro y las toberas, con el morro más bajo
  for (let z = 1; z <= 3; z++) {
    for (let x = 1; x <= 7; x++) {
      if (z !== 2 && (x === 1 || x === 7)) continue;
      const hole = !m.casco && (z !== 2 || x > 4) && hash2(s, x, z, 1) % 100 < 32;
      if (hole) continue;
      const burned = !m.casco && hash2(s, x, z, 4) % 100 < 35;
      at(x, 1, z, burned ? 'quemado' : x === 3 ? 'franja' : 'casco');
    }
  }
  // cabina de cristal sobre el morro
  at(2, 2, 2, m.energia ? 'luz' : 'quemado');
  at(3, 2, 2, m.energia ? 'luz' : 'quemado');
  // aleta de cola con antena
  at(6, 2, 2, 'casco2');
  at(6, 3, 2, 'casco2');
  if (m.comunicaciones) {
    at(6, 4, 2, 'antena');
    at(6, 5, 2, 'antena');
  }
  // toberas en la cola (x = 8): encendidas con motor, quemadas y a medias sin él
  for (const z of [1, 3]) {
    if (m.motor) {
      at(8, 0, z, 'motor');
      at(8, 1, z, 'motor');
    } else {
      at(8, 0, z, 'quemado');
      if (hash2(s, 8, z, 5) % 2 === 0) at(8, 1, z, 'quemado');
    }
  }
  return out;
}

// ───────────── muerte: cápsula en el sitio, recuperable ─────────────

export type Capsule = { id: string; at: { x: number; y: number }; items: Counts };

/** Al morir despiertas en la nave; lo que llevabas queda en una cápsula en el sitio. Lo guardado en la nave no se toca. */
export function die(carried: Counts, at: { x: number; y: number }, n: number): { capsule: Capsule | null; carried: Counts; respawn: Loc } {
  const items = Object.fromEntries(Object.entries(carried).filter(([, v]) => v > 0));
  return { capsule: Object.keys(items).length ? { id: `cap:${n}`, at, items } : null, carried: {}, respawn: { space: 'ship' } };
}

export function recover(capsule: Capsule, carried: Counts, pos: { x: number; y: number }): Counts | { error: string } {
  if (Math.max(Math.abs(capsule.at.x - pos.x), Math.abs(capsule.at.y - pos.y)) > 1) return { error: 'Acércate a la cápsula.' };
  const out = { ...carried };
  for (const [k, v] of Object.entries(capsule.items)) out[k] = (out[k] ?? 0) + v;
  return out;
}
