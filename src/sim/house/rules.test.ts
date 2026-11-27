import { describe, expect, it } from 'vitest';
import { defsFromObjects, starterHouse } from './starter';
import { detectEvents, runAction, runRules, type Rule } from './rules';
import { stepHouse, type HouseState } from './state';
import { objectId } from '../../core/objects';

const { state: base, objects } = starterHouse('semilla');
const defs = defsFromObjects(objects);
const lamp = objects.find((o) => o.name === 'Lámpara');
const lampKind = lamp ? objectId(lamp) : '';

describe('reglas de la room', () => {
  it('pisar una casilla dispara «step» solo al llegar', () => {
    let s: HouseState = base;
    s = { ...s, player: { cx: 4, cy: 6, fromX: 4, fromY: 6, moveLeft: 0 } };
    const n = stepHouse(s, { move: 0 }, defs);
    expect(detectEvents(s, n, defs)).toEqual([{ t: 'step', cx: 4, cy: 5 }]);
    expect(detectEvents(n, stepHouse(n, {}, defs), defs)).toEqual([]);
  });
  it('«Usar» mirando a un mueble da su clase', () => {
    expect(lampKind).not.toBe('');
    const lampObj = base.objects.find((o) => o.kind === lampKind)!;
    const cx = Math.floor(lampObj.x / 8);
    const cy = Math.floor(lampObj.y / 8);
    const s = { ...base, player: { cx, cy: cy + 1, fromX: cx, fromY: cy + 1, moveLeft: 0 } };
    expect(detectEvents(s, s, defs, 0)).toEqual([{ t: 'use', kind: lampKind }]);
    expect(detectEvents(s, s, defs, 2)).toEqual([]);
  });
  it('las acciones son puras y deterministas', () => {
    const rules: Rule[] = [
      { id: 1, when: { t: 'enter' }, then: { t: 'say', text: 'Hola' } },
      { id: 2, when: { t: 'enter' }, then: { t: 'recolor', seed: 'otra' } },
      { id: 3, when: { t: 'step', cx: 1, cy: 1 }, then: { t: 'goto', cx: 0, cy: 0 } },
    ];
    const a = runRules(base, rules, [{ t: 'enter' }], defs);
    const b = runRules(base, rules, [{ t: 'enter' }], defs);
    expect(a).toEqual(b);
    expect(a.says).toEqual(['Hola']);
    expect(a.state.seed).toBe('otra');
    expect(base.seed).toBe('semilla');
  });
  it('goto nunca te mete en un mueble', () => {
    const bed = base.objects[1]!;
    const r = runAction(base, { t: 'goto', cx: Math.floor(bed.x / 8), cy: Math.floor(bed.y / 8) }, defs);
    const p = r.state.player;
    expect(p.moveLeft).toBe(0);
    expect(stepHouse(r.state, {}, defs).player.cx).toBe(p.cx);
  });
});
