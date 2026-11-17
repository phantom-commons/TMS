import { describe, expect, it } from 'vitest';
import { createKV } from '../../core/kv';
import { getBest, submitScore } from './scores';
import { createSnake } from './snake/engine';

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
