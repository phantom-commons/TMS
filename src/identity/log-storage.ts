import type { LogEntry } from '../sim/log';
import { getDB } from './db';

const STORE = 'log';
const KEY = 'entries';

export async function loadLog(): Promise<LogEntry[]> {
  const db = await getDB();
  return (await db.get(STORE, KEY)) ?? [];
}

export async function saveLog(entries: LogEntry[]): Promise<void> {
  const db = await getDB();
  await db.put(STORE, entries, KEY);
}