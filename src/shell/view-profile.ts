import { toMnemonic } from '../identity/keys';
import { forgetHere, openAccountDialog } from './account-dialog';
import { getBest } from '../experiences/arcade/scores';
import { homeRoomId } from '../sim/worldgen';
import type { ShellApi } from './shell';

export function renderProfile(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-profile';
  const home = homeRoomId(api.author);
  el.innerHTML = `
    <header class="home-head"><div class="avatar"></div><div><small>Perfil</small><h1></h1></div></header>
    <div class="panel acct-panel">
      <h2 class="sec">Cuenta</h2>
      <p class="lead acct-state"></p>
      <div class="row"><button type="button" data-save>Guardar cuenta</button><button type="button" data-import>Ya tengo cuenta</button></div>
    </div>
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
  const saved = api.identity.saved !== false;
  el.querySelector('.acct-state')!.textContent = saved
    ? `Cuenta guardada como ${api.identity.username}. Tu identidad son tus 24 palabras: guárdalas fuera de este navegador.`
    : 'Estás jugando como invitado. Todo se guarda en este navegador, pero si borras sus datos lo pierdes. Guarda tu cuenta para poder recuperarla.';
  el.querySelector<HTMLElement>('[data-save]')!.hidden = saved;
  el.querySelector<HTMLElement>('[data-import]')!.textContent = saved ? 'Entrar con otra cuenta' : 'Ya tengo cuenta';
  el.querySelector<HTMLElement>('[data-save]')!.onclick = () => openAccountDialog(api, 'save');
  el.querySelector<HTMLElement>('[data-import]')!.onclick = () => openAccountDialog(api, 'import');
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
    const warn = saved
      ? 'Se borrará la cuenta de este navegador. Necesitarás tus 24 palabras para volver. ¿Seguro?'
      : 'Eres invitado y no has guardado tu cuenta: si sigues, pierdes todo lo de este navegador para siempre. ¿Seguro?';
    if (!confirm(warn)) return;
    await forgetHere();
  };
  return el;
}
