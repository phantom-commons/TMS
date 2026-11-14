import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'sim';
// Version 7 repairs databases whose version was advanced without all stores.
const VERSION = 7;
const REQUIRED_STORES = ['identity', 'log', 'entries', 'room', 'pending'] as const;

type RequiredStore = (typeof REQUIRED_STORES)[number];

let dbPromise: Promise<IDBPDatabase> | null = null;

function missingStores(db: IDBPDatabase): RequiredStore[] {
  return REQUIRED_STORES.filter((name) => !db.objectStoreNames.contains(name));
}

async function openAtVersion(version: number): Promise<IDBPDatabase> {
  return openDB(DB_NAME, version, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // Create each store independently. Never delete existing identity/history data.
      if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
      if (!db.objectStoreNames.contains('log')) db.createObjectStore('log');
      if (!db.objectStoreNames.contains('room')) db.createObjectStore('room');
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending');

      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries');
        if (oldVersion >= 2 && db.objectStoreNames.contains('log')) {
          // Migrate the legacy entries array into one row per sequence.
          const old = (await tx.objectStore('log').get('entries')) as
            | Array<{ seq: number }>
            | undefined;
          if (old?.length) {
            await Promise.all(old.map((entry) => store.put(entry, entry.seq)));
          }
        }
      }
    },
    blocked() {
      console.warn(
        'La actualización de IndexedDB está bloqueada por otra pestaña de TMS. Cierra las demás pestañas y vuelve a cargar.',
      );
    },
  });
}

async function openAndRepair(): Promise<IDBPDatabase> {
  let db: IDBPDatabase;

  try {
    db = await openAtVersion(VERSION);
  } catch (error) {
    // If a newer schema already exists, upgrade from its current version.
    if (!(error instanceof DOMException) || error.name !== 'VersionError') throw error;
    const current = await openDB(DB_NAME);
    const nextVersion = current.version + 1;
    current.close();
    db = await openAtVersion(nextVersion);
  }

  // Detect and repair a partially migrated database even when its version is current.
  const missing = missingStores(db);
  if (missing.length) {
    const nextVersion = db.version + 1;
    db.close();
    db = await openAtVersion(nextVersion);
  }

  const stillMissing = missingStores(db);
  if (stillMissing.length) {
    db.close();
    throw new Error(
      `IndexedDB '${DB_NAME}' no pudo crear los almacenes: ${stillMissing.join(', ')}`,
    );
  }

  // Let this tab release its connection during future schema upgrades.
  db.onversionchange = () => {
    db.close();
    dbPromise = null;
  };

  return db;
}

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openAndRepair().catch((error: unknown) => {
      // Allow a later retry after a transient open/upgrade failure.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
