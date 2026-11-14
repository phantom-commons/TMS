import { toMnemonic, type Identity } from '../identity/keys';
import { clearIdentity } from '../identity/storage';

export function attachMenu(identity: Identity): void {
  const btn = document.createElement('button');
  btn.className = 'hud-btn';
  btn.title = 'Menú';
  btn.textContent = '⌘';
  document.body.appendChild(btn);

  btn.onclick = () => {
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <div class="login-card">
        <h1 id="name"></h1>
        <button id="phrase" class="secondary">Ver frase de recuperación</button>
        <div class="mnemonic" id="mn" hidden></div>
        <button id="logout" class="secondary">Cerrar sesión</button>
        <button id="ok">Cerrar</button>
      </div>`;
    document.body.appendChild(overlay);

    const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
    $('#name').textContent = identity.username;
    const mn = $<HTMLDivElement>('#mn');
    $<HTMLButtonElement>('#phrase').onclick = () => {
      mn.textContent = toMnemonic(identity.privateKey);
      mn.hidden = false;
    };
    $<HTMLButtonElement>('#logout').onclick = async () => {
      if (!confirm('Se borrará la identidad de este navegador. Necesitarás tus 24 palabras para volver. ¿Seguro?')) return;
      await clearIdentity();
      location.reload();
    };
    $<HTMLButtonElement>('#ok').onclick = () => overlay.remove();
  };
}