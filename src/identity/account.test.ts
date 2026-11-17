import { describe, expect, it } from 'vitest';
import { checkWords, guestName, normalizeHandle, parsePhrase, pickCheckIndices, saveAccount, validateHandle, validatePassword } from './account';
import { generateKeypair, toMnemonic } from './keys';

describe('@usuario y contraseña', () => {
  it('normaliza y valida el @usuario', () => {
    expect(normalizeHandle('  @@Ana_01 ')).toBe('ana_01');
    expect(validateHandle('@Ana_01')).toBeNull();
    for (const bad of ['', 'ab', 'a b c', 'ñandú', 'x'.repeat(21), '@']) expect(validateHandle(bad), bad).not.toBeNull();
  });
  it('contraseña de 8+', () => {
    expect(validatePassword('1234567')).not.toBeNull();
    expect(validatePassword('12345678')).toBeNull();
  });
  it('nombre de invitado derivado de la clave pública', () => {
    expect(guestName('ab12cd34')).toBe('Invitado-ab12');
  });
});

describe('confirmar la frase', () => {
  it('elige índices distintos, ordenados y en rango', () => {
    for (let i = 0; i < 50; i++) {
      const idx = pickCheckIndices();
      expect(new Set(idx).size).toBe(3);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      expect(idx.every((n) => n >= 0 && n < 24)).toBe(true);
    }
  });
  it('comprueba las palabras escritas', () => {
    const m = toMnemonic(generateKeypair().privateKey);
    const w = m.split(' ');
    expect(checkWords(m, [0, 5, 23], [w[0], ` ${w[5].toUpperCase()} `, w[23]])).toBe(true);
    expect(checkWords(m, [0, 5, 23], [w[0], w[5], w[22]])).toBe(false);
    expect(checkWords(m, [0, 5], [w[0]])).toBe(false);
  });
});

describe('frase y cuenta', () => {
  it('parsePhrase recupera la misma clave y rechaza basura', () => {
    const k = generateKeypair().privateKey;
    expect(parsePhrase(`  ${toMnemonic(k).toUpperCase().replace(/ /g, '\n')} `)).toEqual(k);
    expect(() => parsePhrase('hola mundo')).toThrow();
  });
  it('saveAccount rechaza datos inválidos antes de tocar nada', async () => {
    const k = generateKeypair().privateKey;
    await expect(saveAccount(k, 'a', 'password1')).rejects.toThrow(/usuario/);
    await expect(saveAccount(k, 'ana', 'corta')).rejects.toThrow(/Contraseña/);
  });
});
