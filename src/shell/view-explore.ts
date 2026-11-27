import { icon } from '../ui/icons';
import { ROOMS, TYPE_LABEL, roomBadges, type RoomType } from '../core/room-config';
import { configOfDef, loadRoomDefs } from '../core/room-def';
import type { ShellApi } from './shell';

// Explorar: catálogo de rooms generado desde sus configuraciones. Añadir una room = añadir una entrada en ROOMS.

const FILTERS: Array<{ id: RoomType | 'all'; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'social', label: 'Social' },
  { id: 'arcade', label: 'Arcade' },
  { id: 'world', label: 'Mundos 3D' },
];

export function renderExplore(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-explore';
  el.innerHTML = `<h1>Explorar</h1><button type="button" class="wide cr-new">Crear room</button><div class="chips" role="tablist"></div><div class="list"></div>`;
  el.querySelector<HTMLElement>('.cr-new')!.onclick = () => api.go('#/create');
  const chips = el.querySelector<HTMLElement>('.chips')!;
  const list = el.querySelector<HTMLElement>('.list')!;
  let filter: RoomType | 'all' = 'all';

  const paint = () => {
    chips.replaceChildren(
      ...FILTERS.map((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip${f.id === filter ? ' active' : ''}`;
        b.textContent = f.label;
        b.onclick = () => {
          filter = f.id;
          paint();
        };
        return b;
      }),
    );
    list.replaceChildren(
      ...[...ROOMS, ...loadRoomDefs(api.kv).map(configOfDef)].filter((r) => r.type !== 'home' && (filter === 'all' || r.type === filter)).map((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'room-card';
        b.innerHTML = `<span class="rc-ico"></span><span class="rc-body"><b></b><small></small><span class="rc-badges"></span></span><span class="rc-go">›</span>`;
        b.querySelector('.rc-ico')!.innerHTML = icon(r.icon, 24);
        b.querySelector('b')!.textContent = r.name;
        b.querySelector('small')!.textContent = r.tagline;
        const badges = b.querySelector('.rc-badges')!;
        for (const label of [TYPE_LABEL[r.type], ...roomBadges(r)]) {
          const s = document.createElement('i');
          s.textContent = label;
          badges.append(s);
        }
        b.onclick = () => api.go(`#/room/${encodeURIComponent(r.id)}`);
        return b;
      }),
    );
  };
  paint();
  return el;
}
