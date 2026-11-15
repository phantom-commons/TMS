// Almacén clave-valor pequeño para el estado de las experiencias (récords, layout de tu room…).
// Va por identidad (namespace = tu clave pública) y nunca lanza: sin almacenamiento cae a memoria.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type KV = {
  get: <T>(key: string, fallback: T) => T;
  set: (key: string, value: unknown) => void;
  remove: (key: string) => void;
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createKV(namespace: string, storage: StorageLike | null = defaultStorage()): KV {
  const memory = new Map<string, string>();
  const full = (key: string) => `tms.x.${namespace}.${key}`;

  const read = (key: string): string | null => {
    try {
      const v = storage?.getItem(full(key));
      if (v !== null && v !== undefined) return v;
    } catch {
      /* almacenamiento bloqueado: se usa la memoria */
    }
    return memory.get(key) ?? null;
  };

  return {
    get<T>(key: string, fallback: T): T {
      const raw = read(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      memory.set(key, raw);
      try {
        storage?.setItem(full(key), raw);
      } catch {
        /* cuota llena o bloqueado: queda en memoria */
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        storage?.removeItem(full(key));
      } catch {
        /* ignorar */
      }
    },
  };
}
