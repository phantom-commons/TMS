import type { ExperienceContext } from '../../core/experience-registry';

// Marco común de los juegos arcade: barra superior, marcador, lienzo escalado, avisos y zona de controles.
// Aquí vive el «cámara fija»: si la política de la room la bloquea, el marco anula zoom, pellizco y scroll.

export type Overlay = { title: string; body?: string; button: string; secondary?: { label: string; run: () => void } };

export type GameFrame = {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** dónde se dibujan los botones táctiles */
  controls: HTMLElement;
  /** prepara el contexto para dibujar en unidades lógicas */
  begin: () => void;
  setScore: (n: number) => void;
  setBest: (n: number) => void;
  setHint: (text: string) => void;
  setPaused: (on: boolean) => void;
  /** botón ⏸/▶ de la barra superior */
  onPauseClick: (cb: () => void) => void;
  showOverlay: (o: Overlay, primary: () => void) => void;
  hideOverlay: () => void;
  /** bucle a pantalla: dt en segundos. Devuelve cómo pararlo */
  loop: (cb: (dt: number) => void) => () => void;
  /** se llama al perder el foco o ir a segundo plano */
  onAutoPause: (cb: () => void) => () => void;
  cameraLocked: boolean;
  destroy: () => void;
};

export function createGameFrame(ctx: ExperienceContext, opts: { title: string; logicalW: number; logicalH: number }): GameFrame {
  const cameraLocked = !ctx.can('camera');
  const root = ctx.root;
  root.classList.add('gf-root');
  root.classList.toggle('cam-locked', cameraLocked);
  root.innerHTML = `
    <header class="gf-top">
      <button class="gf-icon gf-back" type="button" aria-label="Volver al menú">←</button>
      <div class="gf-title"></div>
      <span class="gf-lock" title="Cámara fija: esta room no permite mover ni hacer zoom" ${cameraLocked ? '' : 'hidden'}>📷 fija</span>
      <button class="gf-icon gf-pause" type="button" aria-label="Pausa">⏸</button>
    </header>
    <div class="gf-stats"><span>Puntos <b class="gf-score">0</b></span><span>Récord <b class="gf-best">0</b></span></div>
    <div class="gf-area">
      <div class="gf-stage"><canvas class="gf-canvas"></canvas><div class="gf-overlay" hidden></div></div>
    </div>
    <div class="gf-hint"></div>
    <div class="gf-controls"></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  $('.gf-title').textContent = opts.title;
  const canvas = $<HTMLCanvasElement>('.gf-canvas');
  const stage = $<HTMLElement>('.gf-stage');
  const area = $<HTMLElement>('.gf-area');
  const overlay = $<HTMLElement>('.gf-overlay');
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas 2D no disponible');

  let scale = 1;
  const fit = () => {
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    if (aw < 10 || ah < 10) return;
    const k = Math.min(aw / opts.logicalW, ah / opts.logicalH);
    const cssW = Math.floor(opts.logicalW * k);
    const cssH = Math.floor(opts.logicalH * k);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    stage.style.width = `${cssW}px`;
    stage.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = (cssW * dpr) / opts.logicalW;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(area);
  fit();

  // ── cámara fija: ni zoom, ni pellizco, ni scroll, ni menú contextual ──
  const block = (e: Event) => e.preventDefault();
  const blockPinch = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault();
  };
  if (cameraLocked) {
    root.addEventListener('wheel', block, { passive: false });
    root.addEventListener('gesturestart', block);
    root.addEventListener('contextmenu', block);
    root.addEventListener('touchmove', blockPinch, { passive: false });
  }

  const pauseBtn = $<HTMLButtonElement>('.gf-pause');
  const stops = new Set<() => void>();
  const autoSubs = new Set<() => void>();
  const autoPause = () => autoSubs.forEach((cb) => cb());
  const onVis = () => {
    if (document.hidden) autoPause();
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', autoPause);
  $('.gf-back').addEventListener('click', () => ctx.exit());

  let primary: (() => void) | null = null;
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-secondary]')) return;
    primary?.();
  });

  return {
    canvas,
    g,
    controls: $('.gf-controls'),
    begin() {
      g.setTransform(scale, 0, 0, scale, 0, 0);
    },
    setScore: (n) => void ($('.gf-score').textContent = String(n)),
    setBest: (n) => void ($('.gf-best').textContent = String(n)),
    setHint: (t) => void ($('.gf-hint').textContent = t),
    onPauseClick(cb) {
      pauseBtn.addEventListener('click', cb);
    },
    setPaused(on) {
      pauseBtn.textContent = on ? '▶' : '⏸';
      pauseBtn.setAttribute('aria-label', on ? 'Reanudar' : 'Pausa');
    },
    showOverlay(o, run) {
      primary = run;
      overlay.hidden = false;
      overlay.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'gf-card';
      const h = document.createElement('h2');
      h.textContent = o.title;
      card.append(h);
      if (o.body) {
        const p = document.createElement('p');
        p.textContent = o.body;
        card.append(p);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gf-primary';
      b.textContent = o.button;
      card.append(b);
      if (o.secondary) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'gf-secondary';
        s.dataset.secondary = '1';
        s.textContent = o.secondary.label;
        s.onclick = o.secondary.run;
        card.append(s);
      }
      overlay.append(card);
    },
    hideOverlay() {
      primary = null;
      overlay.hidden = true;
    },
    loop(cb) {
      let raf = 0;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        cb(dt);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const stop = () => {
        cancelAnimationFrame(raf);
        stops.delete(stop);
      };
      stops.add(stop);
      return stop;
    },
    onAutoPause(cb) {
      autoSubs.add(cb);
      return () => void autoSubs.delete(cb);
    },
    cameraLocked,
    destroy() {
      stops.forEach((s) => s());
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', autoPause);
      root.classList.remove('gf-root', 'cam-locked');
      root.innerHTML = '';
    },
  };
}
