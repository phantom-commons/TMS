import { type Identity, type StoredIdentity, decryptSeed, openWithDeviceKey } from '../identity/keys';
import { createGuest } from '../identity/account';
import { loadIdentity, clearIdentity } from '../identity/storage';

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
  return await createGuest(); // sin pantalla de registro: se juega ya y se guarda la cuenta cuando se quiera
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
        <button id="other" class="secondary">Olvidar esta cuenta y empezar de nuevo</button>
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
      if (!confirm('Se borrará la cuenta guardada en este navegador (se queda una nueva de invitado). Para recuperarla necesitarás tus 24 palabras. ¿Continuar?')) return;
      await clearIdentity();
      overlay.remove();
      resolve(await createGuest());
    };
    p.focus();
  });
}
