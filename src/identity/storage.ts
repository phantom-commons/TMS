import type { StoredIdentity } from './keys';
import { getDB } from './db';

const STORE = 'identity';
const KEY = 'current';

export async function loadIdentity(): Promise<StoredIdentity | null> {
  const db = await getDB();
  return (await db.get(STORE, KEY)) ?? null;
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  const db = await getDB();
  await db.put(STORE, identity, KEY);
}

export async function clearIdentity(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, KEY);
}