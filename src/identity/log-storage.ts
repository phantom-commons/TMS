import type { LogEntry } from '../sim/log';
import { getDB } from './db';

const STORE = 'entries';

// getAll devuelve ordenado por clave (seq)
export async function loadLog(): Promise<LogEntry[]> {
  const db = await getDB();
  return (await db.getAll(STORE)) as LogEntry[];
}

export async function appendEntry(entry: LogEntry): Promise<void> {
  const db = await getDB();
  await db.put(STORE, entry, entry.seq);
}

export async function clearLog(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
}