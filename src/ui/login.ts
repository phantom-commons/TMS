import {
  type Identity,
  type StoredIdentity,
  encryptSeed,
  decryptSeed,
  sealWithDeviceKey,
  openWithDeviceKey,
  generateKeypair,
  toMnemonic,
  fromMnemonic,
  hexToBytes,
} from '../identity/keys';
import { loadIdentity, saveIdentity, clearIdentity } from '../identity/storage';

export async function ensureIdentity(): Promise<Identity> {
  const stored = await loadIdentity();
  if (stored?.deviceKey) {
    try {
      return await openWithDeviceKey(stored);
    } catch {
      /* la clave del dispositivo ya no sirve: cae al login */
    }
  }
  if (stored?.salt) return await promptUnlock(stored);
  return await promptSetup();
}

function promptSetup(): Promise<Identity> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <div class="login-card">
        <div class="tabs">
          <button class="tab" data-m="create">Crear</button>
          <button class="tab" data-m="import">Tengo 24 palabras</button>
        </div>
        <p class="hint" id="hint"></p>
        <textarea id="words" rows="4" placeholder="las 24 palabras, separadas por espacios" hidden></textarea>
        <input id="u" placeholder="nombre (solo local)" autocomplete="username" />
        <label class="check"><input type="checkbox" id="remember" checked /> Mantener sesión en este dispositivo</label>
        <div id="pwbox" hidden>
          <input id="p" type="password" placeholder="contraseña (8+)" autocomplete="new-password" />
          <input id="p2" type="password" placeholder="repetir contraseña" autocomplete="new-password" />
        </div>
        <button id="go"></button>
        <p class="error" id="err"></p>
      </div>`;
    document.body.appendChild(overlay);

    const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
    const tabs = overlay.querySelectorAll<HTMLButtonElement>('.tab');
    const hint = $<HTMLParagraphElement>('#hint');
    const words = $<HTMLTextAreaElement>('#words');
    const u = $<HTMLInputElement>('#u');
    const rem = $<HTMLInputElement>('#remember');
    const pwbox = $<HTMLDivElement>('#pwbox');
    const p = $<HTMLInputElement>('#p');
    const p2 = $<HTMLInputElement>('#p2');
    const btn = $<HTMLButtonElement>('#go');
    const err = $<HTMLParagraphElement>('#err');

    let mode: 'create' | 'import' = 'create';
    const setMode = (m: 'create' | 'import') => {
      mode = m;
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.m === m));
      words.hidden = m !== 'import';
      hint.textContent =
        m === 'create'
          ? 'Tu identidad son las 24 palabras que verás a continuación. El nombre y la contraseña solo protegen este navegador: en otro necesitarás las palabras.'
          : 'Pega tus 24 palabras para recuperar la misma identidad.';
      btn.textContent = m === 'create' ? 'Crear' : 'Importar';
      err.textContent = '';
    };
    tabs.forEach((t) => (t.onclick = () => setMode(t.dataset.m as 'create' | 'import')));
    rem.onchange = () => (pwbox.hidden = rem.checked);
    setMode('create');

    btn.onclick = async () => {
      const username = u.value.trim();
      if (!username) return void (err.textContent = 'Falta el nombre');
      const remember = rem.checked;
      if (!remember) {
        if (p.value.length < 8) return void (err.textContent = 'Contraseña de 8+ caracteres');
        if (p.value !== p2.value) return void (err.textContent = 'Las contraseñas no coinciden');
      }

      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Un momento…';
      try {
        let privateKey: Uint8Array;
        if (mode === 'import') {
          const phrase = words.value.trim().toLowerCase().split(/\s+/).join(' ');
          try {
            privateKey = fromMnemonic(phrase);
          } catch {
            throw new Error('Frase inválida: revisa las palabras y el orden');
          }
          if (privateKey.length !== 32) throw new Error('Se necesitan exactamente 24 palabras');
        } else {
          privateKey = generateKeypair().privateKey;
        }

        const stored = remember
          ? await sealWithDeviceKey(privateKey, username)
          : await encryptSeed(privateKey, p.value, username);
        await saveIdentity(stored);
        if (mode === 'create') await showMnemonic(toMnemonic(privateKey));
        overlay.remove();
        resolve({ username, privateKey, publicKey: hexToBytes(stored.publicKeyHex) });
      } catch (e) {
        err.textContent = (e as Error).message;
        btn.disabled = false;
        btn.textContent = label;
      }
    };
    u.focus();
  });
}

function promptUnlock(stored: StoredIdentity): Promise<Identity> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <div class="login-card">
        <h1>Desbloquear</h1>
        <p class="hint" id="who"></p>
        <input id="p" type="password" placeholder="contraseña" autocomplete="current-password" />
        <button id="go">Entrar</button>
        <button id="other" class="secondary">Usar otra identidad</button>
        <p class="error" id="err"></p>
      </div>`;
    document.body.appendChild(overlay);

    const p = overlay.querySelector('#p') as HTMLInputElement;
    const btn = overlay.querySelector('#go') as HTMLButtonElement;
    const other = overlay.querySelector('#other') as HTMLButtonElement;
    const err = overlay.querySelector('#err') as HTMLParagraphElement;
    (overlay.querySelector('#who') as HTMLParagraphElement).textContent =
      `${stored.username} · ${stored.publicKeyHex.slice(0, 4)}…${stored.publicKeyHex.slice(-4)}`;

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
    p.onkeydown = (e) => {
      if (e.key === 'Enter') void tryUnlock();
    };
    other.onclick = async () => {
      if (!confirm('Se borrará la identidad guardada en este navegador. Necesitarás tus 24 palabras para recuperarla. ¿Continuar?')) return;
      await clearIdentity();
      overlay.remove();
      resolve(promptSetup());
    };
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
        <p class="hint">Guarda estas 24 palabras. Sin ellas, si pierdes este navegador o borras sus datos, pierdes tu identidad.</p>
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