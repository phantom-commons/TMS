import { hashCanonical } from '../hash';
import { mulberry32Step } from '../prng';
import { nodesOf, validateManifest, type Manifest, type NodeSpec } from './manifest';

// Motor de la sim por nodos. Todo es ENTERO: posiciones en punto fijo (FP pasos por unidad), tiempo en ticks fijos
// y la semilla vive dentro del estado. Mismas reglas + misma semilla + mismas entradas = mismo estado, siempre.
// Los decimales solo existen al dibujar (un renderer puede dividir por FP).
//
// Convención de ejes: x hacia la derecha desde el borde izquierdo; y HACIA ARRIBA desde el suelo.

export const FP = 65536;
const SPAWN_MARGIN = 20; // unidades fuera de pantalla donde aparecen los objetos
const MAX_OBJECTS = 128;
const SAFETY_LIFETIME_S = 120; // ningún objeto vive más que esto aunque no tenga regla de desaparición

type Edge = 'right' | 'left';
type Dir = 'left' | 'right' | 'up' | 'down';

type PrefabCfg = {
  wMin: number; wMax: number; hMin: number; hMax: number; yFp: number;
  mover: { dir: Dir; follow: boolean; speedFp: number } | null;
  hazard: { damage: number; trigger: 'touch' | 'interval'; everyTicks: number } | null;
  despawn: { mode: 'offscreen' | 'lifetime'; lifeTicks: number; marginFp: number };
};

export type Config = {
  tickRate: number;
  worldW: number; // unidades
  worldH: number;
  groundH: number;
  gFp: number; // gravedad por tick², 0 = sin gravedad
  scrollStartFp: number; scrollMaxFp: number; scrollAccelFp: number;
  startSpeedUps: number; // u/s, para el hueco extra
  timing: { firstTicks: number; gapMinMs: number; gapMaxMs: number; growthMs: number };
  spawns: Array<{ prefab: string; weight: number; minScore: number; edge: Edge }>;
  unitsPerPointFp: number;
  player: {
    xFp: number; w: number; h: number; forgive: number;
    v0: number; // impulso de salto (fp/tick); 0 = no puede saltar
    duck: { w: number; h: number; fastFallFp: number } | null;
    hpMax: number; invulnTicks: number;
  };
  prefabs: Record<string, PrefabCfg>;
};

export type SimObject = {
  id: number; prefab: string;
  x: number; y: number; w: number; h: number; // fp (w, h en unidades)
  age: number; seen: boolean; hit: boolean; nextHit: number;
};

export type SimState = {
  tick: number;
  rng: number;
  scroll: number; // fp/tick
  distance: number; // fp
  py: number; vy: number; // fp sobre el suelo
  ducking: boolean; prevDuck: boolean;
  hp: number; invuln: number;
  alive: boolean;
  nextSpawn: number;
  nextId: number;
  objects: SimObject[];
};

export type Sim = { cfg: Config; state: SimState };
export type SimInput = { jump: boolean; duck: boolean };

// ───────── compilación: manifiesto → valores enteros ─────────

const p = (list: NodeSpec[], type: string): Record<string, number | boolean | string> | null => nodesOf(list, type)[0]?.params ?? null;
const num = (v: unknown): number => v as number;

const perSecond = (units: number, tickRate: number) => Math.round((units * FP) / tickRate);
const perSecond2 = (units: number, tickRate: number) => Math.round((units * FP) / (tickRate * tickRate));
const msToTicks = (ms: number, tickRate: number) => Math.floor((ms * tickRate + 999) / 1000);

