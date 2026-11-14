import type { LogEntry } from '../sim/log';
import type { RelayEntry } from '../sim/room';
import { getDB } from './db';

const ROOM_STORE = 'room';
const PENDING_STORE = 'pending';
const roomKey = (roomId: string, rseq: number) => `${roomId}:${String(rseq).padStart(12, '0')}`;
const roomRange = (roomId: string) => IDBKeyRange.bound(`${roomId}:`, `${roomId}:\uffff`);
const pendingKey = (roomId: string, author: string, seq: number) =>
  `${roomId}:${author}:${String(seq).padStart(12, '0')}`;
const pendingRange = (roomId: string) => IDBKeyRange.bound(`${roomId}:`, `${roomId}:\uffff`);

/** Confirmed relay entries are a cache; the signed event remains the source of truth. */
export async function loadRoom(roomId: string): Promise<RelayEntry[]> {
  const db = await getDB();
  return (await db.getAll(ROOM_STORE, roomRange(roomId))) as RelayEntry[];
}

export async function saveRoomItems(roomId: string, items: RelayEntry[]): Promise<void> {
  if (!items.length) return;
  const db = await getDB();
  const tx = db.transaction(ROOM_STORE, 'readwrite');
  await Promise.all([
    ...items.map((item) => tx.store.put(item, roomKey(roomId, item.rseq))),
    tx.done,
  ]);
}

export async function clearRoom(roomId: string): Promise<void> {
  const db = await getDB();
  await db.delete(ROOM_STORE, roomRange(roomId));
}

/** Offline events stay local until a relay explicitly accepts them. */
export async function loadPendingRoom(roomId: string): Promise<LogEntry[]> {
  const db = await getDB();
  const entries = (await db.getAll(PENDING_STORE, pendingRange(roomId))) as LogEntry[];
  return entries.sort((a, b) => a.author.localeCompare(b.author) || a.seq - b.seq);
}

export async function savePendingEntry(roomId: string, entry: LogEntry): Promise<void> {
  const db = await getDB();
  await db.put(PENDING_STORE, entry, pendingKey(roomId, entry.author, entry.seq));
}

export async function deletePendingEntry(roomId: string, entry: Pick<LogEntry, 'author' | 'seq'>): Promise<void> {
  const db = await getDB();
  await db.delete(PENDING_STORE, pendingKey(roomId, entry.author, entry.seq));
}

export async function deletePendingEntries(roomId: string, entries: LogEntry[]): Promise<void> {
  if (!entries.length) return;
  const db = await getDB();
  const tx = db.transaction(PENDING_STORE, 'readwrite');
  await Promise.all([
    ...entries.map((entry) => tx.store.delete(pendingKey(roomId, entry.author, entry.seq))),
    tx.done,
  ]);
}
