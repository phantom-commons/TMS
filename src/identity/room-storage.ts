import type { RelayEntry } from '../sim/room';
import { getDB } from './db';

const STORE = 'room';
const key = (roomId: string, rseq: number) => `${roomId}:${String(rseq).padStart(12, '0')}`;
const range = (roomId: string) => IDBKeyRange.bound(`${roomId}:`, `${roomId}:\uffff`);

export async function loadRoom(roomId: string): Promise<RelayEntry[]> {
  const db = await getDB();
  return (await db.getAll(STORE, range(roomId))) as RelayEntry[];
}

export async function saveRoomItems(roomId: string, items: RelayEntry[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i, key(roomId, i.rseq))), tx.done]);
}

export async function clearRoom(roomId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, range(roomId));
}