// Lógica pura de Snake (sin DOM). Se prueba con tests y se puede mover a otro render sin tocarla.

export type Pt = { x: number; y: number };
export type Dir = 'up' | 'down' | 'left' | 'right';

const VEC: Record<Dir, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export type SnakeState = {
  cols: number;
  rows: number;
  /** cabeza primero */
  body: Pt[];
  dir: Dir;
  food: Pt | null;
  score: number;
  alive: boolean;
  won: boolean;
};

export type Snake = {
  readonly state: SnakeState;
  /** encola un giro (máx. 2) ignorando el giro de 180° */
  turn: (d: Dir) => void;
  /** avanza una casilla */
  tick: () => 'moved' | 'ate' | 'dead' | 'won' | 'idle';
  /** milisegundos entre casillas: acelera con la puntuación */
  interval: () => number;
};

export function createSnake(cols = 16, rows = 16, rng: () => number = Math.random): Snake {
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const state: SnakeState = {
    cols,
    rows,
    body: [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ],
    dir: 'right',
    food: null,
    score: 0,
    alive: true,
    won: false,
  };
  const queue: Dir[] = [];

  const placeFood = () => {
    const taken = new Set(state.body.map((p) => p.y * cols + p.x));
    const free: Pt[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!taken.has(y * cols + x)) free.push({ x, y });
    if (free.length === 0) {
      state.food = null;
      return false;
    }
    state.food = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
    return true;
  };
  placeFood();

  return {
    state,
    turn(d) {
      if (!state.alive) return;
      const last = queue.length ? queue[queue.length - 1] : state.dir;
      if (d === last || d === OPPOSITE[last]) return;
      if (queue.length < 2) queue.push(d);
    },
    tick() {
      if (!state.alive) return 'idle';
      const next = queue.shift();
      if (next) state.dir = next;
      const v = VEC[state.dir];
      const head = { x: state.body[0].x + v.x, y: state.body[0].y + v.y };
      if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) {
        state.alive = false;
        return 'dead';
      }
      const ate = state.food !== null && head.x === state.food.x && head.y === state.food.y;
      // la cola se mueve a la vez: pisar la última casilla es legal salvo que acabes de comer
      const body = ate ? state.body : state.body.slice(0, -1);
      if (body.some((p) => p.x === head.x && p.y === head.y)) {
        state.alive = false;
        return 'dead';
      }
      state.body = [head, ...body];
      if (!ate) return 'moved';
      state.score += 1;
      if (!placeFood()) {
        state.alive = false;
        state.won = true;
        return 'won';
      }
      return 'ate';
    },
    interval: () => Math.max(70, 150 - state.score * 3),
  };
}
