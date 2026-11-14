import {
  type Identity,
  type StoredIdentity,
  encryptSeed,
  decryptSeed,
  generateKeypair,
  toMnemonic,
  hexToBytes,
} from '../identity/keys';
import { loadIdentity, saveIdentity } from '../identity/storage';

export async function ensureIdentity(): Promise<Identity> {
  const stored = await loadIdentity();
  if (stored) return await promptUnlock(stored);
  return await promptCreate();
}

function promptCreate(): Promise<Identity> {
  return new Promise((resolve, reject) => {
    try {
      const overlay = document.createElement('div');
      overlay.className = 'login-overlay';
      overlay.innerHTML = `
        <div class="login-card">
          <h1>Crear identidad</h1>
          <input id="u" placeholder="usuario" autocomplete="username" />
          <input id="p" type="password" placeholder="contraseña (8+)" autocomplete="new-password" />
          <input id="p2" type="password" placeholder="repetir contraseña" autocomplete="new-password" />
          <button id="go">Crear</button>
          <p class="error" id="err"></p>
        </div>`;
      document.body.appendChild(overlay);

      const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
      const u = $<HTMLInputElement>('#u');
      const p = $<HTMLInputElement>('#p');
      const p2 = $<HTMLInputElement>('#p2');
      const btn = $<HTMLButtonElement>('#go');
      const err = $<HTMLParagraphElement>('#err');

      btn.onclick = async () => {
        const username = u.value.trim();
        if (!username) return void (err.textContent = 'Falta el nombre');
        if (p.value.length < 8) return void (err.textContent = 'Contraseña de 8+ caracteres');
        if (p.value !== p2.value) return void (err.textContent = 'Las contraseñas no coinciden');

        btn.disabled = true;
        btn.textContent = 'Creando…';
        try {
          const { privateKey } = generateKeypair();
          const stored = await encryptSeed(privateKey, p.value, username);
          await saveIdentity(stored);
          await showMnemonic(toMnemonic(privateKey));
          overlay.remove();
          resolve({
            username,
            privateKey,
            publicKey: hexToBytes(stored.publicKeyHex),
          });
        } catch (e) {
          err.textContent = 'Error: ' + (e as Error).message;
          btn.disabled = false;
          btn.textContent = 'Crear';
        }
      };
      u.focus();
    } catch (e) {
      reject(e);
    }
  });
}

function promptUnlock(stored: StoredIdentity): Promise<Identity> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <div class="login-card">
        <h1>Desbloquear</h1>
        <p class="hint">${stored.username} · ${stored.publicKeyHex.slice(0, 4)}…${stored.publicKeyHex.slice(-4)}</p>
        <input id="p" type="password" placeholder="contraseña" autocomplete="current-password" />
        <button id="go">Entrar</button>
        <p class="error" id="err"></p>
      </div>`;
    document.body.appendChild(overlay);

    const p = overlay.querySelector('#p') as HTMLInputElement;
    const btn = overlay.querySelector('#go') as HTMLButtonElement;
    const err = overlay.querySelector('#err') as HTMLParagraphElement;

    const tryUnlock = async () => {
      btn.disabled = true;
      btn.textContent = 'Descifrando…';
      try {
        const identity = await decryptSeed(stored, p.value);
        overlay.remove();
        resolve(identity);
      } catch {
        err.textContent = 'Contraseña incorrecta';
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    };
    btn.onclick = tryUnlock;
    p.onkeydown = (e) => { if (e.key === 'Enter') tryUnlock(); };
    p.focus();
  });
}

function showMnemonic(mnemonic: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <div class="login-card">
        <h1>Frase de recuperación</h1>
        <p class="hint">Guarda estas 24 palabras. Sin ellas, si pierdes la contraseña, pierdes tu identidad.</p>
        <div class="mnemonic" id="mn"></div>
        <button id="ok">Ya la guardé</button>
      </div>`;
    document.body.appendChild(overlay);
    (overlay.querySelector('#mn') as HTMLDivElement).textContent = mnemonic;
    (overlay.querySelector('#ok') as HTMLButtonElement).onclick = () => {
      overlay.remove();
      resolve();
    };
  });
}