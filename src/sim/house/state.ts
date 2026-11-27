import { hashCanonical } from '../hash';
import { VPC } from '../../core/objects';

// Sim de la casa: una sola simulación entera, sin Three.js ni DOM. Los renderers (3D, isométrica, cenital) la leen y
// la dibujan; el giro de cámara, las animaciones y el suavizado de pasos son cosa del renderer, no de la sim.
// Unidades: la casa se mide en casillas; los objetos se colocan en voxeles (1 casilla = 8 voxeles).

export const MOVE_TICKS = 6; // un paso de casilla dura 6 ticks (a 20 ticks/s: ~3,3 casillas/s)
export const TICKS_PER_SECOND = 20;
export const WALL_CELLS = 3;

/** 0 norte (−y), 1 este (+x), 2 sur (+y), 3 oeste (−x): el mismo convenio que la cámara del mundo 3D */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export type Rot = 0 | 1 | 2 | 3;

export type HouseObject = {
  id: number;
  /** id de contenido del objeto (`obj:<hash>`) */
  kind: string;
  /** esquina mínima de la huella girada, en voxeles */
  x: number;
  y: number;
  rot: Rot;
};

export type Player = {
  /** casilla lógica (ya alcanzada: la sim no espera a la animación) */
  cx: number;
  cy: number;
  /** casilla de la que viene, para que el renderer interpole */
  fromX: number;
  fromY: number;
  /** ticks que faltan para terminar el paso; 0 = quieto */
  moveLeft: number;
};

export type HouseState = {
  v: 1;
  /** semilla procedural (p. ej. la clave del dueño): de ella salen los colores */
  seed: string;
  /** tamaño en casillas */
  w: number;
  d: number;
  tick: number;
  nextId: number;
  objects: HouseObject[];
  player: Player;
};

/** Lo que la sim necesita saber de cada objeto; lo aportan los registros del cliente. */
export type ObjectDefs = {
  /** tamaño en voxeles y si bloquea, o null si el objeto no se conoce */
  info: (kind: string) => { sx: number; sy: number; sz: number; solid: boolean } | null;
};

export type StepInput = { move?: Dir | null };

export type EditOp =
  | { t: 'place'; kind: string; x: number; y: number; rot?: Rot }
  | { t: 'move'; id: number; x: number; y: number; rot?: Rot }
  | { t: 'rotate'; id: number }
  | { t: 'remove'; id: number };

export type EditResult = { ok: true; state: HouseState; id?: number } | { ok: false; error: string };

export function createHouse(seed: string, w = 8, d = 8): HouseState {
  const cx = Math.floor(w / 2);
  const cy = d - 2;
  return { v: 1, seed, w, d, tick: 0, nextId: 1, objects: [], player: { cx, cy, fromX: cx, fromY: cy, moveLeft: 0 } };
}

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Huella de un objeto en voxeles (x1/y1 exclusivos). */
export function footprintOf(defs: ObjectDefs, o: Pick<HouseObject, 'kind' | 'x' | 'y' | 'rot'>): Rect | null {
  const i = defs.info(o.kind);
  if (!i) return null;
  const swap = o.rot % 2 === 1;
  const fw = swap ? i.sy : i.sx;
  const fd = swap ? i.sx : i.sy;
  return { x0: o.x, y0: o.y, x1: o.x + fw, y1: o.y + fd };
}

const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** ¿hay un objeto sólido en esa casilla? */
export function cellBlocked(s: HouseState, defs: ObjectDefs, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.d) return true;
  const cell: Rect = { x0: cx * VPC, y0: cy * VPC, x1: (cx + 1) * VPC, y1: (cy + 1) * VPC };
  for (const o of s.objects) {
    const f = footprintOf(defs, o);
    if (f && defs.info(o.kind)?.solid && overlap(f, cell)) return true;
  }
  return false;
}

/** Avanza un tick. Si no hay paso en curso y se pide moverse hacia una casilla libre, el jugador llega a ella ya y el renderer la anima. */
export function stepHouse(s: HouseState, input: StepInput, defs: ObjectDefs): HouseState {
  let p = s.player;
  if (p.moveLeft > 0) p = { ...p, moveLeft: p.moveLeft - 1 };
  if (p.moveLeft === 0 && input.move != null) {
    const [dx, dy] = DIRS[input.move] as readonly [number, number];
    const nx = p.cx + dx;
    const ny = p.cy + dy;
    if (!cellBlocked(s, defs, nx, ny)) p = { cx: nx, cy: ny, fromX: p.cx, fromY: p.cy, moveLeft: MOVE_TICKS };
  }
  return { ...s, tick: s.tick + 1, player: p };
}

