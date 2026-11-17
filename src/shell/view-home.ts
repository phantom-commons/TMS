import { roomById } from '../core/room-config';
import { shortPubkey } from '../identity/keys';
import { getBest } from '../experiences/arcade/scores';
import { loadLayout } from '../experiences/social/layout-store';
import { drawRoom, fitView, ownerHue } from '../experiences/social/render';
import type { ShellApi } from './shell';

// Home / mobile room: la pantalla inicial. Ligera: sin motor 3D, un solo lienzo pequeño con la vista previa de tu room.

export function renderHome(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-home';
  const { layout } = loadLayout(api.kv, api.author);
  const snake = getBest(api.kv, 'snake');
  const runner = getBest(api.kv, 'runner');
  const stash = Object.values(layout.stash).reduce((a, b) => a + (b ?? 0), 0);

  el.innerHTML = `
    <header class="home-head">
      <div class="avatar" aria-hidden="true"></div>
      <div><small>Hola</small><h1></h1><code></code></div>
    </header>
    <button class="unsaved" type="button" data-go="#/profile" hidden>⚠ Invitado sin guardar · <b>Guardar cuenta</b></button>
    <button class="hero" type="button" data-go="#/room/my-room">
      <canvas class="hero-canvas" width="320" height="200"></canvas>
      <div class="hero-text"><b>Tu Room</b><span>Entra a tu espacio privado</span></div>
    </button>
    <h2 class="sec">Jugar ahora</h2>
    <div class="quick">
      <button type="button" class="card" data-go="#/room/snake"><span class="card-ico">${roomById('snake')?.icon ?? ''}</span><b>Snake</b><small>Récord <em>${snake}</em></small></button>
      <button type="button" class="card" data-go="#/room/runner"><span class="card-ico">${roomById('runner')?.icon ?? ''}</span><b>Salto</b><small>Récord <em>${runner} m</em></small></button>
      <button type="button" class="card" data-go="#/room/world"><span class="card-ico">${roomById('world')?.icon ?? ''}</span><b>Mundo 3D</b><small>Cámara libre</small></button>
    </div>
    <div class="shortcuts">
      <button type="button" data-go="#/inventory">🎒 Inventario <em>${stash} guardados</em></button>
      <button type="button" data-go="#/explore">🧭 Explorar rooms</button>
    </div>`;
  el.querySelector('h1')!.textContent = api.identity.username;
  el.querySelector<HTMLElement>('.unsaved')!.hidden = api.identity.saved !== false;
  el.querySelector('code')!.textContent = shortPubkey(api.identity.publicKey);
  el.querySelector('.avatar')!.textContent = api.identity.username.slice(0, 1).toUpperCase();
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => (b.onclick = () => api.go(b.dataset.go ?? '#/home')));

  // vista previa estática de tu room (se dibuja una vez)
  const c = el.querySelector<HTMLCanvasElement>('.hero-canvas')!;
  const g = c.getContext('2d');
  if (g) drawRoom(g, c.width, c.height, fitView(c.width, c.height, 1), layout, { hue: ownerHue(layout.owner) });
  return el;
}
