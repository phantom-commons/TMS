import { ZERO, toDir8, type InputSource, type Vec } from './controller';

export function createTouchPad(): InputSource {
  const isTouchDevice =
    window.matchMedia('(pointer: coarse)').matches ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

  if (!isTouchDevice) {
    return { read: () => ZERO, dispose() {} };
  }

  const pad = document.createElement('div');
  pad.className = 'touch-pad';

  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  pad.appendChild(knob);
  document.body.appendChild(pad);

  let vec: Vec = ZERO;
  let active: number | null = null;

  const update = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    const maxRadius = r.width * 0.32;
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    vec = toDir8(nx, ny, 0.25);
    const len = Math.min(1, Math.hypot(nx, ny));
    const a = Math.atan2(ny, nx);
    knob.style.transform = `translate(${Math.cos(a) * len * maxRadius}px, ${Math.sin(a) * len * maxRadius}px)`;
  };

  const end = (e?: PointerEvent) => {
    if (e && active !== null && pad.hasPointerCapture(e.pointerId)) {
      pad.releasePointerCapture(e.pointerId);
    }
    active = null;
    vec = ZERO;
    knob.style.transform = '';
  };

  pad.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    active = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    update(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) {
      e.stopPropagation();
      update(e);
    }
  });
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  return { read: () => vec, dispose: () => pad.remove() };
}