const validRot = (r: number): r is Rot => r === 0 || r === 1 || r === 2 || r === 3;

/** Comprueba que un objeto cabe en la casa y no pisa a otro sólido ni al jugador. */
function fits(s: HouseState, defs: ObjectDefs, cand: Pick<HouseObject, 'kind' | 'x' | 'y' | 'rot'>, ignoreId?: number): string | null {
  const info = defs.info(cand.kind);
  const f = footprintOf(defs, cand);
  if (!info || !f) return 'objeto desconocido';
  if (!Number.isInteger(cand.x) || !Number.isInteger(cand.y)) return 'posición inválida';
  if (f.x0 < 0 || f.y0 < 0 || f.x1 > s.w * VPC || f.y1 > s.d * VPC) return 'fuera de la habitación';
  if (info.solid) {
    for (const o of s.objects) {
      if (o.id === ignoreId) continue;
      const g = footprintOf(defs, o);
      if (g && defs.info(o.kind)?.solid && overlap(f, g)) return 'ahí ya hay algo';
    }
    const pc: Rect = { x0: s.player.cx * VPC, y0: s.player.cy * VPC, x1: (s.player.cx + 1) * VPC, y1: (s.player.cy + 1) * VPC };
    if (overlap(f, pc)) return 'estás en medio';
  }
  return null;
}

export function applyEdit(s: HouseState, op: EditOp, defs: ObjectDefs): EditResult {
  switch (op.t) {
    case 'place': {
      const rot = op.rot ?? 0;
      if (!validRot(rot)) return { ok: false, error: 'giro inválido' };
      const err = fits(s, defs, { kind: op.kind, x: op.x, y: op.y, rot });
      if (err) return { ok: false, error: err };
      const id = s.nextId;
      return { ok: true, id, state: { ...s, nextId: id + 1, objects: [...s.objects, { id, kind: op.kind, x: op.x, y: op.y, rot }] } };
    }
    case 'move':
    case 'rotate': {
      const cur = s.objects.find((o) => o.id === op.id);
      if (!cur) return { ok: false, error: 'ese objeto no existe' };
      const next: HouseObject =
        op.t === 'rotate'
          ? { ...cur, rot: ((cur.rot + 1) % 4) as Rot }
          : { ...cur, x: op.x, y: op.y, rot: op.rot ?? cur.rot };
      if (!validRot(next.rot)) return { ok: false, error: 'giro inválido' };
      const err = fits(s, defs, next, cur.id);
      if (err) return { ok: false, error: err };
      return { ok: true, id: cur.id, state: { ...s, objects: s.objects.map((o) => (o.id === cur.id ? next : o)) } };
    }
    case 'remove': {
      if (!s.objects.some((o) => o.id === op.id)) return { ok: false, error: 'ese objeto no existe' };
      return { ok: true, id: op.id, state: { ...s, objects: s.objects.filter((o) => o.id !== op.id) } };
    }
  }
}

/** Objeto cuya huella cubre un punto (en voxeles); el último colocado gana. */
export function objectAt(s: HouseState, defs: ObjectDefs, vx: number, vy: number): HouseObject | null {
  for (let i = s.objects.length - 1; i >= 0; i--) {
    const o = s.objects[i] as HouseObject;
    const f = footprintOf(defs, o);
    if (f && vx >= f.x0 && vx < f.x1 && vy >= f.y0 && vy < f.y1) return o;
  }
  return null;
}

/** Casilla libre más cercana al punto dado, buscando en espiral; null si no hay. */
export function nearestFreeCell(s: HouseState, defs: ObjectDefs, cx: number, cy: number): { cx: number; cy: number } | null {
  for (let r = 0; r <= Math.max(s.w, s.d); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!cellBlocked(s, defs, x, y) && !(x === s.player.cx && y === s.player.cy)) return { cx: x, cy: y };
      }
    }
  }
  return null;
}

/** Huella de estado para comprobar que dos clientes simulan lo mismo. */
export const houseHash = (s: HouseState): string => hashCanonical(s);
