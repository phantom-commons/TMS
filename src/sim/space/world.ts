import { chunkKey, chunkOf, cellIndex, generateChunk, type Chunk, type Thing } from './chunk';
import { foldEdits, groupByChunk, type Edit, type Rejected } from './edits';
import { isSolidKind } from './sheets';

// Vista del espacio: chunks generados + ediciones plegadas, con caché. Aquí no hay render ni red.
// Un objeto movido fuera de su chunk de origen sigue registrado en el chunk de origen (su id lo dice);
// para encontrarlo hay que tener cargado ese chunk. Los empujes son de un paso, así que basta con cargar los vecinos.

export type Space = {
  seed: string;
  chunk: (cx: number, cy: number) => Chunk;
  setEdits: (edits: readonly Edit[]) => void;
  /** celdas sólidas añadidas desde fuera (el casco de la nave) */
  setBlockers: (cells: ReadonlyArray<readonly [number, number]>) => void;
  /** cosas añadidas desde fuera (restos de la nave): se mezclan con las del chunk donde caen */
  setExtras: (things: readonly Thing[]) => void;
  staticAt: (x: number, y: number) => string | undefined;
  thingsAt: (x: number, y: number) => Thing[];
  solidAt: (x: number, y: number) => boolean;
  rejected: () => Rejected[];
};

export function openSpace(seed: string, initial: readonly Edit[] = []): Space {
  let groups = groupByChunk(initial);
  const base = new Map<string, Chunk>();
  const folded = new Map<string, { chunk: Chunk; rejected: Rejected[] }>();
  let blockers = new Set<string>();
  let extras: readonly Thing[] = [];

  const baseChunk = (cx: number, cy: number): Chunk => {
    const k = chunkKey(cx, cy);
    let c = base.get(k);
    if (!c) {
      const g = generateChunk(seed, cx, cy);
      const add = extras.filter((t) => chunkOf(t.x, t.y).cx === cx && chunkOf(t.x, t.y).cy === cy);
      base.set(k, (c = add.length ? { ...g, things: [...g.things, ...add.map((t) => ({ ...t, state: { ...t.state } }))] } : g));
    }
    return c;
  };
  const staticSolidBase = (x: number, y: number): boolean => {
    const { cx, cy } = chunkOf(x, y);
    const i = cellIndex(x, y);
    const s = baseChunk(cx, cy).statics.find(([k]) => k === i)?.[1];
    return (s !== undefined && isSolidKind(s)) || blockers.has(`${x},${y}`);
  };
  const chunk = (cx: number, cy: number): Chunk => {
    const k = chunkKey(cx, cy);
    let f = folded.get(k);
    if (!f) {
      const e = groups.get(k);
      f = e ? foldEdits(baseChunk(cx, cy), e, staticSolidBase) : { chunk: baseChunk(cx, cy), rejected: [] };
      folded.set(k, f);
    }
    return f.chunk;
  };
  const staticAt = (x: number, y: number): string | undefined => {
    const { cx, cy } = chunkOf(x, y);
    const i = cellIndex(x, y);
    return chunk(cx, cy).statics.find(([k]) => k === i)?.[1];
  };
  const thingsAt = (x: number, y: number): Thing[] => {
    const { cx, cy } = chunkOf(x, y);
    const out: Thing[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const t of chunk(cx + dx, cy + dy).things) if (t.x === x && t.y === y) out.push(t);
    return out;
  };
  return {
    seed,
    chunk,
    setEdits(edits) {
      groups = groupByChunk(edits);
      folded.clear();
    },
    setExtras(things) {
      extras = things;
      base.clear();
      folded.clear();
    },
    setBlockers(cells) {
      blockers = new Set(cells.map(([x, y]) => `${x},${y}`));
      folded.clear();
    },
    staticAt,
    thingsAt,
    solidAt: (x, y) => blockers.has(`${x},${y}`) || (staticAt(x, y) !== undefined && isSolidKind(staticAt(x, y)!)) || thingsAt(x, y).some((t) => isSolidKind(t.kind)),
    rejected: () => [...folded.values()].flatMap((f) => f.rejected),
  };
}

/** Primera celda libre (con las 8 vecinas libres) en espiral desde el origen: donde apareces. */
export function findSpawn(space: Space, from = { x: 0, y: 0 }): { x: number; y: number } {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = from.x + dx;
        const y = from.y + dy;
        let free = true;
        for (let ny = -1; ny <= 1 && free; ny++) for (let nx = -1; nx <= 1; nx++) if (space.solidAt(x + nx, y + ny)) free = false;
        if (free) return { x, y };
      }
    }
  }
  return from;
}
