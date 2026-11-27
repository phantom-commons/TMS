import type { ExperienceFactory } from '../../../core/experience-registry';
import { createAdaptiveInput } from '../../../input/adaptive';
import { FP, createSim, playerDims, scoreOf, stepSim, type Sim } from '../../../sim/nodes/engine';
import { createGameFrame } from '../game-frame';
import { openRulesPanel } from '../rules-panel';
import { getBest, submitScore } from '../scores';
import { loadRules, resetRules, saveRules, scoreIdFor } from './rules';

// «Salto» ya no tiene motor propio: es un manifiesto de nodos (sim/nodes/presets/runner.ts) que corre en la sim
// entera. Este archivo solo traduce teclas/toques a entradas, avanza ticks fijos y dibuja el estado.

const JUMP_BUFFER_TICKS = 6; // un salto pulsado justo antes de aterrizar cuenta (~100 ms)

export const mountRunner: ExperienceFactory = (ctx) => {
  let manifest = loadRules(ctx.kv);
  // el tamaño del lienzo se fija al montar; por eso el panel no deja tocar resolución ni tamaño del mundo
  const probe = createSim(manifest, 1);
  const W = probe.cfg.worldW;
  const H = probe.cfg.worldH;

  const frame = createGameFrame(ctx, { title: 'Salto', logicalW: W, logicalH: H });
  const input = createAdaptiveInput('jump', frame.canvas, frame.controls);
  const { g } = frame;

  let game: Sim = probe;
  let phase: 'ready' | 'playing' | 'paused' | 'over' = 'ready';
  let scoreId = scoreIdFor(manifest);
  let best = getBest(ctx.kv, scoreId);
  let t = 0;
  let acc = 0;
  let jumpBuffer = 0;
  let shownScore = -1;
  let rulesOpen: { close: () => void } | null = null;
  frame.setBest(best);

  const refreshHint = () => frame.setHint(input.hint());
  refreshHint();
  input.onDevice(refreshHint);

  const customNote = () => (scoreIdFor(manifest) === 'runner' ? '' : ' · reglas personalizadas');

  const start = () => {
    manifest = loadRules(ctx.kv);
    scoreId = scoreIdFor(manifest);
    best = getBest(ctx.kv, scoreId);
    frame.setBest(best);
    game = createSim(manifest, (Math.random() * 4294967296) >>> 0);
    phase = 'playing';
    shownScore = -1;
    acc = 0;
    jumpBuffer = JUMP_BUFFER_TICKS; // empezar saltando, como antes
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
  const openRules = () => {
    if (rulesOpen) return;
    rulesOpen = openRulesPanel(ctx.root, {
      title: 'Reglas de Salto',
      manifest,
      // el lienzo ya está montado con este tamaño: resolución y casillas no se tocan en caliente
      hide: (scope, node, key) => scope === 'world' && node.type === 'world' && ['resolution', 'cols', 'rows'].includes(key),
      onCommit: (m) => {
        manifest = m;
        saveRules(ctx.kv, m);
      },
      onReset: () => {
        manifest = resetRules(ctx.kv);
        ctx.toast('Reglas restablecidas');
      },
      onClose: () => {
        rulesOpen = null;
        showIntro();
      },
    });
  };
  const showIntro = () => {
    scoreId = scoreIdFor(manifest);
    best = getBest(ctx.kv, scoreId);
    frame.setBest(best);
    frame.showOverlay(
      {
        title: 'Salto',
        body: `Salta los cactus y agáchate bajo los pájaros${customNote()}.`,
        button: 'Empezar',
        extra: { label: 'Reglas', run: openRules },
        secondary: { label: 'Salir', run: () => ctx.exit() },
      },
      start,
    );
  };
  const gameOver = () => {
    phase = 'over';
    const { best: b, isRecord } = submitScore(ctx.kv, scoreId, scoreOf(game));
    best = b;
    frame.setBest(best);
    frame.showOverlay(
      {
        title: isRecord ? '¡Nuevo récord!' : 'Has chocado',
        body: `${scoreOf(game)} metros · récord ${best}${customNote()}`,
        button: 'Intentar otra vez',
        extra: { label: 'Reglas', run: openRules },
        secondary: { label: 'Salir', run: () => ctx.exit() },
      },
      start,
    );
  };
  showIntro();

  input.onPress((a) => {
    if (rulesOpen) return;
    if (a === 'pause') return phase === 'playing' ? pause() : resume();
    if (phase === 'ready' || phase === 'over') {
      if (a === 'action' || a === 'up') start();
      return;
    }
    if (phase === 'paused') return a === 'action' || a === 'up' ? resume() : undefined;
    if (a === 'action' || a === 'up') jumpBuffer = JUMP_BUFFER_TICKS;
  });
  frame.onPauseClick(() => (phase === 'playing' ? pause() : resume()));
  const offAuto = frame.onAutoPause(pause);

  // ───────── dibujo (desde el estado entero; aquí sí se divide por FP) ─────────
  const draw = () => {
    frame.begin();
    const { cfg, state: s } = game;
    const ground = H - cfg.groundH;
    const scroll = s.distance / FP;

    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#171a26');
    sky.addColorStop(1, '#262a3f');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 18; i++) {
      const x = (((i * 97) % W) - scroll * 0.08 + W * 4000) % W;
      g.fillRect(x, 20 + ((i * 53) % 110), 2, 2);
    }
    g.fillStyle = 'rgba(155,123,255,0.14)';
    for (let i = 0; i < 3; i++) {
      const x = ((i * 220 - scroll * 0.25 + W * 4000) % (W + 120)) - 60;
      g.beginPath();
      g.roundRect(x, 44 + i * 26, 90, 14, 7);
      g.fill();
    }

    g.fillStyle = '#2f3550';
    g.fillRect(0, ground, W, H - ground);
    g.fillStyle = '#4a5280';
    g.fillRect(0, ground, W, 2);
    g.fillStyle = '#3b4266';
    for (let i = 0; i < 22; i++) g.fillRect(((i * 61 - scroll + W * 8000) % (W + 40)) - 20, ground + 12 + (i % 3) * 12, 14, 2);

    for (const o of s.objects) {
      const bx = o.x / FP;
      const bw = o.w;
      const bh = o.h;
      const by = ground - o.y / FP - bh;
      if (o.prefab === 'cactus') {
        g.fillStyle = '#4fbf86';
        g.beginPath();
        g.roundRect(bx, by, bw, bh, 4);
        g.fill();
        g.fillRect(bx - 5, by + bh * 0.35, 6, 4);
        g.fillRect(bx - 5, by + bh * 0.2, 4, bh * 0.2);
        g.fillRect(bx + bw - 1, by + bh * 0.5, 6, 4);
        g.fillRect(bx + bw + 1, by + bh * 0.3, 4, bh * 0.22);
      } else if (o.prefab === 'bird') {
        const flap = Math.sin(t / 70) > 0 ? -8 : 6;
        g.fillStyle = '#ff9f6b';
        g.beginPath();
        g.roundRect(bx, by + 4, bw, bh - 6, 6);
        g.fill();
        g.beginPath();
        g.moveTo(bx + 8, by + 6);
        g.lineTo(bx + 18, by + flap);
        g.lineTo(bx + 26, by + 6);
        g.fill();
        g.fillStyle = '#111318';
        g.fillRect(bx + 4, by + 8, 3, 3);
      } else {
        g.fillStyle = '#e0b84f'; // objeto sin dibujo propio
        g.beginPath();
        g.roundRect(bx, by, bw, bh, 4);
        g.fill();
      }
    }

    const dim = playerDims(game);
    const px = cfg.player.xFp / FP;
    const py = ground - s.py / FP - dim.h;
    const hurt = s.invuln > 0 && Math.floor(s.tick / 4) % 2 === 0; // parpadea mientras es invulnerable
    g.globalAlpha = hurt ? 0.35 : 1;
    g.fillStyle = s.alive ? '#9b7bff' : '#ff6b8a';
    g.beginPath();
    g.roundRect(px, py, dim.w, dim.h - 6, 8);
    g.fill();
    g.fillStyle = '#d9ccff';
    g.fillRect(px + dim.w - 12, py + 6, 8, 8);
    g.fillStyle = '#111318';
    g.fillRect(px + dim.w - 8, py + 8, 3, 3);
    g.fillStyle = s.alive ? '#7d5ee0' : '#e0506f';
    const step = s.py === 0 && s.alive && Math.sin(t / 60) > 0;
    g.fillRect(px + 5, py + dim.h - 7, 6, step ? 7 : 4);
    g.fillRect(px + dim.w - 11, py + dim.h - 7, 6, step ? 4 : 7);
    g.globalAlpha = 1;

    // vida, solo si hay más de una
    if (cfg.player.hpMax > 1) {
      g.fillStyle = '#ff6b8a';
      for (let i = 0; i < s.hp; i++) g.fillRect(12 + i * 14, 12, 10, 10);
    }
  };

  const stop = frame.loop((dt) => {
    input.poll();
    t += dt * 1000;
    if (phase === 'playing') {
      // ticks fijos: la sim avanza igual en una pantalla de 60 o de 144 Hz
      const step = 1 / game.cfg.tickRate;
      acc += dt;
      while (acc >= step && game.state.alive) {
        acc -= step;
        const wasGround = game.state.py === 0 && game.state.vy === 0;
        stepSim(game, { jump: jumpBuffer > 0, duck: input.isDown('down') });
        if (jumpBuffer > 0) jumpBuffer = wasGround && game.state.vy > 0 ? 0 : jumpBuffer - 1;
      }
      const sc = scoreOf(game);
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
      rulesOpen?.close();
      input.destroy();
      frame.destroy();
    },
  };
};
