import { addContact, displayName, getContact, removeContact, renameContact } from '../core/contacts';
import type { KV } from '../core/kv';

// Ventana pequeña al tocar a otro jugador: añadir como contacto (con un nombre tuyo opcional), renombrar o quitar.
// No depende del shell: se usa tanto desde el menú como desde la sala 3D.

export function openContactPrompt(opts: { kv: KV; self: string; pubkey: string; toast: (m: string) => void; onChange?: () => void }): void {
  const { kv, self, pubkey, toast, onChange } = opts;
  if (pubkey.toLowerCase() === self.toLowerCase()) return void toast('Esa eres tú.');
  document.querySelector('.cp-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'login-overlay cp-overlay';
  overlay.innerHTML = `<div class="login-card" role="dialog" aria-modal="true" style="width:min(340px,92vw)">
    <h1></h1><p class="hint cp-key"></p>
    <input class="cp-name" maxlength="32" placeholder="nombre para ti (opcional)" autocomplete="off" />
    <button type="button" class="cp-add"></button>
    <button type="button" class="cp-del" hidden style="background:transparent;color:#ff7b8c;border:1px solid #2b2f3a">Quitar de contactos</button>
    <button type="button" class="cp-close" style="background:transparent;color:#aab0bd;border:1px solid #2b2f3a">Cerrar</button>
  </div>`;
  document.body.append(overlay);
  const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
  const close = () => overlay.remove();
  const sync = () => {
    const c = getContact(kv, pubkey);
    $('h1').textContent = displayName(kv, pubkey);
    $('.cp-key').textContent = `${pubkey.slice(0, 12)}…${pubkey.slice(-6)}`;
    $<HTMLInputElement>('.cp-name').value = c?.alias ?? c?.name ?? '';
    $('.cp-add').textContent = c ? 'Guardar nombre' : 'Añadir contacto';
    $('.cp-del').hidden = !c;
  };
  $<HTMLButtonElement>('.cp-add').onclick = () => {
    const name = $<HTMLInputElement>('.cp-name').value;
    if (getContact(kv, pubkey)) {
      renameContact(kv, pubkey, name);
      toast('Nombre guardado');
    } else {
      const r = addContact(kv, self, { pubkey, how: 'tap' }, Date.now());
      if (!r.ok) return void toast(r.reason);
      if (name.trim()) renameContact(kv, pubkey, name);
      toast('Contacto añadido');
    }
    onChange?.();
    close();
  };
  $<HTMLButtonElement>('.cp-del').onclick = () => {
    removeContact(kv, pubkey);
    toast('Contacto quitado');
    onChange?.();
    close();
  };
  $<HTMLButtonElement>('.cp-close').onclick = close;
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  sync();
}
