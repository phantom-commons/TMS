import { toMnemonic } from '../identity/keys';
import { clearIdentity } from '../identity/storage';
import { getBest } from '../experiences/arcade/scores';
import { homeRoomId } from '../sim/worldgen';
import type { ShellApi } from './shell';

export function renderProfile(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-profile';
  const home = homeRoomId(api.author);
  el.innerHTML = `
    <header class="home-head"><div class="avatar"></div><div><small>Perfil</small><h1></h1></div></header>
    <div class="panel">
      <h2 class="sec">Identidad</h2>
      <dl>
        <dt>Clave pública</dt><dd><code class="pk"></code></dd>
        <dt>Sala 3D propia</dt><dd><code class="home"></code></dd>
      </dl>
      <div class="row"><button type="button" data-copy>Copiar clave pública</button><button type="button" data-visit>Copiar enlace de visita 3D</button></div>
    </div>
    <div class="panel">
      <h2 class="sec">Récords</h2>
      <div class="records">
        <div><small>🐍 Snake</small><b>${getBest(api.kv, 'snake')}</b></div>
        <div><small>🦖 Salto</small><b>${getBest(api.kv, 'runner')} m</b></div>
      </div>
      <p class="lead">Los récords se guardan en este dispositivo. No son eventos firmados del log.</p>
    </div>
    <div class="panel">
      <h2 class="sec">Seguridad</h2>
      <div class="mnemonic" hidden></div>
      <div class="row"><button type="button" data-phrase>Ver mis 24 palabras</button><button type="button" class="danger" data-logout>Olvidar identidad aquí</button></div>
    </div>`;
  el.querySelector('h1')!.textContent = api.identity.username;
  el.querySelector('.avatar')!.textContent = api.identity.username.slice(0, 1).toUpperCase();
  el.querySelector('.pk')!.textContent = api.author;
  el.querySelector('.home')!.textContent = home;

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
      api.toast(ok);
    } catch {
      api.toast(text, 7000);
    }
  };
  el.querySelector<HTMLElement>('[data-copy]')!.onclick = () => void copy(api.author, 'clave pública copiada');
  el.querySelector<HTMLElement>('[data-visit]')!.onclick = () =>
    void copy(`${location.origin}${location.pathname}?room=${encodeURIComponent(home)}`, 'enlace copiado');

  const mn = el.querySelector<HTMLElement>('.mnemonic')!;
  el.querySelector<HTMLElement>('[data-phrase]')!.onclick = () => {
    mn.hidden = !mn.hidden;
    if (!mn.hidden) mn.textContent = toMnemonic(api.identity.privateKey);
  };
  el.querySelector<HTMLElement>('[data-logout]')!.onclick = async () => {
    if (!confirm('Se borrará la identidad de este navegador. Necesitarás tus 24 palabras para volver. ¿Seguro?')) return;
    await clearIdentity();
    location.hash = '';
    location.reload();
  };
  return el;
}
