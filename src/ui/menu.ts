import { toMnemonic, type Identity } from '../identity/keys';
import { clearIdentity } from '../identity/storage';

export type CameraMode = 'isometric' | 'top' | 'perspective';
export type InspectorMode = 'always' | 'hover' | 'off';

export type MenuActions = {
  onCameraChange: (mode: CameraMode) => void;
  onRoomLog: () => void;
  onInspectorChange: (mode: InspectorMode) => void;
  onOpenLab: () => void;
};

const INSPECTOR_KEY = 'tms.inspector.mode';
export function getInspectorMode(): InspectorMode {
  const value = localStorage.getItem(INSPECTOR_KEY);
  return value === 'always' || value === 'off' ? value : 'hover';
}

export function attachMenu(identity: Identity, actions: MenuActions): void {
  const btn = document.createElement('button');
  btn.className = 'hud-btn';
  btn.title = 'Abrir menú radial';
  btn.setAttribute('aria-label', 'Abrir menú radial');
  btn.textContent = '⌘';
  document.body.appendChild(btn);

  const closeMenu = () => document.getElementById('radial-menu')?.remove();
  btn.onclick = () => {
    if (document.getElementById('radial-menu')) { closeMenu(); return; }
    const overlay = document.createElement('div');
    overlay.id = 'radial-menu';
    overlay.className = 'radial-overlay';
    overlay.innerHTML = `
      <section class="radial-panel" role="dialog" aria-modal="true" aria-label="Menú TMS">
        <header class="radial-header"><div><small>TMS / ROOM</small><h2>Control center</h2></div><button class="radial-close" aria-label="Cerrar">×</button></header>
        <div class="radial-grid">
          <button data-action="room-log"><span>▤</span><b>Room Log</b><small>Historial completo</small></button>
          <button data-action="lab"><span>◇</span><b>Three.js Lab</b><small>Laboratorio</small></button>
          <button data-action="camera"><span>◉</span><b>Cámara</b><small>Vista del mundo</small></button>
          <button data-action="inspector"><span>⌕</span><b>Inspector</b><small>Panel de actividad</small></button>
          <button data-action="identity"><span>◎</span><b>Identidad</b><small>Cuenta y seguridad</small></button>
        </div>
        <div class="radial-subview" hidden></div>
      </section>`;
    document.body.append(overlay);
    const $ = <T extends HTMLElement>(selector: string) => overlay.querySelector(selector) as T;
    $('.radial-close').onclick = closeMenu;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeMenu(); });

    const subview = $('.radial-subview');
    const showSub = (title: string, markup: string) => {
      subview.hidden = false;
      subview.innerHTML = `<div class="radial-subhead"><b>${title}</b><button data-back>Volver</button></div>${markup}`;
      subview.querySelector('[data-back]')?.addEventListener('click', () => { subview.hidden = true; });
    };

    overlay.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((item) => {
      item.onclick = () => {
        switch (item.dataset.action) {
          case 'room-log': actions.onRoomLog(); closeMenu(); break;
          case 'lab': actions.onOpenLab(); closeMenu(); break;
          case 'camera':
            showSub('Modo de cámara', `<div class="radial-options">
              <button data-camera="isometric">Isométrica</button>
              <button data-camera="top">Superior / ortográfica</button>
              <button data-camera="perspective">Perspectiva</button>
            </div>`);
            subview.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => {
              b.onclick = () => { actions.onCameraChange(b.dataset.camera as CameraMode); closeMenu(); };
            });
            break;
          case 'inspector':
            showSub('Visibilidad del inspector', `<div class="radial-options">
              <button data-inspector="always">Siempre visible</button>
              <button data-inspector="hover">Solo hover / click</button>
              <button data-inspector="off">Apagado</button>
            </div>`);
            subview.querySelectorAll<HTMLButtonElement>('[data-inspector]').forEach((b) => {
              b.onclick = () => {
                const mode = b.dataset.inspector as InspectorMode;
                localStorage.setItem(INSPECTOR_KEY, mode);
                actions.onInspectorChange(mode);
                closeMenu();
              };
            });
            break;
          case 'identity':
            showSub('Identidad local', `<p class="radial-note">${identity.username}</p>
              <button data-phrase>Mostrar frase de recuperación</button>
              <pre class="radial-phrase" hidden></pre>
              <button data-logout class="danger">Cerrar sesión</button>`);
            subview.querySelector('[data-phrase]')?.addEventListener('click', () => {
              const phrase = subview.querySelector('pre') as HTMLPreElement;
              phrase.textContent = toMnemonic(identity.privateKey);
              phrase.hidden = false;
            });
            subview.querySelector('[data-logout]')?.addEventListener('click', async () => {
              if (!confirm('Se borrará la identidad guardada en este navegador. Necesitarás tus 24 palabras para volver. ¿Seguro?')) return;
              await clearIdentity();
              location.reload();
            });
            break;
        }
      };
    });
  };
}
