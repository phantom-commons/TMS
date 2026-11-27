import { addContact, contactLabel, loadContacts, makeCard, parseContact, removeContact, renameContact } from '../core/contacts';
import type { ShellApi } from './shell';

// Libreta de contactos: lista, añadir por clave/tarjeta/enlace, renombrar, quitar y compartir tu tarjeta.
// Con `onPick` funciona como selector (por ejemplo desde Dar): al tocar un contacto se devuelve su clave.

export function openContactsDialog(api: ShellApi, opts: { onPick?: (pubkey: string) => void; onChange?: () => void } = {}): void {
  document.querySelector('.ct-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'login-overlay acct-overlay ct-overlay';
  overlay.innerHTML = `<div class="login-card acct-card" role="dialog" aria-modal="true">
    <h1>${opts.onPick ? 'Elegir contacto' : 'Contactos'}</h1>
    <div class="ct-list"></div>
    <p class="hint">Añade a alguien pegando su clave pública o su tarjeta. También puedes tocar a otro jugador dentro de una sala.</p>
    <input class="ct-in" placeholder="clave o tarjeta (tms-c.…)" autocomplete="off" autocapitalize="none" spellcheck="false" />
    <button type="button" class="ct-add">Añadir</button>
    <p class="error ct-err"></p>
    <button type="button" class="ct-card secondary">Copiar mi tarjeta</button>
    <button type="button" class="ct-close secondary">Cerrar</button>
  </div>`;
  document.body.append(overlay);
  const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
  const close = () => overlay.remove();
  const draw = () => {
    const list = $('.ct-list');
    list.replaceChildren();
    const all = loadContacts(api.kv);
    if (!all.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Aún no tienes contactos.';
      list.append(p);
    }
    for (const c of all) {
      const row = document.createElement('div');
      row.className = 'ct-row';
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'ct-main secondary';
      const nm = document.createElement('b');
      nm.textContent = contactLabel(c);
      const sub = document.createElement('small');
      sub.textContent = `${c.pubkey.slice(0, 8)}…${c.signed ? ' · tarjeta verificada' : ''}`;
      main.append(nm, sub);
      main.onclick = () => {
        if (opts.onPick) {
          close();
          opts.onPick(c.pubkey);
          return;
        }
        const next = window.prompt('Nombre para este contacto (vacío = el suyo)', c.alias ?? c.name);
        if (next === null) return;
        renameContact(api.kv, c.pubkey, next);
        opts.onChange?.();
        draw();
      };
      row.append(main);
      if (!opts.onPick) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ct-del secondary';
        del.setAttribute('aria-label', 'Quitar contacto');
        del.textContent = 'Quitar';
        del.onclick = () => {
          removeContact(api.kv, c.pubkey);
          opts.onChange?.();
          draw();
        };
        row.append(del);
      }
      list.append(row);
    }
  };
  $<HTMLButtonElement>('.ct-add').onclick = () => {
    const err = $('.ct-err');
    err.textContent = '';
    const raw = $<HTMLInputElement>('.ct-in').value;
    const p = parseContact(raw);
    if (!p) return void (err.textContent = 'No reconozco eso: pega una clave de 64 caracteres o una tarjeta tms-c.…');
    const r = addContact(api.kv, api.author, p, Date.now());
    if (!r.ok) return void (err.textContent = r.reason);
    $<HTMLInputElement>('.ct-in').value = '';
    api.toast(r.created ? 'Contacto añadido' : 'Contacto actualizado');
    opts.onChange?.();
    draw();
  };
  $<HTMLButtonElement>('.ct-card').onclick = () => {
    const card = makeCard(api.identity.username, api.identity.privateKey);
    void navigator.clipboard?.writeText(card).then(
      () => api.toast('Tarjeta copiada: pásasela a quien quieras'),
      () => ($('.ct-err').textContent = card),
    );
  };
  $<HTMLButtonElement>('.ct-close').onclick = close;
  draw();
}
