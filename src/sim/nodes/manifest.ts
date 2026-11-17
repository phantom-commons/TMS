import { hashCanonical } from '../hash';
import { nodeType, type NodeScope } from './catalog';
import { normalizeParams, validateParams, type ParamValues } from './params';

// Un manifiesto es el árbol de una room: mundo, jugador y objetos (prefabs), cada uno con nodos de parámetros.
// Es solo datos: se puede guardar, firmar y compartir; no puede traer comportamiento propio.

export type NodeSpec = { type: string; params: ParamValues };

export type Manifest = {
  v: 1;
  id: string;
  name: string;
  world: NodeSpec[];
  player: NodeSpec[];
  prefabs: Record<string, NodeSpec[]>;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** nodos de un tipo concreto dentro de una lista (para leer la configuración) */
export const nodesOf = (list: NodeSpec[], type: string): NodeSpec[] => list.filter((n) => n.type === type);

function structureError(m: unknown): string | null {
  if (!isObj(m)) return 'el manifiesto no es un objeto';
  if (m.v !== 1) return 'versión de manifiesto no soportada';
  if (typeof m.id !== 'string' || m.id === '') return 'falta el id';
  if (typeof m.name !== 'string') return 'falta el nombre';
  if (!Array.isArray(m.world) || !Array.isArray(m.player)) return 'faltan las listas world/player';
  if (!isObj(m.prefabs)) return 'faltan los prefabs';
  return null;
}

function listError(list: unknown[], scope: NodeScope, where: string): string | null {
  const seen = new Set<string>();
  for (const node of list) {
    if (!isObj(node) || typeof node.type !== 'string' || !isObj(node.params)) return `${where}: nodo mal formado`;
    const t = nodeType(node.type);
    if (!t) return `${where}: tipo de nodo desconocido «${node.type}»`;
    if (t.scope !== scope) return `${where}: «${t.label}» no puede ir aquí (es de ${t.scope})`;
    if (!t.multiple) {
      if (seen.has(t.id)) return `${where}: «${t.label}» solo puede aparecer una vez`;
      seen.add(t.id);
    }
    const err = validateParams(t.schema, node.params as ParamValues);
    if (err) return `${where}/${t.label}: ${err}`;
  }
  return null;
}

/** Devuelve el primer problema del manifiesto, o null si es válido. */
export function validateManifest(m: unknown): string | null {
  const bad = structureError(m);
  if (bad) return bad;
  const man = m as Manifest;
  const checks: Array<string | null> = [
    listError(man.world, 'world', 'mundo'),
    listError(man.player, 'player', 'jugador'),
    ...Object.entries(man.prefabs).map(([id, list]) => (Array.isArray(list) ? listError(list, 'prefab', `objeto «${id}»`) : `objeto «${id}»: no es una lista`)),
  ];
  const first = checks.find((c) => c !== null);
  if (first) return first;

  if (nodesOf(man.world, 'world').length !== 1) return 'mundo: falta el nodo «Mundo»';
  if (nodesOf(man.player, 'playerBody').length !== 1) return 'jugador: falta el nodo «Cuerpo»';

  for (const s of nodesOf(man.world, 'spawn')) {
    if (!(s.params.prefab as string in man.prefabs)) return `aparición: el objeto «${String(s.params.prefab)}» no existe`;
  }
  const timing = nodesOf(man.world, 'spawnTiming')[0];
  if (timing && (timing.params.gapMinMs as number) > (timing.params.gapMaxMs as number)) return 'ritmo: el hueco mínimo supera al máximo';
  for (const [id, list] of Object.entries(man.prefabs)) {
    const b = nodesOf(list, 'body')[0];
    if (!b) return `objeto «${id}»: falta el nodo «Cuerpo»`;
    if ((b.params.widthMin as number) > (b.params.widthMax as number) || (b.params.heightMin as number) > (b.params.heightMax as number)) {
      return `objeto «${id}»: el mínimo supera al máximo`;
    }
  }
  return null;
}

/**
 * Para manifiestos que vienen de fuera (guardados en el dispositivo, sliders): acota cada parámetro a su rango y
 * arregla mínimos/máximos cruzados. Si la estructura es inservible, devuelve el de respaldo. Nunca lanza.
 */
export function normalizeManifest(raw: unknown, fallback: Manifest): Manifest {
  if (structureError(raw)) return fallback;
  const src = raw as Manifest;
  const fix = (list: unknown[], scope: NodeScope): NodeSpec[] | null => {
    const out: NodeSpec[] = [];
    for (const node of list) {
      if (!isObj(node) || typeof node.type !== 'string') return null;
      const t = nodeType(node.type);
      if (!t || t.scope !== scope) return null;
      out.push({ type: t.id, params: normalizeParams(t.schema, isObj(node.params) ? node.params : {}) });
    }
    return out;
  };
  const world = fix(src.world, 'world');
  const player = fix(src.player, 'player');
  if (!world || !player) return fallback;
  const prefabs: Record<string, NodeSpec[]> = {};
  for (const [id, list] of Object.entries(src.prefabs)) {
    const fixed = Array.isArray(list) ? fix(list, 'prefab') : null;
    if (!fixed) return fallback;
    prefabs[id] = fixed;
  }
  const out: Manifest = { v: 1, id: src.id, name: src.name, world, player, prefabs };
  // mínimos y máximos cruzados: el máximo nunca baja del mínimo
  for (const t of nodesOf(out.world, 'spawnTiming')) t.params.gapMaxMs = Math.max(t.params.gapMaxMs as number, t.params.gapMinMs as number);
  for (const list of Object.values(out.prefabs)) {
    for (const b of nodesOf(list, 'body')) {
      b.params.widthMax = Math.max(b.params.widthMax as number, b.params.widthMin as number);
      b.params.heightMax = Math.max(b.params.heightMax as number, b.params.heightMin as number);
    }
  }
  return validateManifest(out) ? fallback : out;
}

/**
 * Huella del manifiesto: hash del árbol más la versión de cada tipo de nodo que usa. Dos clientes que obtienen la
 * misma huella ejecutan exactamente las mismas reglas; si un tipo cambia de comportamiento (sube de versión), cambia.
 */
export function manifestFingerprint(m: Manifest): string {
  const types = new Set<string>();
  for (const list of [m.world, m.player, ...Object.values(m.prefabs)]) for (const n of list) types.add(n.type);
  const versions = Object.fromEntries([...types].sort().map((id) => [id, nodeType(id)?.version ?? 0]));
  return hashCanonical({ manifest: m, versions });
}
