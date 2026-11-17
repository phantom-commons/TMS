import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { argon2id } from 'hash-wasm';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// noble-ed25519 v2 requiere sha512 sync inyectado
ed.hashes.sha512 = sha512;

// Web Crypto expects an ArrayBuffer-backed BufferSource. Copying also avoids
// passing a possible SharedArrayBuffer through newer typed-array typings.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type Identity = {
  username: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** false = invitado: la clave solo existe en este navegador y nadie ha guardado las 24 palabras */
  saved?: boolean;
};

export type StoredIdentity = {
  username: string;
  publicKeyHex: string;
  createdAt: number;
  iv: Uint8Array;
  encryptedSeed: Uint8Array;
  salt?: Uint8Array;        // identidad protegida con contraseña
  deviceKey?: CryptoKey;    // sesión recordada en este dispositivo
  saved?: boolean;          // false = invitado; ausente = identidad anterior a las cuentas de invitado (cuenta guardada)
};

const ARGON2 = {
  iterations: 3,
  memorySize: 64 * 1024, // 64 MB
  parallelism: 1,
  hashLength: 32,
} as const;

export function generateKeypair() {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = ed.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return await argon2id({
    password,
    salt,
    ...ARGON2,
    outputType: 'binary',
  });
}

export async function encryptSeed(
  privateKey: Uint8Array,
  password: string,
  username: string,
): Promise<StoredIdentity> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await deriveKey(password, salt);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      cryptoKey,
      toArrayBuffer(privateKey),
    ),
  );
  const publicKey = ed.getPublicKey(privateKey);
  return {
    username,
    publicKeyHex: bytesToHex(publicKey),
    salt,
    iv,
    encryptedSeed: ciphertext,
    createdAt: Date.now(),
  };
}

export async function decryptSeed(
  stored: StoredIdentity,
  password: string,
): Promise<Identity> {
  const salt = stored.salt;
  if (!salt) throw new Error('identidad sin contraseña');
  const keyBytes = await deriveKey(password, salt);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const privateKey = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(stored.iv) },
      cryptoKey,
      toArrayBuffer(stored.encryptedSeed),
    ),
  );
  const publicKey = ed.getPublicKey(privateKey);
  return { username: stored.username, privateKey, publicKey, saved: stored.saved ?? true };
}

export function toMnemonic(privateKey: Uint8Array): string {
  return entropyToMnemonic(privateKey, wordlist);
}

export function fromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function shortPubkey(pubkey: Uint8Array): string {
  const hex = bytesToHex(pubkey);
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
export async function sealWithDeviceKey(privateKey: Uint8Array, username: string): Promise<StoredIdentity> {
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedSeed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      deviceKey,
      toArrayBuffer(privateKey),
    ),
  );
  return {
    username,
    publicKeyHex: bytesToHex(ed.getPublicKey(privateKey)),
    createdAt: Date.now(),
    iv,
    encryptedSeed,
    deviceKey,
  };
}

export async function openWithDeviceKey(stored: StoredIdentity): Promise<Identity> {
  if (!stored.deviceKey) throw new Error('sin clave de dispositivo');
  const privateKey = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(stored.iv) },
      stored.deviceKey,
      toArrayBuffer(stored.encryptedSeed),
    ),
  );
  return { username: stored.username, privateKey, publicKey: ed.getPublicKey(privateKey), saved: stored.saved ?? true };
}