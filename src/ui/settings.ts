import { toMnemonic, type Identity } from '../identity/keys';
import { clearIdentity } from '../identity/storage';
import { CAM_LABEL, CAM_MODES } from '../render/camera';
import type { InspectorMode, Settings, SettingsStore } from './settings-store';
import { showToast } from './toast';

export type SettingsDeps = {
  identity: Identity;
  store: SettingsStore;
  /** enlace para que te visiten (null si aún no hay sala propia) */
  visitLink: () => string;
  homeRoomId: string;
  roomId: string;
  goHome: () => void;
};

type ToggleKey = 'radial' | 'hints' | 'status' | 'dev' | 'ghosts' | 'shadows' | 'fog' | 'online';

const TOGGLES: Array<{ key: ToggleKey; label: string; hint?: string }> = [
  { key: 'radial', label: 'Menú radial', hint: 'R' },
  { key: 'hints', label: 'Barra de atajos' },
  { key: 'status', label: 'Chip de conexión y mochila' },
  { key: 'dev', label: 'Panel de desarrollador', hint: 'F2' },
  { key: 'ghosts', label: 'Ver fantasmas (desconectados)' },
  { key: 'shadows', label: 'Sombras' },
  { key: 'fog', label: 'Niebla en 1ª/3ª persona' },
  { key: 'online', label: 'Conectar al relay (visitas)' },
];

const INSPECTOR: Array<[InspectorMode, string]> = [
  ['always', 'Siempre visible'],
  ['hover', 'Al pasar / hacer click'],
  ['off', 'Apagado'],
];

export function attachSettings(deps: SettingsDeps): { open: () => void } {
  const btn = document.createElement('button');
  btn.className = 'hud-btn';
  btn.title = 'Ajustes';
  btn.textContent = '⌘';
  document.body.append(btn);

  const open = () => {
    if (document.getElementById('settings-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.className = 'login-overlay';
    const card = document.createElement('div');
    card.className = 'login-card settings';
    overlay.append(card);
    document.body.append(overlay);

    let unsub: () => void = () => {};
    const close = () => {
      unsub();
      overlay.remove();
    };
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });

    const section = (title: string) => {
      const h = document.createElement('h2');
      h.textContent = title;
      card.append(h);
    };

    const head = document.createElement('h1');
    head.textContent = deps.identity.username;
    card.append(head);

    // ---- cámara ----
    section('Cámara');
    const camRow = document.createElement('div');
    camRow.className = 'seg';
    const camButtons = new Map<string, HTMLButtonElement>();
    for (const mode of CAM_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = CAM_LABEL[mode];
      b.onclick = () => deps.store.set({ camera: mode });
      camButtons.set(mode, b);
      camRow.append(b);
    }
    card.append(camRow);

    // ---- inspector ----
    section('Log del objeto (inspector)');
    const insRow = document.createElement('div');
    insRow.className = 'seg';
    const insButtons = new Map<string, HTMLButtonElement>();
    for (const [mode, label] of INSPECTOR) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => deps.store.set({ inspector: mode });
      insButtons.set(mode, b);
      insRow.append(b);
    }
    card.append(insRow);

    // ---- interruptores ----
    section('Interfaz y red');
    const inputs = new Map<ToggleKey, HTMLInputElement>();
    for (const t of TOGGLES) {
      const label = document.createElement('label');
      label.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.onchange = () => deps.store.set({ [t.key]: input.checked } as Partial<Settings>);
      const text = document.createElement('span');
      text.textContent = t.label;
      label.append(text);
      if (t.hint) {
        const kbd = document.createElement('kbd');
        kbd.textContent = t.hint;
        label.append(kbd);
      }
      label.append(input);
      inputs.set(t.key, input);
      card.append(label);
    }

    const sync = (s: Settings) => {
      camButtons.forEach((b, mode) => b.classList.toggle('active', s.camera === mode));
      insButtons.forEach((b, mode) => b.classList.toggle('active', s.inspector === mode));
      inputs.forEach((input, key) => (input.checked = s[key]));
    };
    sync(deps.store.get());
    unsub = deps.store.subscribe(sync);

    // ---- tu sala ----
    section('Tu habitación');
    const where = document.createElement('p');
    where.className = 'hint';
    where.textContent = deps.roomId === deps.homeRoomId
      ? 'Estás en tu habitación. Se genera de tus 24 palabras y funciona sin conexión.'
      : `Estás en «${deps.roomId}».`;
    card.append(where);

    const row = document.createElement('div');
    row.className = 'seg';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copiar enlace para visitas';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(deps.visitLink());
        showToast('enlace copiado');
      } catch {
        showToast(deps.visitLink(), 6000);
      }
    };
    row.append(copy);
    if (deps.roomId !== deps.homeRoomId) {
      const home = document.createElement('button');
      home.type = 'button';
      home.textContent = 'Ir a mi habitación';
      home.onclick = deps.goHome;
      row.append(home);
    }
    card.append(row);

    // ---- cuenta ----
    section('Cuenta');
    const mn = document.createElement('div');
    mn.className = 'mnemonic';
    mn.hidden = true;
    const phrase = document.createElement('button');
    phrase.type = 'button';
    phrase.className = 'secondary';
    phrase.textContent = 'Ver mis 24 palabras';
    phrase.onclick = () => {
      mn.textContent = toMnemonic(deps.identity.privateKey);
      mn.hidden = false;
    };
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'secondary';
    logout.textContent = 'Olvidar identidad en este navegador';
    logout.onclick = async () => {
      if (!confirm('Se borrará la identidad de este navegador (y tus acciones aún sin sincronizar). Necesitarás tus 24 palabras para volver. ¿Seguro?')) return;
      await clearIdentity();
      location.reload();
    };
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Cerrar';
    done.onclick = close;
    card.append(phrase, mn, logout, done);
  };

  btn.onclick = open;
  return { open };
}
