import { loadLayout, saveLayout } from '../experiences/social/layout-store';
import { ITEMS, ITEM_KINDS, applyOp, findFreeSpot, placedCount, stashCount } from '../experiences/social/model';
import type { ShellApi } from './shell';

// Inventario: lo que posees. «En tu room» son los objetos colocados; «Guardados», los que esperan en el inventario.

export function renderInventory(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-inventory';

  const paint = () => {
    const { layout } = loadLayout(api.kv, api.author);
    el.innerHTML = `<h1>Inventario</h1><p class="lead">Coloca objetos en Tu Room. Lo que esté bloqueado allí no se puede guardar hasta desbloquearlo.</p><div class="inv"></div>`;
    const grid = el.querySelector('.inv')!;
    for (const kind of ITEM_KINDS) {
      const def = ITEMS[kind];
      const inRoom = placedCount(layout, kind);
      const stored = stashCount(layout, kind);
      if (inRoom + stored === 0) continue;
      const row = document.createElement('div');
      row.className = 'inv-row';
      row.innerHTML = `<span class="inv-ico"></span><div class="inv-body"><b></b><small></small></div>`;
      row.querySelector('.inv-ico')!.textContent = def.icon;
      row.querySelector('b')!.textContent = def.label;
      row.querySelector('small')!.textContent = `${stored} guardado${stored === 1 ? '' : 's'} · ${inRoom} en tu room · ${def.mount === 'wall' ? 'pared' : 'suelo'}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Colocar';
      btn.disabled = stored === 0;
      btn.onclick = () => {
        const fresh = loadLayout(api.kv, api.author).layout;
        const spot = findFreeSpot(fresh, kind);
        if (!spot) return api.toast('no hay hueco libre en Tu Room');
        const res = applyOp(fresh, { t: 'place', kind, ...spot }, 'owner');
        if (!res.ok) return api.toast(res.error);
        saveLayout(api.kv, res.layout, api.identity.privateKey);
        api.toast(`${def.label} colocado en Tu Room`);
        paint();
      };
      row.append(btn);
      grid.append(row);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'wide';
    open.textContent = '🛋️ Ir a Tu Room';
    open.onclick = () => api.go('#/room/my-room');
    el.append(open);
  };
  paint();
  return el;
}
