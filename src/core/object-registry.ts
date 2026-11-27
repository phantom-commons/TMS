import type { KV } from './kv';
import { compileObject, isObjectKind, objectId, toV2, validateObject, type AnyObject, type CompiledObject, type ObjectKind, type VoxelObject } from './objects';

// Registro de objetos conocidos por este cliente: los tuyos (biblioteca en kv) y, más adelante, los que recibas.
// Es una caché por id de contenido: registrar dos veces lo mismo es inofensivo. Los objetos del formato anterior
// (v1) siguen registrándose con su id de siempre y se leen como v2.

const known = new Map<ObjectKind, { obj: VoxelObject; compiled: CompiledObject }>();

export function registerObject(o: AnyObject): ObjectKind {
  const err = validateObject(o);
  if (err) throw new Error(err);
  const id = objectId(o);
  if (!known.has(id)) {
    const obj = toV2(o);
    known.set(id, { obj, compiled: compileObject(obj) });
  }
  return id;
}

export const knownObject = (kind: string): { obj: VoxelObject; compiled: CompiledObject } | undefined =>
  isObjectKind(kind) ? known.get(kind) : undefined;

export const knownKinds = (): ObjectKind[] => [...known.keys()];

const LIB_KEY = 'objects.library';
export type LibraryEntry = { id: ObjectKind; obj: VoxelObject };

/** Carga y registra tu biblioteca; los objetos que no pasen la validación se ignoran. */
export function loadLibrary(kv: KV): LibraryEntry[] {
  const raw = kv.get<AnyObject[]>(LIB_KEY, []);
  const out: LibraryEntry[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    try {
      const id = registerObject(o);
      out.push({ id, obj: toV2(o) });
    } catch {
      /* objeto dañado: se omite */
    }
  }
  return out;
}

/** Guarda un objeto en tu biblioteca (si ya está, no cambia nada) y devuelve su id. */
export function saveToLibrary(kv: KV, o: VoxelObject): ObjectKind {
  const id = registerObject(o);
  const raw = kv.get<AnyObject[]>(LIB_KEY, []);
  const list = Array.isArray(raw) ? raw : [];
  if (!list.some((x) => { try { return objectId(x) === id; } catch { return false; } })) kv.set(LIB_KEY, [...list, o]);
  return id;
}

/** Lo que la sim de la casa necesita de cada objeto, leído de este registro. */
export const registryDefs = {
  info: (kind: string): { sx: number; sy: number; sz: number; solid: boolean } | null => {
    const k = knownObject(kind);
    return k ? { sx: k.obj.sx, sy: k.obj.sy, sz: k.obj.sz, solid: k.obj.solid } : null;
  },
};
