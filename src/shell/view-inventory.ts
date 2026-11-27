import { icon } from '../ui/icons';
import { freeUnits } from '../core/inventory';
import { knownObject } from '../core/object-registry';
import { housekeeping, lentOut, loadForks, loadReceipts, offeredBy, unitStates } from '../core/units/ledger';
import { valueStats, type SignedReceipt } from '../core/units/receipt';
import { ownedUnits, usedUnits } from '../experiences/house/units';
import { objectThumb } from '../ui/object-thumb';
import { openGiveDialog, openReceiveDialog } from './transfer-dialog';
import type { ShellApi } from './shell';

// Inventario único: tus unidades firmadas, iguales en cualquier room. «En uso» = colocadas en alguna de tus rooms;
// «libres» = esperan. Aquí también se ven los préstamos, las ofertas pendientes y los recibos (registro, no moneda).

const short = (h: string): string => `${h.slice(0, 6)}…${h.slice(-4)}`;
const day = (t: number): string => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const TYPE: Record<SignedReceipt['type'], string> = { gift: 'Regalo', loan: 'Préstamo', return: 'Devolución', reclaim: 'Recuperado' };

export function renderInventory(api: ShellApi): HTMLElement {
  const el = document.createElement('section');
  el.className = 'view view-inventory';
  const now = Date.now();
  housekeeping(api.kv, api.identity.privateKey, now); // cumple los contratos que hayan vencido
  const nameOf = (kind: string) => knownObject(kind)?.obj.name ?? 'Objeto';
  const redraw = () => document.querySelector('.view-inventory')?.replaceWith(renderInventory(api));

  el.innerHTML = `<h1>Inventario</h1><p class="lead">Cada objeto es una unidad firmada: su historia viaja con él. Colócalos desde el modo Editar de cada room.</p><div class="inv"></div>`;
  const grid = el.querySelector('.inv')!;
  const owned = ownedUnits(api.kv, api.author);
  const used = usedUnits(api.kv, api.author);
  const receipts = loadReceipts(api.kv);
  const creators: Record<string, string> = {};
  for (const s of unitStates(api.kv, now)) creators[s.unit] = s.creator;

  const kinds = Object.keys(owned).filter((k) => knownObject(k));
  if (!kinds.length) grid.textContent = 'Todavía no tienes objetos. Crea el primero en el Taller.';
  for (const kind of kinds) {
    const total = owned[kind] ?? 0;
    const free = freeUnits(owned, used, kind);
    const st = valueStats(kind, receipts, creators);
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.innerHTML = `<span class="inv-ico"></span><div class="inv-body"><b></b><small class="inv-n"></small><small class="inv-v"></small></div><button type="button" class="inv-give secondary">Dar</button>`;
    const ico = row.querySelector('.inv-ico') as HTMLElement;
    const thumb = objectThumb(kind, 44);
    if (thumb) ico.innerHTML = `<img alt="" src="${thumb}" width="44" height="44" />`;
    else ico.innerHTML = icon('box', 24);
    row.querySelector('b')!.textContent = nameOf(kind);
    row.querySelector('.inv-n')!.textContent = `${total} en total · ${total - free} en uso · ${free} libre${free === 1 ? '' : 's'}`;
    row.querySelector('.inv-v')!.textContent =
      st.gifts + st.loans > 0 ? `Ha pasado de mano ${st.gifts + st.loans} vez${st.gifts + st.loans === 1 ? '' : 'es'} · ${st.holders} persona${st.holders === 1 ? '' : 's'}${st.witnessed ? ` · ${st.witnessed} con testigos` : ''}` : 'Sin movimientos todavía';
    const give = row.querySelector<HTMLButtonElement>('.inv-give')!;
    give.disabled = free === 0;
    give.onclick = () => openGiveDialog(api, kind, redraw);
    grid.append(row);
  }

  // préstamos, ofertas pendientes y objetos prestados a ti
  const loans: string[] = [];
  for (const s of unitStates(api.kv, now)) {
    if (s.holder === api.author && s.owner !== api.author && s.status === 'loaned' && s.loan) loans.push(`${nameOf(s.kind)}: te lo prestó ${short(s.owner)} hasta el ${day(s.loan.returnBy)}`);
  }
  for (const s of lentOut(api.kv, api.author, now)) if (s.loan) loans.push(`${nameOf(s.kind)}: lo tiene ${short(s.holder)} hasta el ${day(s.loan.returnBy)}`);
  for (const s of offeredBy(api.kv, api.author, now)) if (s.offer) loans.push(`${nameOf(s.kind)}: ofrecido a ${short(s.offer.to)} (vale hasta el ${day(s.offer.until)})`);
  if (loans.length) {
    const h = document.createElement('h2');
    h.className = 'sec';
    h.textContent = 'En curso';
    const ul = document.createElement('ul');
    ul.className = 'inv-list';
    for (const t of loans) ul.append(Object.assign(document.createElement('li'), { textContent: t }));
    el.append(h, ul);
  }

  // recibos: el registro de lo que ha pasado
  if (receipts.length) {
    const h = document.createElement('h2');
    h.className = 'sec';
    h.textContent = 'Recibos';
    const ul = document.createElement('ul');
    ul.className = 'inv-list';
    for (const r of [...receipts].sort((a, b) => b.at - a.at).slice(0, 12)) {
      const dir = r.from === api.author ? `a ${short(r.to)}` : `de ${short(r.from)}`;
      ul.append(Object.assign(document.createElement('li'), { textContent: `${day(r.at)} · ${TYPE[r.type]} · ${nameOf(r.kind)} ${dir}${r.witnesses.length ? ` · ${r.witnesses.length} testigo${r.witnesses.length === 1 ? '' : 's'}` : ''}` }));
    }
    el.append(h, ul);
  }
  const forks = loadForks(api.kv).length;
  if (forks) el.append(Object.assign(document.createElement('p'), { className: 'lead', textContent: `Aviso: se vieron ${forks} historia${forks === 1 ? '' : 's'} contradictoria${forks === 1 ? '' : 's'} de alguna unidad. Se conserva la que se vio primero.` }));

  const recv = document.createElement('button');
  recv.type = 'button';
  recv.className = 'wide';
  recv.textContent = 'Recibir (y mi clave)';
  recv.onclick = () => openReceiveDialog(api, redraw);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'wide';
  open.textContent = 'Ir a Tu Room';
  open.onclick = () => api.go('#/room/house');
  const make = document.createElement('button');
  make.type = 'button';
  make.className = 'wide';
  make.textContent = 'Crear un objeto';
  make.onclick = () => api.go('#/room/workshop');
  el.append(recv, open, make);
  return el;
}
