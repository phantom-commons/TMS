import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'sim';
const VERSION = 7;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
        if (!db.objectStoreNames.contains('log')) db.createObjectStore('log');

        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries');
          if (oldVersion >= 2) {
            // migración: el array antiguo → una fila por entrada, clave = seq
            const old = (await tx.objectStore('log').get('entries')) as
              | Array<{ seq: number }>
              | undefined;
            if (old) await Promise.all(old.map((e) => store.put(e, e.seq)));
          }
        }

        // v5: caché de salas confirmadas por el relay + acciones propias aún sin confirmar (modo offline)
        if (!db.objectStoreNames.contains('room')) db.createObjectStore('room');
        if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending');
      },
    });
  }
  return dbPromise;
}
