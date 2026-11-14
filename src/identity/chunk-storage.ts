import { getDB } from './db';
import type { Chunk } from '../sim/chunks';

const CHUNK_STORE_NAME = 'world_chunks';

export async function saveChunkToDB(chunk: Chunk): Promise<void> {
  const db = await getDB();
  await db.put(CHUNK_STORE_NAME, chunk, `${chunk.cx},${chunk.cz}`);
}

export async function loadChunkFromDB(cx: number, cz: number): Promise<Chunk | undefined> {
  const db = await getDB();
  return (await db.get(CHUNK_STORE_NAME, `${cx},${cz}`)) as Chunk | undefined;
}