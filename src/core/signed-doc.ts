import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hashCanonical, hexToBytes } from '../sim/hash';

ed.hashes.sha512 = sha512;

/**
 * Documento firmado por una identidad TMS (Ed25519 sobre el hash canónico).
 * Sirve para estado que no es un evento del log (p. ej. el layout de Tu Room): si alguien lo edita a mano
 * en el almacenamiento del navegador, la firma deja de cuadrar y el cliente lo descarta.
 */
export type SignedDoc<T> = { doc: T; signer: string; sig: string };

const digest = (domain: string, doc: unknown) => hashCanonical({ domain, doc });

/** Pasa por JSON para que el hash firmado sea el de lo que se guardará (sin `undefined`). */
const plain = <T>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;

export function signDoc<T>(domain: string, doc: T, privateKey: Uint8Array): SignedDoc<T> {
  const clean = plain(doc);
  const sig = ed.sign(hexToBytes(digest(domain, clean)), privateKey);
  return { doc: clean, signer: bytesToHex(ed.getPublicKey(privateKey)), sig: bytesToHex(sig) };
}

export function verifyDoc<T>(domain: string, signed: SignedDoc<T>, expectedSigner?: string): boolean {
  try {
    if (expectedSigner && signed.signer.toLowerCase() !== expectedSigner.toLowerCase()) return false;
    return ed.verify(hexToBytes(signed.sig), hexToBytes(digest(domain, signed.doc)), hexToBytes(signed.signer));
  } catch {
    return false;
  }
}
