import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { argon2id } from 'hash-wasm';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// noble-ed25519 v2 requiere sha512 sync inyectado
ed.hashes.sha512 = sha512;

export type Identity = {
  username: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type StoredIdentity = {
  username: string;
  publicKeyHex: string;
  createdAt: number;
  iv: Uint8Array;
  encryptedSeed: Uint8Array;
  salt?: Uint8Array;        // identidad protegida con contraseña
  deviceKey?: CryptoKey;    // sesión recordada en este dispositivo
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
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, privateKey),
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
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  const privateKey = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: stored.iv },
      cryptoKey,
      stored.encryptedSeed,
    ),
  );

  const publicKey = ed.getPublicKey(privateKey);
  return { username: stored.username, privateKey, publicKey };
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
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, privateKey),
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
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv }, stored.deviceKey, stored.encryptedSeed),
  );
  return { username: stored.username, privateKey, publicKey: ed.getPublicKey(privateKey) };
}