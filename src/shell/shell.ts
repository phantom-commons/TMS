import './shell.css';
import { registerBuiltinExperiences } from '../core/experience-registry';
import { createKV, type KV } from '../core/kv';
import { createRoomManager } from '../core/room-manager';
import type { Identity } from '../identity/keys';
import { bytesToHex } from '../sim/hash';
import { showToast } from '../ui/toast';
import { renderExplore } from './view-explore';
import { renderHome } from './view-home';
import { renderInventory } from './view-inventory';
import { renderProfile } from './view-profile';

// Shell móvil de TMS: pestañas (Inicio · Explorar · Tu Room · Inventario · Perfil) y una capa para la room abierta.
// Ruta en el hash (#/home, #/explore, #/inventory, #/profile, #/room/<id>): el botón Atrás y recargar funcionan.

export type ShellApi = {
  identity: Identity;
  author: string;
  kv: KV;
  go: (hash: string) => void;
  toast: (message: string, ms?: number) => void;
};

type Tab = 'home' | 'explore' | 'inventory' | 'profile';
const TABS: Array<{ id: Tab | 'room'; icon: string; label: string }> = [
  { id: 'home', icon: '🏠', label: 'Inicio' },
  { id: 'explore', icon: '🧭', label: 'Explorar' },
  { id: 'room', icon: '🛋️', label: 'Tu Room' },
  { id: 'inventory', icon: '🎒', label: 'Inventario' },
  { id: 'profile', icon: '👤', label: 'Perfil' },
];

const VIEWS: Record<Tab, (api: ShellApi) => HTMLElement> = {
  home: renderHome,
  explore: renderExplore,
  inventory: renderInventory,
  profile: renderProfile,
};

export function startShell(identity: Identity): void {
  document.body.classList.add('shell-mode');
  registerBuiltinExperiences();

  const author = bytesToHex(identity.publicKey);
  const kv = createKV(author.slice(0, 16));
  const app = document.createElement('div');
  app.className = 'shell';
  app.innerHTML = `
    <main class="shell-main" id="shell-main"></main>
    <nav class="tabbar" aria-label="Navegación principal"></nav>
    <div class="room-host" hidden></div>`;
  document.body.append(app);
  const main = app.querySelector<HTMLElement>('.shell-main')!;
  const nav = app.querySelector<HTMLElement>('.tabbar')!;
  const host = app.querySelector<HTMLElement>('.room-host')!;

  let lastTab: Tab = 'home';
  const go = (hash: string) => {
    if (location.hash === hash) void route();
    else location.hash = hash;
  };
  const api: ShellApi = { identity, author, kv, go, toast: showToast };
  const manager = createRoomManager({
    host,
    identity,
    author,
    kv,
    toast: showToast,
    exit: () => go(`#/${lastTab}`),
    go,
  });

  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tab${t.id === 'room' ? ' tab-room' : ''}`;
    b.dataset.tab = t.id;
    b.innerHTML = `<span class="tab-ico">${t.icon}</span><span class="tab-lbl">${t.label}</span>`;
    b.onclick = () => go(t.id === 'room' ? '#/room/my-room' : `#/${t.id}`);
    nav.append(b);
  }

  const setActive = (id: string) => nav.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));

  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [head, arg] = hash.split('/');
    if (head === 'room' && arg) {
      app.classList.add('in-room');
      setActive('room');
      await manager.open(decodeURIComponent(arg));
      return;
    }
    manager.close();
    app.classList.remove('in-room');
    const tab: Tab = head === 'explore' || head === 'inventory' || head === 'profile' ? head : 'home';
    lastTab = tab;
    setActive(tab);
    main.replaceChildren(VIEWS[tab](api));
    main.scrollTop = 0;
  }

  window.addEventListener('hashchange', () => void route());
  void route();
}
