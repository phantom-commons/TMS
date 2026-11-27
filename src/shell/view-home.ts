import { icon } from '../ui/icons';
import { roomById } from '../core/room-config';
import { shortPubkey } from '../identity/keys';
import { getBest } from '../experiences/arcade/scores';
import { freeUnits } from '../core/inventory';
import { ownedUnits, usedUnits } from '../experiences/house/units';
import { paletteFromSeed } from '../sim/house/procedural';
import { objectThumb } from '../ui/object-thumb';
import type { ShellApi } from './shell';

// Home / mobile room: la pantalla inicial. Ligera: sin motor 3D, un solo lienzo pequeño con la vista previa de tu room.

export function renderHome(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-home';
  const snake = getBest(api.kv, 'snake');
  const runner = getBest(api.kv, 'runner');
  const owned = ownedUnits(api.kv, api.author);
  const used = usedUnits(api.kv, api.author);
  const stash = Object.keys(owned).reduce((a, k) => a + freeUnits(owned, used, k), 0);

  el.innerHTML = `
    <header class="home-head">
      <div class="avatar" aria-hidden="true"></div>
      <div><small>Hola</small><h1></h1><code></code></div>
    </header>
    <button class="unsaved" type="button" data-go="#/profile" hidden>Invitado sin guardar · <b>Guardar cuenta</b></button>
    <button class="hero" type="button" data-go="#/room/house">
      <div class="hero-stage"><div class="hero-items"></div></div>
      <div class="hero-text"><b>Tu Room</b><span>Entra a tu espacio privado</span></div>
    </button>
    <h2 class="sec">Jugar ahora</h2>
    <div class="quick">
      <button type="button" class="card" data-go="#/room/snake"><span class="card-ico">${icon(roomById('snake')?.icon ?? '', 26)}</span><b>Snake</b><small>Récord <em>${snake}</em></small></button>
      <button type="button" class="card" data-go="#/room/runner"><span class="card-ico">${icon(roomById('runner')?.icon ?? '', 26)}</span><b>Salto</b><small>Récord <em>${runner} m</em></small></button>
      <button type="button" class="card" data-go="#/room/world"><span class="card-ico">${icon(roomById('world')?.icon ?? '', 26)}</span><b>Mundo 3D</b><small>Cámara libre</small></button>
    </div>
    <div class="shortcuts">
      <button type="button" data-go="#/inventory">${icon('bag', 18)} Inventario <em>${stash} libres</em></button>
      <button type="button" data-go="#/room/my-room">${icon('room', 18)} Room clásica <em>isométrica</em></button>
      <button type="button" data-go="#/create">${icon('door', 18)} Crear room <em>con reglas</em></button>
      <button type="button" data-go="#/room/workshop">${icon('tools', 18)} Taller <em>crea tus objetos</em></button>
      <button type="button" data-go="#/room/lab">${icon('tools', 18)} Lab <em>naves y mundos</em></button>
      <button type="button" data-go="#/explore">${icon('compass', 18)} Explorar rooms</button>
    </div>`;
  el.querySelector('h1')!.textContent = api.identity.username;
  el.querySelector<HTMLElement>('.unsaved')!.hidden = api.identity.saved !== false;
  el.querySelector('code')!.textContent = shortPubkey(api.identity.publicKey);
  el.querySelector('.avatar')!.textContent = api.identity.username.slice(0, 1).toUpperCase();
  el.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => (b.onclick = () => api.go(b.dataset.go ?? '#/home')));

  // vista previa de tu room: sus colores procedurales y algunos de tus objetos (todo viene de tus datos, sin imágenes)
  const pal = paletteFromSeed(api.author);
  const stage = el.querySelector<HTMLElement>('.hero-stage')!;
  stage.style.background = `linear-gradient(180deg, ${pal.wall} 0 58%, ${pal.floor} 58% 100%)`;
  const items = el.querySelector<HTMLElement>('.hero-items')!;
  for (const kind of Object.keys(owned).slice(0, 6)) {
    const url = objectThumb(kind, 72);
    if (!url) continue;
    const img = new Image();
    img.src = url;
    img.alt = '';
    items.append(img);
  }
  return el;
}
