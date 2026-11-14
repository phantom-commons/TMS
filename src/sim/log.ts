import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import type { HLC } from './hlc';
import { GENESIS_HASH, chainHash, hashCanonical, bytesToHex, hexToBytes } from './hash';

ed.hashes.sha512 = sha512;

export type LogEntryType =
  | 'INIT'
  | 'ENTER'
  | 'MOVE'
  | 'PLACE'
  | 'PICK_UP'
  | 'DROP'
  | 'PUSH'
  | 'LOCK'
  | 'UNLOCK'
  | 'INTERACT'
  | 'ATTACK'
  | 'DOOR'
  | 'NOTE';

/**
 * version omitted means legacy v1. New entries are always signed as v2.
 * v2 covers every field that affects interpretation, including seq and type.
 */
export type LogEntry = {
  version?: 2;
  seq: number;
  type: LogEntryType;
  roomId: string;
  payload: unknown;
  author: string;
  hlc: HLC;
  prevHash: string;
  hash: string;
  sig: string;
};

export type UnsealedEntry = Omit<LogEntry, 'hash' | 'sig'>;

export function computeHash(e: UnsealedEntry): string {
  if (e.version === 2) {
    return hashCanonical({
      domain: 'TMS_EVENT',
      version: 2,
      seq: e.seq,
      type: e.type,
      roomId: e.roomId,
      payload: e.payload,
      author: e.author,
      hlc: e.hlc,
      prevHash: e.prevHash,
    });
  }
  // Compatibility path for entries created before the v2 format.
  return chainHash(e.prevHash, e.roomId, e.payload, e.hlc, e.author);
}

export function signEntry(e: UnsealedEntry, privateKey: Uint8Array): LogEntry {
  const versioned: UnsealedEntry = { ...e, version: 2 };
  const hash = computeHash(versioned);
  const sig = ed.sign(hexToBytes(hash), privateKey);
  return { ...versioned, hash, sig: bytesToHex(sig) };
}

export function verifyEntry(e: LogEntry): boolean {
  try {
    if (e.version !== undefined && e.version !== 2) return false;
    if (!Number.isInteger(e.seq) || e.seq < 0) return false;
    if (typeof e.roomId !== 'string' || !e.roomId) return false;
    if (!/^[0-9a-f]{64}$/i.test(e.hash)) return false;
    if (!/^[0-9a-f]{64}$/i.test(e.author)) return false;
    if (!/^[0-9a-f]{64}$/i.test(e.prevHash)) return false;
    if (!/^[0-9a-f]{128}$/i.test(e.sig)) return false;
    if (!Number.isFinite(e.hlc.t) || !Number.isInteger(e.hlc.c) || e.hlc.c < 0) return false;
    if (computeHash(e) !== e.hash) return false;
    return ed.verify(hexToBytes(e.sig), hexToBytes(e.hash), hexToBytes(e.author));
  } catch {
    return false;
  }
}

/** Verifies one author's sequential chain (not a merged multi-author room log). */
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
