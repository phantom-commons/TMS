import { toMnemonic } from '../identity/keys';
import type { Identity } from '../identity/keys';

export function attachExportButton(identity: Identity): void {
  const btn = document.createElement('button');
  btn.className = 'hud-btn';
  btn.title = 'Exportar frase de recuperación';
  btn.textContent = '⌘';
  document.body.appendChild(btn);

  btn.onclick = () => {
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.innerHTML = `
      <div class="login-card">
        <h1>Frase de recuperación</h1>
        <p class="hint">Guárdala en un lugar seguro. No la compartas.</p>
        <div class="mnemonic" id="mn"></div>
        <button id="ok">Cerrar</button>
      </div>`;
    document.body.appendChild(overlay);
    (overlay.querySelector('#mn') as HTMLDivElement).textContent =
      toMnemonic(identity.privateKey);
    (overlay.querySelector('#ok') as HTMLButtonElement).onclick = () =>
      overlay.remove();
  };
}