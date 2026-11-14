import { openDB } from './db';
import type { Chunk } from '../sim/chunks';

const CHUNK_STORE_NAME = 'world_chunks';

// Asegura que el almacén de chunks exista en IndexedDB
async function ensureChunkStore(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
    db.createObjectStore(CHUNK_STORE_NAME);
  }
}

export async function saveChunkToDB(chunk: Chunk): Promise<void> {
  const db = await openDB();
  // Nota: si actualizas la versión de DB en db.ts, asegúrate de contemplar este store.
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNK_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHUNK_STORE_NAME);
    const key = `${chunk.cx},${chunk.cz}`;
    const request = store.put(chunk, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadChunkFromDB(cx: number, cz: number): Promise<Chunk | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
      return resolve(undefined); // Si aún no existe el store, retorna vacío
    }
    const transaction = db.transaction(CHUNK_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHUNK_STORE_NAME);
    const key = `${cx},${cz}`;
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}