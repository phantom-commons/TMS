import { VPC } from '../../core/objects';
import { DIRS, cellBlocked, nearestFreeCell, objectAt, type Dir, type HouseState, type ObjectDefs } from './state';

// Reglas de una room: pares «cuando… → entonces…». Son datos (no traen código): los tipos de disparador y de acción
// son un catálogo cerrado y auditado, igual que los nodos del Salto. La sim sigue siendo entera y determinista:
// los disparadores se deducen del estado antes/después de cada tick, y las acciones devuelven un estado nuevo.

export type Trigger =
  | { t: 'enter' }
  | { t: 'step'; cx: number; cy: number }
  | { t: 'use'; kind: string };

export type Action =
  | { t: 'say'; text: string }
  | { t: 'goto'; cx: number; cy: number }
  | { t: 'recolor'; seed: string };

export type Rule = { id: number; when: Trigger; then: Action };
export type RuleEvent = { t: 'enter' } | { t: 'step'; cx: number; cy: number } | { t: 'use'; kind: string };

export const MAX_RULES = 24;
export const MAX_TEXT = 80;

/** Qué ha pasado entre dos estados. `use` = el jugador pulsó «Usar» mirando hacia `dir`. */
export function detectEvents(prev: HouseState, next: HouseState, defs: ObjectDefs, use?: Dir | null): RuleEvent[] {
  const out: RuleEvent[] = [];
  if (next.player.cx !== prev.player.cx || next.player.cy !== prev.player.cy) out.push({ t: 'step', cx: next.player.cx, cy: next.player.cy });
  if (use != null) {
    const [dx, dy] = DIRS[use] as readonly [number, number];
    const cx = next.player.cx + dx;
    const cy = next.player.cy + dy;
    // el objeto que cubre el centro de esa casilla; si no, cualquiera cuya huella la toque
    const m = VPC / 2;
    const probes: Array<[number, number]> = [[m, m], [0, 0], [VPC - 1, 0], [0, VPC - 1], [VPC - 1, VPC - 1]];
    for (const [px, py] of probes) {
      const o = objectAt(next, defs, cx * VPC + px, cy * VPC + py);
      if (o) {
        out.push({ t: 'use', kind: o.kind });
        break;
      }
    }
  }
  return out;
}

export const matches = (r: Rule, e: RuleEvent): boolean => {
  const w = r.when;
  if (w.t !== e.t) return false;
  if (w.t === 'step' && e.t === 'step') return w.cx === e.cx && w.cy === e.cy;
  if (w.t === 'use' && e.t === 'use') return w.kind === e.kind;
  return true;
};

export type ActionResult = { state: HouseState; say?: string; seed?: string };

/** Aplica una acción. `goto` nunca deja al jugador dentro de un mueble: va a la casilla libre más cercana. */
export function runAction(s: HouseState, a: Action, defs: ObjectDefs): ActionResult {
  switch (a.t) {
    case 'say':
      return { state: s, say: a.text.slice(0, MAX_TEXT) };
    case 'recolor':
      return { state: { ...s, seed: a.seed }, seed: a.seed };
    case 'goto': {
      const cx = Math.min(s.w - 1, Math.max(0, a.cx));
      const cy = Math.min(s.d - 1, Math.max(0, a.cy));
      const cell = cellBlocked(s, defs, cx, cy) ? nearestFreeCell(s, defs, cx, cy) : { cx, cy };
      if (!cell) return { state: s };
      return { state: { ...s, player: { cx: cell.cx, cy: cell.cy, fromX: cell.cx, fromY: cell.cy, moveLeft: 0 } } };
    }
  }
}

/** Dispara las reglas que casan con los eventos, en orden; devuelve el estado final y lo que hay que mostrar. */
export function runRules(s: HouseState, rules: readonly Rule[], events: readonly RuleEvent[], defs: ObjectDefs): { state: HouseState; says: string[]; seed?: string } {
  let state = s;
  const says: string[] = [];
  let seed: string | undefined;
  for (const e of events) {
    for (const r of rules) {
      if (!matches(r, e)) continue;
      const res = runAction(state, r.then, defs);
      state = res.state;
      if (res.say) says.push(res.say);
      if (res.seed) seed = res.seed;
    }
  }
  return { state, says, seed };
}
