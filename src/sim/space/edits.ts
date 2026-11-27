import { hashCanonical } from '../hash';
import { chunkKey, originChunkOfThing, type Chunk, type State, type Thing } from './chunk';
import { hasTag, isSolidKind } from './sheets';
import { hash2 } from './noise';

// Ediciones: lo único que se guarda de un chunk generado. Cada una es un hecho firmado por quien la hace (el
// firmado vive en el registro; aquí solo importa el orden). Se pliegan en orden canónico (t, by, seq): el resultado
// no depende del orden en que llegaron, y si dos personas hacen lo mismo sobre lo mismo (coger el mismo cubo,
// abrir el mismo cofre), gana la primera y la otra queda como rechazada, sin duplicar nada.

export type Edit = {
  id: string; // id de la cosa (gen:…)
  t: number; // tiempo lógico (HLC)
  by: string;
  seq: number;
  op: 'move' | 'take' | 'open' | 'set';
  x?: number;
  y?: number;
  state?: State;
};

export type Rejected = { edit: Edit; reason: string };

const order = (a: Edit, b: Edit): number => a.t - b.t || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0) || a.seq - b.seq || (a.op < b.op ? -1 : a.op > b.op ? 1 : 0);

export const MAX_PUSH = 1;
export const propId = (cx: number, cy: number, n: number): string => `gen:${cx},${cy}:p:${n}`;

/** Aplica las ediciones del chunk (en orden canónico) y devuelve el chunk resultante y lo rechazado. */
export function foldEdits(base: Chunk, edits: readonly Edit[], solidElsewhere: (x: number, y: number) => boolean = () => false): { chunk: Chunk; rejected: Rejected[] } {
  const things = new Map<string, Thing>(base.things.map((t) => [t.id, { ...t, state: { ...t.state } }]));
  const gone = new Set<string>();
  const staticSolid = new Set(base.statics.filter(([, k]) => isSolidKind(k)).map(([i]) => i));
  const rejected: Rejected[] = [];
  const solidAt = (x: number, y: number, ignore: string): boolean => {
    if (solidElsewhere(x, y)) return true;
    const cx = Math.floor(x / 16);
    const cy = Math.floor(y / 16);
    if (cx === base.cx && cy === base.cy && staticSolid.has((((y % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16))) return true;
    for (const t of things.values()) if (t.id !== ignore && t.x === x && t.y === y && isSolidKind(t.kind)) return true;
    return false;
  };
  // un prop (arbusto, pino…) pasa a ser una cosa la primera vez que alguien lo toca: id `gen:<cx>,<cy>:p:<n>`
  const promoted = new Set<number>();
  const promote = (id: string): Thing | undefined => {
    const m = new RegExp(`^gen:${base.cx},${base.cy}:p:(\\d+)$`).exec(id);
    const p = m ? base.props[Number(m[1])] : undefined;
    if (!m || !p || gone.has(id)) return undefined;
    promoted.add(Number(m[1]));
    const t: Thing = { id, kind: p.kind, x: base.cx * 16 + Math.floor(p.u / 8), y: base.cy * 16 + Math.floor(p.v / 8), state: {} };
    things.set(id, t);
    return t;
  };
  for (const e of [...edits].sort(order)) {
    const t = things.get(e.id) ?? promote(e.id);
    const no = (reason: string) => void rejected.push({ edit: e, reason });
    if (!t) {
      no(gone.has(e.id) ? 'ya no existe' : 'no existe');
      continue;
    }
    if (e.op === 'move') {
      if (!hasTag(t.kind, 'empujable') && !hasTag(t.kind, 'decorativo')) no('no se mueve');
      else if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) no('destino inválido');
      else if (Math.abs(e.x! - t.x) + Math.abs(e.y! - t.y) !== MAX_PUSH) no('solo un paso');
      else if (isSolidKind(t.kind) && solidAt(e.x!, e.y!, t.id)) no('ocupado');
      else {
        t.x = e.x!;
        t.y = e.y!;
      }
    } else if (e.op === 'take') {
      if (!hasTag(t.kind, 'recogible')) no('no se recoge');
      else {
        things.delete(t.id);
        gone.add(t.id);
      }
    } else if (e.op === 'open') {
      if (!hasTag(t.kind, 'abre')) no('no se abre');
      else if (t.state.open === true) no('ya abierto');
      else t.state = { ...t.state, open: true, by: e.by };
    } else {
      t.state = { ...t.state, ...(e.state ?? {}) };
    }
  }
  const ordered = [...things.values()]; // orden del chunk base; los promovidos al final, en orden canónico
  return { chunk: { ...base, things: ordered, props: base.props.filter((_, i) => !promoted.has(i)) }, rejected };
}

/** Qué hay dentro de un cofre: función pura de (mundo, id). Los ids de unidad se derivan igual, así que un doble cobro se detecta. */
const LOOT = ['cable', 'placa', 'nucleo', 'hierro', 'cubo-recogible', 'cable'] as const;
export function lootOf(worldSeed: string, thingId: string): string[] {
  const s = parseInt(hashCanonical({ domain: 'TMS_LOOT', worldSeed, thingId }).slice(0, 8), 16) >>> 0;
  const n = 1 + (hash2(s, 1, 1) % 3);
  return Array.from({ length: n }, (_, i) => LOOT[hash2(s, i, 7) % LOOT.length]!);
}
export const lootUnitId = (worldSeed: string, thingId: string, index: number): string => hashCanonical({ domain: 'TMS_LOOT_UNIT', worldSeed, thingId, index });

/** Agrupa ediciones por chunk de origen de la cosa. */
export function groupByChunk(edits: readonly Edit[]): Map<string, Edit[]> {
  const out = new Map<string, Edit[]>();
  for (const e of edits) {
    const c = originChunkOfThing(e.id);
    if (!c) continue;
    const k = chunkKey(c.cx, c.cy);
    out.set(k, [...(out.get(k) ?? []), e]);
  }
  return out;
}

/** Punto de control: el chunk ya plegado y su hash, para no reproducir todo el registro. */
export const checkpoint = (c: Chunk): { key: string; hash: string } => ({ key: chunkKey(c.cx, c.cy), hash: hashCanonical(c) });
