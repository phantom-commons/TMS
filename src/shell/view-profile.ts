import { toMnemonic } from '../identity/keys';
import { getGraphics, refreshGraphics, type Quality, type RenderScale, type Toggle3 } from '../core/graphics';
import { createSettingsStore } from '../ui/settings-store';
import { forgetHere, openAccountDialog } from './account-dialog';
import { getBest } from '../experiences/arcade/scores';
import { homeRoomId } from '../sim/worldgen';
import { loadContacts } from '../core/contacts';
import { openContactsDialog } from './contacts-dialog';
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
      <h2 class="sec">Contactos</h2>
      <p class="lead ct-count"></p>
      <div class="row"><button type="button" data-contacts>Abrir contactos</button></div>
    </div>
    <div class="panel">
      <h2 class="sec">Récords</h2>
      <div class="records">
        <div><small>Snake</small><b>${getBest(api.kv, 'snake')}</b></div>
        <div><small>Salto</small><b>${getBest(api.kv, 'runner')} m</b></div>
      </div>
      <p class="lead">Los récords se guardan en este dispositivo. No son eventos firmados del log.</p>
    </div>
    <div class="panel gfx-panel">
      <h2 class="sec">Gráficos</h2>
      <p class="lead gfx-state"></p>
      <label class="gfx-row"><span>Calidad</span><select data-gfx="quality"><option value="auto">Automática</option><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label>
      <label class="gfx-row"><span>Escala de render</span><select data-gfx="renderScale"><option value="0">Según la calidad</option><option value="100">100 %</option><option value="85">85 %</option><option value="70">70 %</option></select></label>
      <label class="gfx-row"><span>Contornos en objetos</span><select data-gfx="outlines"><option value="preset">Según la calidad</option><option value="on">Sí</option><option value="off">No</option></select></label>
      <p class="lead">Es solo cosa de tu pantalla: no cambia lo que ven los demás ni la forma física de los objetos.</p>
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
  const drawCount = () => (el.querySelector('.ct-count')!.textContent = `${loadContacts(api.kv).length} contactos. Se usan para dar y recibir objetos sin pegar claves.`);
  drawCount();
  el.querySelector<HTMLElement>('[data-contacts]')!.onclick = () => openContactsDialog(api, { onChange: drawCount });
  el.querySelector('.pk')!.textContent = api.author;
  el.querySelector('.home')!.textContent = home;

  // ---- gráficos: el cliente decide ----
  const settings = createSettingsStore();
  const showGfx = () => {
    const g = getGraphics();
    const names = { low: 'baja', medium: 'media', high: 'alta' } as const;
    el.querySelector('.gfx-state')!.textContent = `En uso: calidad ${names[g.tier]} · render al ${Math.round(g.scale)} % · contornos ${g.outlines ? 'sí' : 'no'}.`;
  };
  const s0 = settings.get();
  el.querySelector<HTMLSelectElement>('[data-gfx="quality"]')!.value = s0.quality;
  el.querySelector<HTMLSelectElement>('[data-gfx="renderScale"]')!.value = String(s0.renderScale);
  el.querySelector<HTMLSelectElement>('[data-gfx="outlines"]')!.value = s0.outlines;
  el.querySelectorAll<HTMLSelectElement>('[data-gfx]').forEach((sel) => {
    sel.onchange = () => {
      const key = sel.dataset.gfx;
      if (key === 'quality') settings.set({ quality: sel.value as Quality });
      else if (key === 'renderScale') settings.set({ renderScale: Number(sel.value) as RenderScale });
      else settings.set({ outlines: sel.value as Toggle3 });
      refreshGraphics();
      showGfx();
    };
  });
  showGfx();

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
