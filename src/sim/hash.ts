import { sha256 } from '@noble/hashes/sha2.js';
import type { HLC } from './hlc';

export const GENESIS_HASH = '0'.repeat(64);

export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  throw new Error(`cannot canonicalize type ${t}`);
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

export function chainHash(prevHash: string, roomId: string, payload: unknown, hlc: HLC, author: string): string {
  const s = `${prevHash}|${JSON.stringify(roomId)}|${canonical(payload)}|${hlc.t}:${hlc.c}|${author}`;
  return bytesToHex(sha256(new TextEncoder().encode(s)));
}