import type { KV } from '../core/kv';
import { available, deposit, depositAll, loadCargo, needsOf, repairFromCargo, saveCargo, withdraw, type Cargo } from '../sim/space/cargo';
import { MODULE_IDS, MODULES } from '../sim/space/ship';
import { loadShip, saveShip } from '../sim/space/store';
import { advance, loadStory, saveStory } from '../sim/space/story';
import { sheetOf } from '../sim/space/sheets';

// Panel de la nave: qué pide cada módulo, qué llevas encima y qué tienes guardado. Depositar y sacar es manual.
// No depende del shell ni de Three: se abre desde Tu Room.

const name = (k: string): string => sheetOf(k)?.name ?? k;

export function openShipPanel(opts: { kv: KV; seed: string; toast: (m: string) => void; onChange?: () => void }): void {
  const { kv, seed, toast } = opts;
  document.querySelector('.sp-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'login-overlay sp-overlay';
  overlay.innerHTML = `<div class="login-card sp-card" role="dialog" aria-modal="true">
    <h1>Nave</h1>
    <p class="hint sp-status"></p>
    <h2 class="sp-h">Módulos</h2><div class="sp-mods"></div>
    <h2 class="sp-h">Encima de ti</h2><div class="sp-carried"></div>
    <button type="button" class="sp-all secondary">Guardar todo en la nave</button>
    <h2 class="sp-h">Guardado en la nave</h2><div class="sp-stored"></div>
    <button type="button" class="sp-close secondary">Cerrar</button>
  </div>`;
  document.body.append(overlay);
  const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
  let cargo: Cargo = loadCargo(kv);
  const commit = (next: Cargo) => {
    cargo = next;
    saveCargo(kv, cargo);
    opts.onChange?.();
    draw();
  };
  const row = (text: string, buttons: Array<[string, () => void, boolean?]>): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'sp-row';
    const t = document.createElement('span');
    t.textContent = text;
    r.append(t);
    for (const [label, fn, disabled] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      b.textContent = label;
      b.disabled = Boolean(disabled);
      b.onclick = fn;
      r.append(b);
    }
    return r;
  };
  const draw = () => {
    const ship = loadShip(kv, seed);
    $('.sp-status').textContent = ship.status === 'flying' ? 'La nave está en vuelo.' : ship.status === 'landed' ? 'La nave está reparada y lista.' : 'La nave está en el suelo, dañada.';
    const mods = $('.sp-mods');
    mods.replaceChildren(
      ...MODULE_IDS.map((m) => {
        if (ship.modules[m]) return row(`${MODULES[m].name}: ok`, []);
        const needs = needsOf(m, cargo);
        const can = needs.every((n) => n.have >= n.need);
        const txt = `${MODULES[m].name}: roto · pide ${needs.map((n) => `${name(n.kind)} ${Math.min(n.have, n.need)}/${n.need}`).join(', ')}`;
        return row(txt, [
          [
            'Reparar',
            () => {
              const r = repairFromCargo(ship, m, cargo);
              if (!r.ok) return toast(r.reason);
              saveShip(kv, r.ship);
              const a = advance(loadStory(kv), { t: 'repaired' }, r.ship);
              if (a.changed) {
                saveStory(kv, a.story);
                toast('La nave está lista para despegar');
              } else toast(`${MODULES[m].name} reparado`);
              commit(r.cargo);
            },
            !can,
          ],
        ]);
      }),
    );
    const list = (c: Cargo['carried'], mk: (k: string, n: number) => Array<[string, () => void]>) => {
      const e = Object.entries(c).filter(([, n]) => n > 0);
      return e.length ? e.map(([k, n]) => row(`${name(k)} ×${n}`, mk(k, n))) : [row('Nada', [])];
    };
    $('.sp-carried').replaceChildren(...list(cargo.carried, (k) => [['Guardar', () => commit(deposit(cargo, k, 1))], ['Todo', () => commit(deposit(cargo, k))]]));
    $('.sp-stored').replaceChildren(...list(cargo.stored, (k) => [['Sacar', () => commit(withdraw(cargo, k, 1))], ['Todo', () => commit(withdraw(cargo, k))]]));
    $<HTMLButtonElement>('.sp-all').disabled = Object.keys(cargo.carried).length === 0;
    void available;
  };
  $<HTMLButtonElement>('.sp-all').onclick = () => commit(depositAll(cargo));
  $<HTMLButtonElement>('.sp-close').onclick = () => overlay.remove();
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  draw();
}
