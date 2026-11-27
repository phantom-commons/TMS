// Lluvia de meteoritos como pantalla completa en Canvas 2D: solo animación (el estado de la historia ya lo decide la sim).
// Sirve de versión ligera mientras no haya escena 3D exterior. Se puede saltar; con «reducir movimiento» dura casi nada.

export type MeteorOpts = { onDone: () => void; durationMs?: number };

export function playMeteors(host: HTMLElement, opts: MeteorOpts): () => void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const total = reduced ? 900 : (opts.durationMs ?? 4200);
  const wrap = document.createElement('div');
  wrap.className = 'story-fx';
  wrap.innerHTML = '<canvas></canvas><p class="story-cap"></p><button type="button" class="story-skip">Saltar</button>';
  host.append(wrap);
  const cv = wrap.querySelector('canvas')!;
  const cap = wrap.querySelector<HTMLElement>('.story-cap')!;
  const g = cv.getContext('2d')!;
  const fit = () => {
    cv.width = Math.max(1, wrap.clientWidth);
    cv.height = Math.max(1, wrap.clientHeight);
  };
  fit();
  // estrellas y meteoros: posiciones fijas a partir de un contador (sin Math.random: la misma escena cada vez)
  const h = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const stars = Array.from({ length: 70 }, (_, i) => ({ x: h(i), y: h(i + 100), r: 0.6 + h(i + 200) * 1.4 }));
  const rocks = Array.from({ length: 26 }, (_, i) => ({ x: h(i + 300), t0: h(i + 400) * 0.75, v: 0.5 + h(i + 500) * 0.6, len: 40 + h(i + 600) * 80 }));
  const start = performance.now();
  let raf = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    wrap.remove();
    opts.onDone();
  };
  const draw = (now: number) => {
    const t = Math.min(1, (now - start) / total);
    const W = cv.width;
    const H = cv.height;
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#cfd8ff';
    for (const s of stars) g.fillRect(s.x * W, s.y * H, s.r, s.r);
    const shake = t > 0.55 ? (t - 0.55) * 18 : 0;
    g.save();
    g.translate(Math.sin(now / 23) * shake, Math.cos(now / 19) * shake);
    for (const r of rocks) {
      const k = (t - r.t0) / (1 - r.t0);
      if (k <= 0) continue;
      const x = r.x * W + k * r.v * W * 0.4 - W * 0.15;
      const y = k * r.v * H * 1.3 - 40;
      g.strokeStyle = 'rgba(255,170,80,0.9)';
      g.lineWidth = 2 + r.v * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - r.len * 0.45, y - r.len);
      g.stroke();
      g.fillStyle = '#ffd9a0';
      g.fillRect(x - 2, y - 2, 5, 5);
    }
    g.restore();
    cap.textContent = t < 0.5 ? 'Algo se acerca…' : t < 0.85 ? 'Impacto' : '';
    if (t > 0.82) {
      g.fillStyle = `rgba(255,255,255,${Math.min(1, (t - 0.82) * 5)})`;
      g.fillRect(0, 0, W, H);
    }
    if (t >= 1) return finish();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  wrap.querySelector('.story-skip')!.addEventListener('click', finish);
  return finish;
}
