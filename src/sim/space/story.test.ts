import { describe, expect, it } from 'vitest';
import { createKV } from '../../core/kv';
import { crash, newShip, repair } from './ship';
import { advance, initialStory, loadStory, objectives, planetOpen, reconcileShip, saveStory, STEPS, TUTORIAL_GOALS, validateStory, type Fact, type Story } from './story';

const run = (s: Story, facts: Fact[]): Story => facts.reduce((acc, f) => advance(acc, f).story, s);
const ALL: Fact[] = [{ t: 'moved' }, { t: 'looked' }, { t: 'used' }, { t: 'atHatch' }];

describe('historia', () => {
  it('empieza en el tutorial sin objetivos hechos', () => {
    expect(initialStory()).toEqual({ v: 1, step: 'tutorial', done: [] });
  });
  it('el tutorial se completa con los cuatro hechos, en cualquier orden, y los repetidos no cuentan', () => {
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2]]) {
      let s = initialStory();
      for (const i of order.slice(0, 3)) {
        const r = advance(s, ALL[i]!);
        expect(r.story.step).toBe('tutorial');
        s = r.story;
      }
      expect(advance(s, ALL[order[0]!]!).changed).toBe(false);
      expect(advance(s, ALL[order[3]!]!).story.step).toBe('salir');
    }
  });
  it('se puede saltar el tutorial y queda todo marcado', () => {
    const r = advance(initialStory(), { t: 'skipTutorial' });
    expect(r.story).toEqual({ v: 1, step: 'salir', done: [...TUTORIAL_GOALS] });
  });
  it('no se salta ningún paso: los hechos de otro paso se ignoran', () => {
    const s = initialStory();
    for (const f of [{ t: 'exited' }, { t: 'meteorsDone' }, { t: 'landed' }, { t: 'repaired' }] as Fact[]) expect(advance(s, f).changed).toBe(false);
    expect(advance(run(s, ALL), { t: 'meteorsDone' }).changed).toBe(false);
    expect(advance(run(s, [...ALL, { t: 'exited' }]), { t: 'landed' }).changed).toBe(false);
  });
  it('recorrido completo: de tutorial a lista, y la caída pide estrellar la nave una sola vez', () => {
    let s = run(initialStory(), [...ALL, { t: 'exited' }]);
    expect(s.step).toBe('meteoritos');
    const r = advance(s, { t: 'meteorsDone' });
    expect(r.story.step).toBe('caida');
    expect(r.effects).toEqual([{ t: 'crash' }]);
    expect(advance(r.story, { t: 'meteorsDone' }).effects).toEqual([]);
    s = advance(r.story, { t: 'landed' }).story;
    expect(s.step).toBe('reparar');
    let ship = crash(newShip('hist'));
    expect(advance(s, { t: 'repaired' }, ship).changed).toBe(false); // faltan módulos
    for (const m of ['casco', 'energia', 'motor', 'comunicaciones'] as const) {
      if (ship.modules[m]) continue;
      const rr = repair(ship, m, { placa: 9, nucleo: 9, cable: 9 });
      if (rr.ok) ship = rr.ship;
    }
    expect(advance(s, { t: 'repaired' }, ship).story.step).toBe('lista');
  });
  it('recargar a mitad no pierde progreso (guardado y lectura)', () => {
    const kv = createKV('story', null);
    const s = run(initialStory(), [{ t: 'moved' }, { t: 'looked' }]);
    saveStory(kv, s);
    expect(loadStory(kv)).toEqual(s);
    const s2 = run(initialStory(), [...ALL, { t: 'exited' }]);
    saveStory(kv, s2);
    expect(loadStory(kv)).toEqual(s2);
  });
  it('un guardado inválido vuelve al inicio', () => {
    for (const bad of [null, 7, {}, { v: 2, step: 'lista', done: [] }, { v: 1, step: 'inventado', done: [] }, { v: 1, step: 'lista', done: 3 }]) expect(validateStory(bad)).toEqual(initialStory());
  });
  it('un guardado con objetivos falsos se limpia; pasado el tutorial todo cuenta como hecho', () => {
    expect(validateStory({ v: 1, step: 'tutorial', done: ['mover', 'volar'] }).done).toEqual(['mover']);
    expect(validateStory({ v: 1, step: 'reparar', done: [] }).done).toEqual([...TUTORIAL_GOALS]);
  });
  it('la nave coincide con el paso: desde la caída está en el suelo', () => {
    const flying = newShip('rec');
    expect(reconcileShip(initialStory(), flying).status).toBe('flying');
    const late = { v: 1 as const, step: 'reparar' as const, done: [...TUTORIAL_GOALS] };
    const fixed = reconcileShip(late, flying);
    expect(fixed.status).toBe('crashed');
    expect(reconcileShip(late, fixed)).toBe(fixed);
  });
  it('el planeta solo está abierto desde la caída', () => {
    expect(STEPS.map((step) => planetOpen({ v: 1, step, done: [] }))).toEqual([false, false, false, true, true, true]);
  });
  it('los objetivos cambian con los controles y se marcan al cumplirse', () => {
    const o1 = objectives(initialStory(), 'touch');
    const o2 = objectives(initialStory(), 'keys');
    expect(o1).toHaveLength(4);
    expect(o1[0]!.text).not.toBe(o2[0]!.text);
    expect(objectives(run(initialStory(), [{ t: 'moved' }]), 'touch').filter((o) => o.done).map((o) => o.id)).toEqual(['mover']);
    expect(objectives({ v: 1, step: 'reparar', done: [...TUTORIAL_GOALS] })).toHaveLength(1);
  });
});
