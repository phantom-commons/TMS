import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'sim';
const VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
        if (!db.objectStoreNames.contains('log')) db.createObjectStore('log');
      },
    });
  }
  return dbPromise;
}