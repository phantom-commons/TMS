import { ZERO, toDir8, type InputSource, type Vec } from './controller';

export function createTouchPad(): InputSource {
  if (!window.matchMedia('(pointer: coarse)').matches) {
    return { read: () => ZERO, dispose() {} };
  }

  const pad = document.createElement('div');
  Object.assign(pad.style, {
    position: 'fixed', left: '24px', bottom: '24px', width: '140px', height: '140px',
    borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.25)', touchAction: 'none',
    userSelect: 'none', zIndex: '10',
  } as Partial<CSSStyleDeclaration>);

  const knob = document.createElement('div');
  Object.assign(knob.style, {
    position: 'absolute', left: '50%', top: '50%', width: '56px', height: '56px',
    marginLeft: '-28px', marginTop: '-28px', borderRadius: '50%',
    background: 'rgba(155,123,255,0.6)', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  pad.appendChild(knob);
  document.body.appendChild(pad);

  let vec: Vec = ZERO;
  let active: number | null = null;

  const update = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    vec = toDir8(nx, ny, 0.3);
    const len = Math.min(1, Math.hypot(nx, ny));
    const a = Math.atan2(ny, nx);
    knob.style.transform = `translate(${Math.cos(a) * len * 42}px, ${Math.sin(a) * len * 42}px)`;
  };
  const end = () => {
    active = null;
    vec = ZERO;
    knob.style.transform = '';
  };

  pad.addEventListener('pointerdown', (e) => {
    active = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    update(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) update(e);
  });
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  return { read: () => vec, dispose: () => pad.remove() };
}