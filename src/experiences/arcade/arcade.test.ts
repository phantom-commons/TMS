import { describe, expect, it } from 'vitest';
import { createKV } from '../../core/kv';
import { getBest, submitScore } from './scores';
import { createSnake } from './snake/engine';
import { GROUND, PLAYER_X, createRunner } from './runner/engine';

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

describe('snake', () => {
  it('avanza en la dirección actual', () => {
    const s = createSnake(10, 10, () => 0);
    const h = { ...s.state.body[0] };
    expect(s.tick()).toMatch(/moved|ate/);
    expect(s.state.body[0]).toEqual({ x: h.x + 1, y: h.y });
    expect(s.state.body).toHaveLength(3);
  });
  it('ignora el giro de 180° y encadena giros', () => {
    const s = createSnake(10, 10, () => 0);
    s.turn('left');
    s.tick();
    expect(s.state.dir).toBe('right');
    s.turn('up');
    s.turn('left');
    s.tick();
    expect(s.state.dir).toBe('up');
    s.tick();
    expect(s.state.dir).toBe('left');
  });
  it('come, crece y suma punto', () => {
    const s = createSnake(10, 10, () => 0);
    s.state.food = { x: s.state.body[0].x + 1, y: s.state.body[0].y };
    expect(s.tick()).toBe('ate');
    expect(s.state.score).toBe(1);
    expect(s.state.body).toHaveLength(4);
  });
  it('la comida nunca aparece sobre la serpiente', () => {
    for (let i = 0; i < 50; i++) {
      const s = createSnake(6, 6, seq(i / 50, 0.5, 0.99));
      const f = s.state.food!;
      expect(s.state.body.some((p) => p.x === f.x && p.y === f.y)).toBe(false);
    }
  });
  it('muere al chocar con la pared', () => {
    const s = createSnake(6, 6, () => 0);
    let r = 'moved';
    for (let i = 0; i < 10 && r !== 'dead'; i++) r = s.tick();
    expect(r).toBe('dead');
    expect(s.state.alive).toBe(false);
    expect(s.tick()).toBe('idle');
  });
  it('muere al morderse', () => {
    const s = createSnake(10, 10, () => 0);
    s.state.body = [4, 3, 2, 1, 0].map((i) => ({ x: i + 2, y: 5 })).reverse().reverse();
    s.state.body = [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 4, y: 4 }];
    s.state.dir = 'up';
    s.state.food = { x: 0, y: 0 };
    s.turn('right');
    expect(s.tick()).toBe('dead');
  });
  it('puede pisar el hueco que deja la cola', () => {
    const s = createSnake(10, 10, () => 0);
    s.state.body = [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 4 }];
    s.state.dir = 'up';
    s.state.food = { x: 0, y: 0 };
    s.turn('right');
    expect(s.tick()).toBe('moved');
  });
  it('acelera con la puntuación y tiene suelo', () => {
    const s = createSnake(10, 10, () => 0);
    const a = s.interval();
    s.state.score = 10;
    expect(s.interval()).toBeLessThan(a);
    s.state.score = 999;
    expect(s.interval()).toBe(70);
  });
});

describe('runner', () => {
  it('salta y vuelve al suelo', () => {
    const r = createRunner(() => 0.5);
    expect(r.jump()).toBe(true);
    expect(r.jump()).toBe(false); // no hay doble salto
    r.update(0.1);
    expect(r.state.y).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) r.update(0.02);
    expect(r.state.y).toBe(0);
  });
  it('choca con un cactus de frente y deja de contar', () => {
    const r = createRunner(() => 0.5);
    r.state.obstacles.push({ kind: 'cactus', x: PLAYER_X + 10, w: 20, h: 40 });
    r.state.nextIn = 99;
    r.update(0.016);
    expect(r.state.alive).toBe(false);
    const s = r.score();
    r.update(1);
    expect(r.score()).toBe(s);
  });
  it('saltar a tiempo esquiva el cactus', () => {
    const r = createRunner(() => 0.5);
    r.state.obstacles.push({ kind: 'cactus', x: PLAYER_X + 130, w: 20, h: 40 });
    r.state.nextIn = 99;
    r.jump();
    for (let i = 0; i < 90 && r.state.alive; i++) r.update(1 / 60);
    expect(r.state.alive).toBe(true);
  });
  it('agacharse esquiva al pájaro; de pie choca', () => {
    const bird = { kind: 'bird' as const, x: PLAYER_X + 8, w: 34, h: 18, y: 26 };
    const standing = createRunner(() => 0.5);
    standing.state.obstacles.push({ ...bird });
    standing.state.nextIn = 99;
    standing.update(0.016);
    expect(standing.state.alive).toBe(false);

    const ducking = createRunner(() => 0.5);
    ducking.duck(true);
    ducking.state.obstacles.push({ ...bird });
    ducking.state.nextIn = 99;
    ducking.update(0.016);
    expect(ducking.state.alive).toBe(true);
  });
  it('genera obstáculos y acelera sin pasar del máximo', () => {
    const r = createRunner(() => 0.5);
    r.update(1.5);
    expect(r.state.obstacles.length).toBeGreaterThan(0);
    for (let i = 0; i < 600 && r.state.alive; i++) { r.state.obstacles = []; r.update(0.1); }
    expect(r.state.speed).toBeLessThanOrEqual(620);
    expect(GROUND).toBeGreaterThan(0);
  });
});

describe('récords', () => {
  it('solo guarda si mejora', () => {
    const kv = createKV('t', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    expect(getBest(kv, 'snake')).toBe(0);
    expect(submitScore(kv, 'snake', 12)).toEqual({ best: 12, isRecord: true });
    expect(submitScore(kv, 'snake', 7)).toEqual({ best: 12, isRecord: false });
    expect(submitScore(kv, 'snake', 12)).toEqual({ best: 12, isRecord: false });
    expect(getBest(kv, 'runner')).toBe(0);
  });
});