/** menor impulso entero (fp/tick) cuyo salto, con esta gravedad discreta, llega al menos a la altura pedida */
export function jumpImpulse(gFp: number, heightFp: number): number {
  if (gFp <= 0 || heightFp <= 0) return 0;
  const apex = (v0: number) => {
    let y = 0;
    let v = v0;
    while (v > 0) {
      y += v;
      v -= gFp;
    }
    return y;
  };
  let hi = 1;
  while (apex(hi) < heightFp && hi < 1 << 26) hi *= 2;
  let lo = 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (apex(mid) >= heightFp) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function compile(m: Manifest): Config {
  const err = validateManifest(m);
  if (err) throw new Error(`manifiesto inválido: ${err}`);
  const w = p(m.world, 'world')!;
  const tickRate = Number(w.tickRate);
  const res = num(w.resolution);
  const grav = p(m.world, 'gravity');
  const gFp = grav && grav.direction === 'down' ? perSecond2(num(grav.strength), tickRate) : 0;
  const sc = p(m.world, 'scroll');
  const timing = p(m.world, 'spawnTiming');
  const score = p(m.world, 'score');
  const body = p(m.player, 'playerBody')!;
  const jump = p(m.player, 'playerJump');
  const duck = p(m.player, 'playerDuck');
  const health = p(m.player, 'playerHealth');

  const prefabs: Record<string, PrefabCfg> = {};
  for (const [id, list] of Object.entries(m.prefabs)) {
    const b = p(list, 'body')!;
    const mv = p(list, 'mover');
    const hz = p(list, 'hazard');
    const ds = p(list, 'despawn');
    prefabs[id] = {
      wMin: num(b.widthMin), wMax: num(b.widthMax), hMin: num(b.heightMin), hMax: num(b.heightMax), yFp: num(b.y) * FP,
      mover: mv ? { dir: mv.direction as Dir, follow: mv.followScroll === true, speedFp: perSecond(num(mv.speed), tickRate) } : null,
      hazard: hz ? { damage: num(hz.damage), trigger: hz.trigger as 'touch' | 'interval', everyTicks: msToTicks(num(hz.everyMs), tickRate) } : null,
      despawn: {
        mode: ds ? (ds.mode as 'offscreen' | 'lifetime') : 'offscreen',
        lifeTicks: msToTicks(ds ? num(ds.lifetimeMs) : 5000, tickRate),
        marginFp: (ds ? num(ds.margin) : 10) * FP,
      },
    };
  }

  return {
    tickRate,
    worldW: res * num(w.cols),
    worldH: res * num(w.rows),
    groundH: num(w.groundHeight),
    gFp,
    scrollStartFp: perSecond(sc ? num(sc.startSpeed) : 0, tickRate),
    scrollMaxFp: perSecond(sc ? num(sc.maxSpeed) : 0, tickRate),
    scrollAccelFp: perSecond2(sc ? num(sc.accel) : 0, tickRate),
    startSpeedUps: sc ? num(sc.startSpeed) : 0,
    timing: {
      firstTicks: msToTicks(timing ? num(timing.firstDelayMs) : 1100, tickRate),
      gapMinMs: timing ? num(timing.gapMinMs) : 750,
      gapMaxMs: timing ? num(timing.gapMaxMs) : 1650,
      growthMs: timing ? num(timing.gapGrowthMs) : 0,
    },
    spawns: nodesOf(m.world, 'spawn').map((s) => ({
      prefab: s.params.prefab as string, weight: num(s.params.weight), minScore: num(s.params.minScore), edge: s.params.edge as Edge,
    })),
    unitsPerPointFp: (score ? num(score.unitsPerPoint) : 10) * FP,
    player: {
      xFp: num(body.x) * FP, w: num(body.width), h: num(body.height), forgive: num(body.forgiveness),
      v0: jump ? jumpImpulse(gFp, num(jump.height) * FP) : 0,
      duck: duck ? { w: num(duck.width), h: num(duck.height), fastFallFp: perSecond(num(duck.fastFall), tickRate) } : null,
      hpMax: health ? num(health.max) : 1,
      invulnTicks: health ? msToTicks(num(health.invulnerableMs), tickRate) : 0,
    },
    prefabs,
  };
}

// ───────── simulación ─────────

export function createSim(manifest: Manifest, seed: number): Sim {
  const cfg = compile(manifest);
  return {
    cfg,
    state: {
      tick: 0,
      rng: seed >>> 0,
      scroll: cfg.scrollStartFp,
      distance: 0,
      py: 0, vy: 0,
      ducking: false, prevDuck: false,
      hp: cfg.player.hpMax, invuln: 0,
      alive: true,
      nextSpawn: cfg.timing.firstTicks,
      nextId: 1,
      objects: [],
    },
  };
}

/** entero uniforme en [lo, hi] sin decimales: u32 * n es exacto (< 2^53) y dividir por 2^32 también */
function randInt(s: SimState, lo: number, hi: number): number {
  const r = mulberry32Step(s.rng);
  s.rng = r.state;
  return lo + Math.floor((r.u32 * (hi - lo + 1)) / 4294967296);
}

export const scoreOf = (sim: Sim): number => Math.floor(sim.state.distance / sim.cfg.unitsPerPointFp);
const onGround = (s: SimState) => s.py === 0 && s.vy === 0;
/** velocidad de avance actual en unidades/segundo (entera) */
const speedUps = (sim: Sim) => Math.floor((sim.state.scroll * sim.cfg.tickRate) / FP);

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** cuerpo del jugador (fp): agachado solo cuenta en el suelo */
export function playerDims(sim: Sim): { w: number; h: number; ducked: boolean } {
  const { player } = sim.cfg;
  const ducked = sim.state.ducking && onGround(sim.state) && player.duck !== null;
  return ducked && player.duck ? { w: player.duck.w, h: player.duck.h, ducked } : { w: player.w, h: player.h, ducked };
}

/** caja de colisión del jugador (fp), recortada por el perdón de los bordes */
export function playerBox(sim: Sim): Box {
  const { player } = sim.cfg;
  const d = playerDims(sim);
  const f = player.forgive * FP;
  return { x: player.xFp + f, y: sim.state.py + f, w: d.w * FP - 2 * f, h: d.h * FP - 2 * f };
}

const objectBox = (o: SimObject): Box => ({ x: o.x, y: o.y, w: o.w * FP, h: o.h * FP });

function spawn(sim: Sim): void {
  const { cfg, state: s } = sim;
  const eligible = cfg.spawns.filter((e) => e.minScore <= scoreOf(sim) && cfg.prefabs[e.prefab]);
  if (eligible.length > 0 && s.objects.length < MAX_OBJECTS) {
    const total = eligible.reduce((a, e) => a + e.weight, 0);
    let pick = randInt(s, 0, total - 1);
    const entry = eligible.find((e) => (pick -= e.weight) < 0) ?? eligible[0]!;
    const pf = cfg.prefabs[entry.prefab]!;
    const w = randInt(s, pf.wMin, pf.wMax);
    const h = randInt(s, pf.hMin, pf.hMax);
    const x = entry.edge === 'right' ? (cfg.worldW + SPAWN_MARGIN) * FP : -(w + SPAWN_MARGIN) * FP;
    s.objects.push({ id: s.nextId++, prefab: entry.prefab, x, y: pf.yFp, w, h, age: 0, seen: false, hit: false, nextHit: 0 });
  }
  // el hueco crece con la velocidad ganada para que siempre dé tiempo a reaccionar
  const extraMs = Math.floor((Math.max(0, speedUps(sim) - cfg.startSpeedUps) * cfg.timing.growthMs) / 100);
  const gapMs = randInt(s, cfg.timing.gapMinMs, Math.max(cfg.timing.gapMinMs, cfg.timing.gapMaxMs)) + extraMs;
  s.nextSpawn = s.tick + Math.max(1, msToTicks(gapMs, cfg.tickRate));
}

function hurt(sim: Sim, damage: number): boolean {
  const s = sim.state;
  if (s.invuln > 0 || damage <= 0) return false;
  s.hp -= damage;
  if (s.hp <= 0) {
    s.hp = 0;
    s.alive = false;
  } else {
    s.invuln = sim.cfg.player.invulnTicks;
  }
  return true;
}

/** Avanza un tick. Orden fijo: avance → jugador → objetos → daño → aparición. */
export function stepSim(sim: Sim, input: SimInput): void {
  const { cfg, state: s } = sim;
  if (!s.alive) return;
  s.tick += 1;

  // avance del mundo y distancia (la distancia cuenta con la velocidad de antes de acelerar, como en el juego original)
  s.distance += s.scroll;
  s.scroll = Math.min(cfg.scrollMaxFp, s.scroll + cfg.scrollAccelFp);

  // jugador
  const airborne = !onGround(s);
  if (input.duck && !s.prevDuck && airborne && cfg.player.duck) s.vy = Math.min(s.vy, 0) - cfg.player.duck.fastFallFp; // caída rápida, una vez por pulsación
  s.prevDuck = input.duck;
  s.ducking = input.duck;
  if (input.jump && onGround(s) && cfg.player.v0 > 0) {
    s.vy = cfg.player.v0;
    s.ducking = false;
  }
  if (!onGround(s)) {
    s.py += s.vy;
    s.vy -= cfg.gFp;
    if (s.py <= 0) {
      s.py = 0;
      s.vy = 0;
    }
  }
  if (s.invuln > 0) s.invuln -= 1;

  // objetos: mover y retirar
  const W = cfg.worldW * FP;
  const keep: SimObject[] = [];
  for (const o of s.objects) {
    const pf = cfg.prefabs[o.prefab]!;
    if (pf.mover) {
      const sp = pf.mover.follow ? s.scroll : pf.mover.speedFp;
      if (pf.mover.dir === 'left') o.x -= sp;
      else if (pf.mover.dir === 'right') o.x += sp;
      else if (pf.mover.dir === 'up') o.y += sp;
      else o.y -= sp;
    }
    o.age += 1;
    const wFp = o.w * FP;
    const hFp = o.h * FP;
    if (o.x + wFp > 0 && o.x < W && o.y + hFp > 0) o.seen = true;
    const outside = o.x + wFp < -pf.despawn.marginFp || o.x > W + pf.despawn.marginFp || o.y + hFp < -pf.despawn.marginFp;
    const gone = pf.despawn.mode === 'lifetime' ? o.age >= pf.despawn.lifeTicks : o.seen && outside;
    if (!gone && o.age < SAFETY_LIFETIME_S * cfg.tickRate) keep.push(o);
  }
  s.objects = keep;

  // daño
  const me = playerBox(sim);
  for (const o of s.objects) {
    const hz = cfg.prefabs[o.prefab]!.hazard;
    if (!hz || !overlap(me, objectBox(o))) continue;
    if (hz.trigger === 'touch') {
      if (!o.hit && hurt(sim, hz.damage)) o.hit = true;
    } else if (s.tick >= o.nextHit && hurt(sim, hz.damage)) {
      o.nextHit = s.tick + hz.everyTicks;
    }
    if (!s.alive) break;
  }

  // aparición
  if (s.alive && s.tick >= s.nextSpawn) spawn(sim);
}

/** Huella del estado completo: sirve para comparar dos corridas o como checkpoint. */
export const simHash = (sim: Sim): string => hashCanonical(sim.state);

/** Reproduce una lista de entradas (una por tick) desde cero: mismas entradas + semilla = mismo resultado. */
export function replay(manifest: Manifest, seed: number, inputs: SimInput[]): Sim {
  const sim = createSim(manifest, seed);
  for (const input of inputs) stepSim(sim, input);
  return sim;
}
