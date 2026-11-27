import { hash2, seedOf } from './noise';

// Plantillas de estructura: dibujos pequeños con leyenda. Se colocan en una rejilla de regiones (REGION celdas de lado)
// y siempre caben enteras dentro de su región, así que cada chunk solo mira UNA región.
//   #  muro (estático)     .  suelo (estático)     D  puerta (suelo; marca la entrada)
//   c  cofre (con estado)  b  cubo empujable (con estado)     ' '  nada

export const REGION = 32;

export type Template = { id: string; rows: readonly string[] };

export const TEMPLATES: readonly Template[] = [
  { id: 'cabana', rows: ['#######', '#.....#', '#..c..#', '#.....#', '###D###'] },
  { id: 'ruina', rows: ['#.#.#', '.....', '#.c.#', '..b..', '#.D.#'] },
  { id: 'campamento', rows: [' b. ', '.c..', '..b.', ' D. '] },
  { id: 'hangar', rows: ['###########', '#.........#', '#..c...b..#', '#.........#', '#..b...c..#', '#.........#', '#####D#####'] },
];

export const LEGEND = new Set(['#', '.', 'D', 'c', 'b', ' ']);
export const templateSize = (t: Template): { w: number; d: number } => ({ w: Math.max(...t.rows.map((r) => r.length)), d: t.rows.length });

/** Comprueba forma, leyenda y que todo lo caminable se alcance desde la puerta. */
export function validateTemplate(t: Template): string | null {
  const { w, d } = templateSize(t);
  if (t.rows.some((r) => r.length !== w)) return 'filas de distinto ancho';
  if (w > REGION - 2 || d > REGION - 2) return 'no cabe en una región';
  let door: [number, number] | null = null;
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) {
    const ch = t.rows[y]![x]!;
    if (!LEGEND.has(ch)) return `símbolo desconocido «${ch}»`;
    if (ch === 'D') door = [x, y];
  }
  if (!door) return 'sin puerta';
  const walk = (ch: string) => ch !== '#' && ch !== ' ';
  const seen = new Set<string>([`${door[0]},${door[1]}`]);
  const q: Array<[number, number]> = [door];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const ch = t.rows[ny]?.[nx];
      if (ch === undefined || !walk(ch) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) if (walk(t.rows[y]![x]!) && !seen.has(`${x},${y}`)) return `celda inalcanzable en ${x},${y}`;
  // la puerta debe tocar el exterior (borde de la plantilla)
  const onEdge = door[0] === 0 || door[1] === 0 || door[0] === w - 1 || door[1] === d - 1;
  return onEdge ? null : 'la puerta no da al exterior';
}

export type Placed = { template: Template; x: number; y: number; key: string };

/** La estructura (o ninguna) de la región (rx,ry), en celdas del mundo. Probabilidad ~55 %. */
export function structureOfRegion(worldSeed: string, rx: number, ry: number): Placed | null {
  const s = seedOf(worldSeed, 'struct');
  if (hash2(s, rx, ry, 1) % 100 >= 55) return null;
  const t = TEMPLATES[hash2(s, rx, ry, 2) % TEMPLATES.length]!;
  const { w, d } = templateSize(t);
  const ox = hash2(s, rx, ry, 3) % (REGION - w + 1);
  const oy = hash2(s, rx, ry, 4) % (REGION - d + 1);
  return { template: t, x: rx * REGION + ox, y: ry * REGION + oy, key: `${rx},${ry}` };
}
