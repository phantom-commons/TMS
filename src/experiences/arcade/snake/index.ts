import type { ExperienceFactory } from '../../../core/experience-registry';
import { createAdaptiveInput, type GameAction } from '../../../input/adaptive';
import { createGameFrame } from '../game-frame';
import { getBest, submitScore } from '../scores';
import { createSnake, type Dir, type Snake } from './engine';

const COLS = 16;
const ROWS = 16;
const CELL = 20;
const SIZE = COLS * CELL;

const DIRS: Partial<Record<GameAction, Dir>> = { up: 'up', down: 'down', left: 'left', right: 'right' };

export const mountSnake: ExperienceFactory = (ctx) => {
  const frame = createGameFrame(ctx, { title: '🐍 Snake', logicalW: SIZE, logicalH: SIZE });
  const input = createAdaptiveInput('dpad', frame.canvas, frame.controls);
  const { g } = frame;

  let game: Snake = createSnake(COLS, ROWS);
  let phase: 'ready' | 'playing' | 'paused' | 'over' = 'ready';
  let acc = 0;
  let best = getBest(ctx.kv, 'snake');
  let blink = 0;
  frame.setBest(best);

  const refreshHint = () => frame.setHint(input.hint());
  refreshHint();
  input.onDevice(refreshHint);

  const start = () => {
    game = createSnake(COLS, ROWS);
    acc = 0;
    phase = 'playing';
    frame.setScore(0);
    frame.setPaused(false);
    frame.hideOverlay();
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
    const { best: b, isRecord } = submitScore(ctx.kv, 'snake', game.state.score);
    best = b;
    frame.setBest(best);
    frame.showOverlay(
      {
        title: game.state.won ? '¡Tablero completo!' : isRecord ? '¡Nuevo récord!' : 'Game over',
        body: `${game.state.score} puntos · récord ${best}`,
        button: 'Jugar otra vez',
        secondary: { label: 'Salir', run: () => ctx.exit() },
      },
      start,
    );
  };
  const intro = () =>
    frame.showOverlay(
      { title: 'Snake', body: 'Come, crece y no choques con las paredes ni contigo.', button: 'Empezar', secondary: { label: 'Salir', run: () => ctx.exit() } },
      start,
    );
  intro();

  input.onPress((a) => {
    if (phase === 'ready' || phase === 'over') {
      if (a === 'pause') return;
      start();
      const d = DIRS[a];
      if (d) game.turn(d);
      return;
    }
    if (a === 'pause') return phase === 'playing' ? pause() : resume();
    if (phase === 'paused') return a === 'action' ? resume() : undefined;
    const d = DIRS[a];
    if (d) game.turn(d);
  });
  frame.onPauseClick(() => (phase === 'playing' ? pause() : resume()));
  const offAuto = frame.onAutoPause(pause);

  const draw = (t: number) => {
    frame.begin();
    const s = game.state;
    g.fillStyle = '#0f1218';
    g.fillRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#151a23';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if ((x + y) % 2 === 0) g.fillRect(x * CELL, y * CELL, CELL, CELL);

    if (s.food) {
      const pulse = 1 + Math.sin(t / 180) * 0.08;
      g.fillStyle = '#ff6b8a';
      g.beginPath();
      g.arc(s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, (CELL / 2 - 3) * pulse, 0, Math.PI * 2);
      g.fill();
    }
    s.body.forEach((p, i) => {
      const k = 1 - i / (s.body.length + 6);
      g.fillStyle = i === 0 ? '#d9ccff' : `rgba(155,123,255,${0.45 + 0.55 * k})`;
      g.beginPath();
      g.roundRect(p.x * CELL + 1.5, p.y * CELL + 1.5, CELL - 3, CELL - 3, i === 0 ? 7 : 5);
      g.fill();
    });
    const h = s.body[0];
    g.fillStyle = s.alive ? '#111318' : '#ff6b8a';
    const ex = s.dir === 'left' ? -3 : s.dir === 'right' ? 3 : 0;
    const ey = s.dir === 'up' ? -3 : s.dir === 'down' ? 3 : 0;
    const px = s.dir === 'up' || s.dir === 'down' ? 4 : 0;
    const py = s.dir === 'left' || s.dir === 'right' ? 4 : 0;
    for (const sign of [-1, 1]) {
      g.beginPath();
      g.arc(h.x * CELL + CELL / 2 + ex + px * sign, h.y * CELL + CELL / 2 + ey + py * sign, 2, 0, Math.PI * 2);
      g.fill();
    }
  };

  const stop = frame.loop((dt) => {
    input.poll();
    blink += dt * 1000;
    if (phase === 'playing') {
      acc += dt * 1000;
      while (phase === 'playing' && acc >= game.interval()) {
        acc -= game.interval();
        const r = game.tick();
        if (r === 'ate') frame.setScore(game.state.score);
        if (r === 'dead' || r === 'won') {
          frame.setScore(game.state.score);
          gameOver();
        }
      }
    }
    draw(blink);
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
