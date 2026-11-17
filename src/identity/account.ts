import { decryptSeed, encryptSeed, fromMnemonic, generateKeypair, hexToBytes, sealWithDeviceKey, toMnemonic, type Identity } from './keys';
import { saveIdentity } from './storage';

// Cuenta de invitado → cuenta guardada.
//   Al abrir: se crea una clave en silencio (invitado) y se recuerda en este dispositivo.
//   "Guardar cuenta": enseña las 24 palabras, pide un @usuario y una contraseña que cifran la clave en este navegador.
// La identidad siempre es la clave; el @usuario es una etiqueta local por ahora (único solo cuando un relay lo reserve).

export const guestName = (publicKeyHex: string): string => `Invitado-${publicKeyHex.slice(0, 4)}`;

export const normalizeHandle = (raw: string): string => raw.trim().replace(/^@+/, '').toLowerCase();

/** Mensaje de error, o null si el @usuario es válido. */
export function validateHandle(raw: string): string | null {
  const h = normalizeHandle(raw);
  if (!/^[a-z0-9_]{3,20}$/.test(h)) return 'El @usuario: 3 a 20 letras, números o _';
  return null;
}

export const validatePassword = (p: string): string | null => (p.length >= 8 ? null : 'Contraseña de 8+ caracteres');

/** Índices (0-based, ordenados) de las palabras que hay que reescribir para confirmar que se guardó la frase. */
export function pickCheckIndices(count = 3, total = 24, rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): number[] {
  const set = new Set<number>();
  while (set.size < count) set.add(Math.floor(rand() * total));
  return [...set].sort((a, b) => a - b);
}

export function checkWords(mnemonic: string, indices: readonly number[], answers: readonly string[]): boolean {
  const words = mnemonic.split(' ');
  return indices.length === answers.length && indices.every((i, k) => answers[k].trim().toLowerCase() === words[i]);
}

/** Frase pegada por el usuario → clave privada (lanza si no es válida). */
export function parsePhrase(raw: string): Uint8Array {
  const phrase = raw.trim().toLowerCase().split(/\s+/).join(' ');
  let key: Uint8Array;
  try {
    key = fromMnemonic(phrase);
  } catch {
    throw new Error('Frase inválida: revisa las palabras y el orden');
  }
  if (key.length !== 32) throw new Error('Se necesitan exactamente 24 palabras');
  return key;
}

/** Primera apertura: identidad de invitado, recordada en este dispositivo y sin pedir nada. */
export async function createGuest(): Promise<Identity> {
  const { privateKey } = generateKeypair();
  const stored = await sealWithDeviceKey(privateKey, 'Invitado');
  stored.username = guestName(stored.publicKeyHex);
  stored.saved = false;
  await saveIdentity(stored);
  return { username: stored.username, privateKey, publicKey: hexToBytes(stored.publicKeyHex), saved: false };
}

/** Guarda la cuenta: la clave pasa a cifrarse con la contraseña y el invitado se convierte en @usuario. */
export async function saveAccount(privateKey: Uint8Array, rawHandle: string, password: string): Promise<Identity> {
  const err = validateHandle(rawHandle) ?? validatePassword(password);
  if (err) throw new Error(err);
  const stored = await encryptSeed(privateKey, password, `@${normalizeHandle(rawHandle)}`);
  stored.saved = true;
  await saveIdentity(stored);
  return decryptSeed(stored, password);
}

export { toMnemonic };
