import type { LogEntry } from '../sim/log';
import type { RelayEntry } from '../sim/room';
import { getDB } from './db';

// Dos almacenes por sala:
//  · 'room'    → lo que el relay ya confirmó (caché; se puede borrar sin perder tu identidad)
//  · 'pending' → lo que firmaste y aún no confirmó ningún relay (así funciona offline y sobrevive a recargar)

const key = (roomId: string, rseq: number) => `${roomId}:${String(rseq).padStart(12, '0')}`;
const range = (roomId: string) => IDBKeyRange.bound(`${roomId}:`, `${roomId}:￿`);

export async function loadRoom(roomId: string): Promise<RelayEntry[]> {
  const db = await getDB();
  return (await db.getAll('room', range(roomId))) as RelayEntry[];
}

export async function saveRoomItems(roomId: string, items: readonly RelayEntry[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('room', 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i, key(roomId, i.rseq))), tx.done]);
}

export async function clearRoom(roomId: string): Promise<void> {
  const db = await getDB();
  await db.delete('room', range(roomId));
  await db.delete('pending', roomId);
}

export async function loadPending(roomId: string): Promise<LogEntry[]> {
  const db = await getDB();
  return ((await db.get('pending', roomId)) as LogEntry[] | undefined) ?? [];
}

export async function savePending(roomId: string, entries: readonly LogEntry[]): Promise<void> {
  const db = await getDB();
  if (entries.length === 0) await db.delete('pending', roomId);
  else await db.put('pending', [...entries], roomId);
}
