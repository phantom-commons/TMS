import * as ed from '@noble/ed25519';
import { signEntry, type LogEntry, type LogEntryType } from './log';
import { GENESIS_HASH, bytesToHex, hexToBytes, chainHash } from './hash';

export type Actor = { sk: Uint8Array; id: string; roomId: string; last: LogEntry | null; t: number };

export function makeActor(roomId = 'r'): Actor {
  const sk = ed.utils.randomSecretKey();
  return { sk, id: bytesToHex(ed.getPublicKey(sk)), roomId, last: null, t: 0 };
}

export function emit(a: Actor, type: LogEntryType, payload: unknown): LogEntry {
  a.t += 1;
  const e = signEntry(
    {
      seq: a.last ? a.last.seq + 1 : 0,
      type,
      roomId: a.roomId,
      payload,
      author: a.id,
      hlc: { t: a.t, c: 0 },
      prevHash: a.last ? a.last.hash : GENESIS_HASH,
    },
    a.sk,
  );
  a.last = e;
  return e;
}
/** Test helper for the old v1 signing format, used to protect migration compatibility. */
export function emitLegacy(a: Actor, type: LogEntryType, payload: unknown): LogEntry {
  a.t += 1;
  const unsigned = {
    seq: a.last ? a.last.seq + 1 : 0,
    type,
    roomId: a.roomId,
    payload,
    author: a.id,
    hlc: { t: a.t, c: 0 },
    prevHash: a.last ? a.last.hash : GENESIS_HASH,
  };
  const hash = chainHash(unsigned.prevHash, unsigned.roomId, unsigned.payload, unsigned.hlc, unsigned.author);
  const sig = ed.sign(hexToBytes(hash), a.sk);
  const entry: LogEntry = { ...unsigned, hash, sig: bytesToHex(sig) };
  a.last = entry;
  return entry;
}
