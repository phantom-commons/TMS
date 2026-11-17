import { checkWords, parsePhrase, pickCheckIndices, saveAccount, toMnemonic, validateHandle, validatePassword } from '../identity/account';
import { clearIdentity } from '../identity/storage';
import { hexToBytes } from '../identity/keys';
import type { ShellApi } from './shell';

// Diálogos de cuenta del Perfil:
//   save   → un invitado guarda su cuenta: ve las 24 palabras, confirma 3 y elige @usuario + contraseña.
//   import → "ya tengo cuenta": pega sus 24 palabras en este dispositivo y elige @usuario + contraseña locales.

type Mode = 'save' | 'import';

export function openAccountDialog(api: ShellApi, mode: Mode): void {
  const overlay = document.createElement('div');
  overlay.className = 'login-overlay acct-overlay';
  const phrase = mode === 'save' ? toMnemonic(api.identity.privateKey) : '';
  const idx = mode === 'save' ? pickCheckIndices() : [];
  overlay.innerHTML = `
    <div class="login-card acct-card" role="dialog" aria-modal="true">
      <h1>${mode === 'save' ? 'Guardar cuenta' : 'Ya tengo cuenta'}</h1>
      ${
        mode === 'save'
          ? `<p class="hint">Estas 24 palabras son tu cuenta. Quien las tenga entra como tú, y sin ellas no hay forma de recuperarla en otro dispositivo.</p>
             <div class="mnemonic acct-words"></div>
             <p class="hint">Para confirmar que las guardaste, escribe estas palabras:</p>
             <div class="acct-checks">${idx.map((i) => `<input class="acct-check" placeholder="palabra #${i + 1}" autocomplete="off" autocapitalize="none" spellcheck="false" />`).join('')}</div>`
          : `<p class="hint">Pega tus 24 palabras. Esta cuenta sustituirá a la de invitado en este dispositivo.</p>
             <textarea class="acct-phrase" rows="4" placeholder="las 24 palabras, separadas por espacios"></textarea>`
      }
      <input class="acct-handle" placeholder="@usuario" autocomplete="username" autocapitalize="none" spellcheck="false" />
      <input class="acct-pw" type="password" placeholder="contraseña (8+)" autocomplete="new-password" />
      <input class="acct-pw2" type="password" placeholder="repetir contraseña" autocomplete="new-password" />
      <p class="hint">El @usuario y la contraseña solo protegen este navegador: se pedirá la contraseña al abrir.</p>
      <button type="button" class="acct-go">${mode === 'save' ? 'Guardar cuenta' : 'Entrar con mis palabras'}</button>
      <button type="button" class="acct-cancel secondary">Cancelar</button>
      <p class="error acct-err"></p>
    </div>`;
  document.body.append(overlay);
  const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
  if (mode === 'save') $('.acct-words').textContent = phrase;
  const err = $<HTMLElement>('.acct-err');
  const go = $<HTMLButtonElement>('.acct-go');
  const close = () => overlay.remove();
  $('.acct-cancel').onclick = close;

  go.onclick = async () => {
    const handle = $<HTMLInputElement>('.acct-handle').value;
    const pw = $<HTMLInputElement>('.acct-pw').value;
    err.textContent = '';
    const bad = validateHandle(handle) ?? validatePassword(pw) ?? (pw !== $<HTMLInputElement>('.acct-pw2').value ? 'Las contraseñas no coinciden' : null);
    if (bad) return void (err.textContent = bad);
    try {
      let key = api.identity.privateKey;
      if (mode === 'save') {
        const answers = [...overlay.querySelectorAll<HTMLInputElement>('.acct-check')].map((i) => i.value);
        if (!checkWords(phrase, idx, answers)) return void (err.textContent = 'Las palabras no coinciden: revisa que las guardaste bien');
      } else {
        key = parsePhrase($<HTMLTextAreaElement>('.acct-phrase').value);
        if (!api.identity.saved && !confirm('Lo que hiciste como invitado (récords, muebles) quedará fuera de alcance en este dispositivo. ¿Continuar?')) return;
      }
      go.disabled = true;
      go.textContent = 'Un momento…';
      const next = await saveAccount(key, handle, pw);
      if (mode === 'import') {
        // otra clave = otro espacio de datos: se recarga con la cuenta nueva
        close();
        location.hash = '#/home';
        location.reload();
        return;
      }
      Object.assign(api.identity, { username: next.username, saved: true, publicKey: hexToBytes(api.author) });
      close();
      api.toast(`Cuenta guardada · ${next.username}`);
      api.go('#/profile');
    } catch (e) {
      err.textContent = (e as Error).message;
      go.disabled = false;
      go.textContent = mode === 'save' ? 'Guardar cuenta' : 'Entrar con mis palabras';
    }
  };
}

/** Quita la cuenta de este navegador; al recargar se crea un invitado nuevo. */
export async function forgetHere(): Promise<void> {
  await clearIdentity();
  location.hash = '';
  location.reload();
}
