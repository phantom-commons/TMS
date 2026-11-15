// Lógica pura de «Salto» (tipo dinosaurio de Chrome sin conexión). Unidades lógicas, sin DOM.

export const W = 480;
export const H = 270;
export const GROUND = 214; // y del suelo
export const PLAYER_X = 64;
export const STAND = { w: 26, h: 40 };
export const DUCK = { w: 34, h: 22 };

const GRAVITY = 2300; // u/s²
const JUMP_V = 760; // u/s
const START_SPEED = 250;
const MAX_SPEED = 620;

export type Obstacle =
  | { kind: 'cactus'; x: number; w: number; h: number }
  | { kind: 'bird'; x: number; w: number; h: number; y: number };

export type RunnerState = {
  /** altura sobre el suelo (>=0) */
  y: number;
  vy: number;
  ducking: boolean;
  obstacles: Obstacle[];
  speed: number;
  distance: number;
  alive: boolean;
  /** segundos hasta el siguiente obstáculo */
  nextIn: number;
};

export type Runner = {
  readonly state: RunnerState;
  jump: () => boolean;
  duck: (on: boolean) => void;
  update: (dt: number) => void;
  score: () => number;
  hitbox: () => { x: number; y: number; w: number; h: number };
};

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** caja del obstáculo con la y de pantalla (arriba) */
export function obstacleBox(o: Obstacle): Box {
  return o.kind === 'cactus'
    ? { x: o.x, y: GROUND - o.h, w: o.w, h: o.h }
    : { x: o.x, y: GROUND - o.y - o.h, w: o.w, h: o.h };
}

export function createRunner(rng: () => number = Math.random): Runner {
  const state: RunnerState = {
    y: 0,
    vy: 0,
    ducking: false,
    obstacles: [],
    speed: START_SPEED,
    distance: 0,
    alive: true,
    nextIn: 1.1,
  };

  const hitbox = (): Box => {
    const s = state.ducking && state.y === 0 ? DUCK : STAND;
    // caja un poco más pequeña que el dibujo: el juego perdona en los bordes
    return { x: PLAYER_X + 3, y: GROUND - state.y - s.h + 3, w: s.w - 6, h: s.h - 6 };
  };

  const spawn = () => {
    const x = W + 20;
    const birds = state.distance > 450 && rng() < 0.3;
    if (birds) {
      // vuela a la altura de la cabeza: hay que agacharse (o saltarlo con buen pulso)
      state.obstacles.push({ kind: 'bird', x, w: 34, h: 18, y: STAND.h - 18 + 4 });
    } else {
      const h = 28 + Math.floor(rng() * 26);
      const w = 16 + Math.floor(rng() * 3) * 10;
      state.obstacles.push({ kind: 'cactus', x, w, h });
    }
    // el hueco crece con la velocidad para que siempre dé tiempo a reaccionar
    state.nextIn = 0.75 + rng() * 0.9 + (state.speed - START_SPEED) / 900;
  };

  return {
    state,
    jump() {
      if (!state.alive || state.y > 0 || state.vy > 0) return false;
      state.vy = JUMP_V;
      state.ducking = false;
      return true;
    },
    duck(on) {
      if (!state.alive) return;
      state.ducking = on;
      if (on && state.y > 0) state.vy = Math.min(state.vy, 0) - 500; // caída rápida
    },
    update(dt) {
      if (!state.alive) return;
      state.distance += (state.speed * dt) / 10;
      state.speed = Math.min(MAX_SPEED, state.speed + dt * 6);

      if (state.y > 0 || state.vy > 0) {
        state.vy -= GRAVITY * dt;
        state.y += state.vy * dt;
        if (state.y <= 0) {
          state.y = 0;
          state.vy = 0;
        }
      }

      for (const o of state.obstacles) o.x -= state.speed * dt;
      state.obstacles = state.obstacles.filter((o) => o.x + o.w > -10);

      state.nextIn -= dt;
      if (state.nextIn <= 0) spawn();

      const me = hitbox();
      if (state.obstacles.some((o) => overlap(me, obstacleBox(o)))) state.alive = false;
    },
    score: () => Math.floor(state.distance),
    hitbox,
  };
}
