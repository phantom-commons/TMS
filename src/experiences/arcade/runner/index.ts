import type { ExperienceFactory } from '../../../core/experience-registry';
import { createAdaptiveInput } from '../../../input/adaptive';
import { createGameFrame } from '../game-frame';
import { getBest, submitScore } from '../scores';
import { DUCK, GROUND, H, PLAYER_X, STAND, W, createRunner, obstacleBox, type Runner } from './engine';

export const mountRunner: ExperienceFactory = (ctx) => {
  const frame = createGameFrame(ctx, { title: '🦖 Salto', logicalW: W, logicalH: H });
  const input = createAdaptiveInput('jump', frame.canvas, frame.controls);
  const { g } = frame;

  let game: Runner = createRunner();
  let phase: 'ready' | 'playing' | 'paused' | 'over' = 'ready';
  let best = getBest(ctx.kv, 'runner');
  let t = 0;
  let scroll = 0;
  let shownScore = -1;
  frame.setBest(best);

  const refreshHint = () => frame.setHint(input.hint());
  refreshHint();
  input.onDevice(refreshHint);

  const start = () => {
    game = createRunner();
    phase = 'playing';
    shownScore = -1;
    frame.setPaused(false);
    frame.hideOverlay();
    game.jump();
  };
  const pause = () => {
    if (phase !== 'playing') return;
    phase = 'paused';
    frame.setPaused(true);
    frame.showOverlay({ title: 'Pausa', body: 'Pulsa P, espacio o toca para seguir.', button: 'Continuar' }, resume);
  };
  const resume = () => {
    if (phase !== 'paused') return;
    phase = 'playing';
    frame.setPaused(false);
    frame.hideOverlay();
  };
  const gameOver = () => {
    phase = 'over';
    const { best: b, isRecord } = submitScore(ctx.kv, 'runner', game.score());
    best = b;
    frame.setBest(best);
    frame.showOverlay(
      {
        title: isRecord ? '¡Nuevo récord!' : 'Has chocado',
        body: `${game.score()} metros · récord ${best}`,
        button: 'Intentar otra vez',
        secondary: { label: 'Salir', run: () => ctx.exit() },
      },
      start,
    );
  };
  frame.showOverlay(
    { title: 'Salto', body: 'Salta los cactus y agáchate bajo los pájaros.', button: 'Empezar', secondary: { label: 'Salir', run: () => ctx.exit() } },
    start,
  );

  input.onPress((a) => {
    if (a === 'pause') return phase === 'playing' ? pause() : resume();
    if (phase === 'ready' || phase === 'over') {
      if (a === 'action' || a === 'up') start();
      return;
    }
    if (phase === 'paused') return a === 'action' || a === 'up' ? resume() : undefined;
    if (a === 'action' || a === 'up') game.jump();
  });
  frame.onPauseClick(() => (phase === 'playing' ? pause() : resume()));
  const offAuto = frame.onAutoPause(pause);

  const draw = () => {
    frame.begin();
    const s = game.state;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#171a26');
    sky.addColorStop(1, '#262a3f');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 18; i++) {
      const x = (((i * 97) % W) - scroll * 0.08 + W * 4) % W;
      g.fillRect(x, 20 + ((i * 53) % 110), 2, 2);
    }
    g.fillStyle = 'rgba(155,123,255,0.14)';
    for (let i = 0; i < 3; i++) {
      const x = (((i * 220) - scroll * 0.25 + W * 4) % (W + 120)) - 60;
      g.beginPath();
      g.roundRect(x, 44 + i * 26, 90, 14, 7);
      g.fill();
    }

    g.fillStyle = '#2f3550';
    g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = '#4a5280';
    g.fillRect(0, GROUND, W, 2);
    g.fillStyle = '#3b4266';
    for (let i = 0; i < 22; i++) g.fillRect(((i * 61 - scroll + W * 8) % (W + 40)) - 20, GROUND + 12 + (i % 3) * 12, 14, 2);

    for (const o of s.obstacles) {
      const b = obstacleBox(o);
      if (o.kind === 'cactus') {
        g.fillStyle = '#4fbf86';
        g.beginPath();
        g.roundRect(b.x, b.y, b.w, b.h, 4);
        g.fill();
        g.fillRect(b.x - 5, b.y + b.h * 0.35, 6, 4);
        g.fillRect(b.x - 5, b.y + b.h * 0.2, 4, b.h * 0.2);
        g.fillRect(b.x + b.w - 1, b.y + b.h * 0.5, 6, 4);
        g.fillRect(b.x + b.w + 1, b.y + b.h * 0.3, 4, b.h * 0.22);
      } else {
        const flap = Math.sin(t / 70) > 0 ? -8 : 6;
        g.fillStyle = '#ff9f6b';
        g.beginPath();
        g.roundRect(b.x, b.y + 4, b.w, b.h - 6, 6);
        g.fill();
        g.beginPath();
        g.moveTo(b.x + 8, b.y + 6);
        g.lineTo(b.x + 18, b.y + flap);
        g.lineTo(b.x + 26, b.y + 6);
        g.fill();
        g.fillStyle = '#111318';
        g.fillRect(b.x + 4, b.y + 8, 3, 3);
      }
    }

    const ducking = s.ducking && s.y === 0;
    const dim = ducking ? DUCK : STAND;
    const px = PLAYER_X;
    const py = GROUND - s.y - dim.h;
    g.fillStyle = s.alive ? '#9b7bff' : '#ff6b8a';
    g.beginPath();
    g.roundRect(px, py, dim.w, dim.h - 6, 8);
    g.fill();
    g.fillStyle = '#d9ccff';
    g.fillRect(px + dim.w - 12, py + 6, 8, 8);
    g.fillStyle = '#111318';
    g.fillRect(px + dim.w - 8, py + 8, 3, 3);
    // piernas: alternan solo corriendo
    g.fillStyle = s.alive ? '#7d5ee0' : '#e0506f';
    const step = s.y === 0 && s.alive && Math.sin(t / 60) > 0;
    g.fillRect(px + 5, py + dim.h - 7, 6, step ? 7 : 4);
    g.fillRect(px + dim.w - 11, py + dim.h - 7, 6, step ? 4 : 7);
  };

  const stop = frame.loop((dt) => {
    input.poll();
    t += dt * 1000;
    if (phase === 'playing') {
      game.duck(input.isDown('down'));
      game.update(dt);
      scroll += game.state.speed * dt;
      const sc = game.score();
      if (sc !== shownScore) {
        shownScore = sc;
        frame.setScore(sc);
      }
      if (!game.state.alive) gameOver();
    }
    draw();
  });

  return {
    destroy() {
      stop();
      offAuto();
      input.destroy();
      frame.destroy();
    },
  };
};
