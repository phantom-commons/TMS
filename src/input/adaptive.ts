// Controles adaptativos: la misma experiencia se juega con teclado, táctil o mando.
// Detecta el último dispositivo que usaste y solo enseña los controles en pantalla cuando son táctiles.

export type GameAction = 'up' | 'down' | 'left' | 'right' | 'action' | 'pause';
export type Device = 'keyboard' | 'touch' | 'gamepad';
export type Scheme = 'dpad' | 'jump';

export type AdaptiveInput = {
  readonly device: Device;
  /** pulsación (una vez por pulsación; no se repite al mantener) */
  onPress: (cb: (a: GameAction) => void) => () => void;
  /** ¿está la acción mantenida ahora mismo? (agacharse, por ejemplo) */
  isDown: (a: GameAction) => boolean;
  onDevice: (cb: (d: Device) => void) => () => void;
  /** llamar una vez por frame para leer el mando */
  poll: () => void;
  hint: () => string;
  destroy: () => void;
};

const KEYS: Record<string, GameAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'action',
  Enter: 'action',
  KeyP: 'pause',
  Escape: 'pause',
};

const HINTS: Record<Scheme, Record<Device, string>> = {
  dpad: {
    keyboard: 'Flechas o WASD · P pausa',
    touch: 'Desliza sobre el juego o usa el pad',
    gamepad: 'Cruceta o stick · Start pausa',
  },
  jump: {
    keyboard: 'Espacio o ↑ saltar · ↓ agacharse · P pausa',
    touch: 'Toca para saltar · mantén AGACHAR',
    gamepad: 'A o ↑ saltar · ↓ agacharse · Start pausa',
  },
};

const SWIPE_MIN = 24; // px

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/**
 * @param surface zona donde se detectan los gestos (el lienzo del juego)
 * @param controlsHost dónde se dibujan los botones táctiles
 */
export function createAdaptiveInput(scheme: Scheme, surface: HTMLElement, controlsHost: HTMLElement): AdaptiveInput {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  let device: Device = coarse || navigator.maxTouchPoints > 0 ? 'touch' : 'keyboard';
  const held = new Set<GameAction>();
  const pressSubs = new Set<(a: GameAction) => void>();
  const deviceSubs = new Set<(d: Device) => void>();

  const setDevice = (d: Device) => {
    if (d === device) return;
    device = d;
    pad.hidden = d !== 'touch';
    deviceSubs.forEach((cb) => cb(d));
  };
  const press = (a: GameAction) => {
    held.add(a);
    pressSubs.forEach((cb) => cb(a));
  };
  const release = (a: GameAction) => void held.delete(a);

  // ── controles táctiles en pantalla ──
  const pad = document.createElement('div');
  pad.className = `touch-ctl touch-ctl-${scheme}`;
  pad.hidden = device !== 'touch';
  const btn = (action: GameAction, label: string, cls: string, holdable: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tc-btn ${cls}`;
    b.textContent = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      setDevice('touch');
      press(action);
      if (!holdable) held.delete(action);
    });
    const up = () => {
      b.classList.remove('on');
      release(action);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    return b;
  };
  if (scheme === 'dpad') {
    pad.append(btn('up', '▲', 'tc-up', false), btn('left', '◀', 'tc-left', false), btn('right', '▶', 'tc-right', false), btn('down', '▼', 'tc-down', false));
  } else {
    pad.append(btn('down', 'AGACHAR', 'tc-duck', true), btn('action', 'SALTAR', 'tc-jump', false));
  }
  controlsHost.append(pad);

  // ── teclado ──
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const a = KEYS[e.code];
    if (!a) return;
    e.preventDefault();
    setDevice('keyboard');
    if (e.repeat) return;
    press(a);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (a) release(a);
  };
  const onBlur = () => held.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ── gestos sobre el juego (deslizar = dirección, tocar = acción) ──
  let start: { x: number; y: number; id: number; t: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setDevice('touch');
    if (e.pointerType === 'mouse') {
      // con ratón, en el juego de saltar un clic es un salto
      if (scheme === 'jump') {
        press('action');
        held.delete('action');
      }
      return;
    }
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id || scheme !== 'dpad') return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    held.delete(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    start = { ...start, x: e.clientX, y: e.clientY }; // permite encadenar giros sin levantar el dedo
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    const quick = performance.now() - start.t < 350;
    start = null;
    if (scheme === 'jump' && moved < SWIPE_MIN && quick) {
      press('action');
      held.delete('action');
    }
  };
  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', () => (start = null));

  // ── mando ──
  const padPrev = new Map<GameAction, boolean>();
  const poll = () => {
    const gp = navigator.getGamepads?.().find((g) => g?.connected);
    if (!gp) return;
    const b = gp.buttons;
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    const now: Record<GameAction, boolean> = {
      up: !!b[12]?.pressed || ay < -0.5,
      down: !!b[13]?.pressed || ay > 0.5,
      left: !!b[14]?.pressed || ax < -0.5,
      right: !!b[15]?.pressed || ax > 0.5,
      action: !!b[0]?.pressed,
      pause: !!b[9]?.pressed,
    };
    for (const a of Object.keys(now) as GameAction[]) {
      const was = padPrev.get(a) ?? false;
      if (now[a] && !was) {
        setDevice('gamepad');
        press(a);
      }
      if (!now[a] && was) release(a);
      padPrev.set(a, now[a]);
    }
  };

  return {
    get device() {
      return device;
    },
    onPress(cb) {
      pressSubs.add(cb);
      return () => void pressSubs.delete(cb);
    },
    isDown: (a) => held.has(a),
    onDevice(cb) {
      deviceSubs.add(cb);
      return () => void deviceSubs.delete(cb);
    },
    poll,
    hint: () => HINTS[scheme][device],
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      pad.remove();
      pressSubs.clear();
      deviceSubs.clear();
    },
  };
}
