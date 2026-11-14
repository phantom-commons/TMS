import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import type { HLC } from './hlc';
import { GENESIS_HASH, chainHash, bytesToHex, hexToBytes } from './hash';

ed.hashes.sha512 = sha512;

export type LogEntryType = 'INIT' | 'MOVE' | 'PLACE' | 'DOOR' | 'NOTE';

export type LogEntry = {
  seq: number;
  type: LogEntryType;
  payload: unknown;
  author: string;
  hlc: HLC;
  prevHash: string;
  hash: string;
  sig: string;
};

export type UnsealedEntry = Omit<LogEntry, 'hash' | 'sig'>;

export function computeHash(e: UnsealedEntry): string {
  return chainHash(e.prevHash, e.payload, e.hlc, e.author);
}

export function signEntry(e: UnsealedEntry, privateKey: Uint8Array): LogEntry {
  const hash = computeHash(e);
  const sig = ed.sign(hexToBytes(hash), privateKey);
  return { ...e, hash, sig: bytesToHex(sig) };
}

export function verifyEntry(e: LogEntry): boolean {
  if (computeHash(e) !== e.hash) return false;
  try {
    return ed.verify(hexToBytes(e.sig), hexToBytes(e.hash), hexToBytes(e.author));
  } catch {
    return false;
  }
}

export function verifyChain(
  entries: LogEntry[],
  expectedAuthor?: string,
): { ok: boolean; reason?: string } {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, reason: `seq mismatch at ${i}: got ${e.seq}` };
    if (e.prevHash !== prev) return { ok: false, reason: `prevHash mismatch at seq ${e.seq}` };
    if (!verifyEntry(e)) return { ok: false, reason: `bad hash or sig at seq ${e.seq}` };
    if (expectedAuthor && e.author !== expectedAuthor) {
      return { ok: false, reason: `unexpected author at seq ${e.seq}` };
    }
    prev = e.hash;
  }
  return { ok: true };
}