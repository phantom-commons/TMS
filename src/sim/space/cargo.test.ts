import { describe, expect, it } from 'vitest';
import { createKV } from '../../core/kv';
import { available, deposit, depositAll, emptyCargo, loadCargo, needsOf, repairFromCargo, saveCargo, spend, withdraw, type Cargo } from './cargo';
import { crash, newShip } from './ship';

const c = (carried: Cargo['carried'], stored: Cargo['stored'] = {}): Cargo => ({ carried, stored });

describe('carga: encima y guardado', () => {
  it('depositar pasa de encima a guardado, sin crear ni perder nada', () => {
    const r = deposit(c({ cable: 3, placa: 1 }), 'cable', 2);
    expect(r).toEqual(c({ cable: 1, placa: 1 }, { cable: 2 }));
    expect(deposit(r, 'cable')).toEqual(c({ placa: 1 }, { cable: 3 }));
  });
  it('no se puede depositar lo que no llevas ni retirar lo que no hay', () => {
    const base = c({ cable: 1 });
    expect(deposit(base, 'placa', 1)).toBe(base);
    expect(withdraw(base, 'cable', 1)).toBe(base);
    expect(deposit(base, 'cable', 0)).toBe(base);
  });
  it('pedir más de lo que hay mueve solo lo que hay', () => {
    expect(deposit(c({ cable: 2 }), 'cable', 9)).toEqual(c({}, { cable: 2 }));
    expect(withdraw(c({}, { cable: 2 }), 'cable', 9)).toEqual(c({ cable: 2 }));
  });
  it('guardar todo vacía lo que llevas; la suma total no cambia', () => {
    const start = c({ cable: 2, placa: 1 }, { cable: 1 });
    const r = depositAll(start);
    expect(r.carried).toEqual({});
    expect(available(r)).toEqual(available(start));
  });
  it('gastar toma primero lo que llevas y luego lo guardado; si no alcanza no toca nada', () => {
    expect(spend(c({ cable: 1 }, { cable: 2 }), { cable: 2 })).toEqual(c({}, { cable: 1 }));
    expect(spend(c({ cable: 1 }), { cable: 2 })).toBeNull();
    const start = c({ cable: 1 });
    spend(start, { cable: 5 });
    expect(start).toEqual(c({ cable: 1 }));
  });
  it('reparar usa piezas de las dos partes y queda lo sobrante', () => {
    const ship = crash(newShip('cargo1'));
    const broken = (['casco', 'energia', 'motor', 'comunicaciones'] as const).filter((m) => !ship.modules[m]);
    let cargo = c({ placa: 1, cable: 1 }, { placa: 3, nucleo: 3, cable: 5 });
    let s = ship;
    for (const m of broken) {
      const r = repairFromCargo(s, m, cargo);
      expect(r.ok, m).toBe(true);
      if (!r.ok) return;
      s = r.ship;
      cargo = r.cargo;
    }
    expect(s.status).toBe('landed');
    const left = available(cargo);
    expect(Object.values(left).every((n) => n >= 0)).toBe(true);
  });
  it('reparar sin piezas falla y no cambia la carga', () => {
    const ship = crash(newShip('cargo2'));
    const m = (['casco', 'motor'] as const).find((x) => !ship.modules[x])!;
    const r = repairFromCargo(ship, m, emptyCargo());
    expect(r).toEqual({ ok: false, reason: 'Te faltan piezas.' });
  });
  it('needsOf cuenta lo de encima y lo guardado', () => {
    expect(needsOf('motor', c({ nucleo: 1 }, { cable: 1 }))).toEqual([{ kind: 'nucleo', need: 1, have: 1 }, { kind: 'cable', need: 2, have: 1 }]);
  });
  it('guardar y cargar; el guardado inválido se limpia', () => {
    const kv = createKV('cargo', null);
    saveCargo(kv, c({ cable: 2 }, { placa: 1 }));
    expect(loadCargo(kv)).toEqual(c({ cable: 2 }, { placa: 1 }));
    kv.set('star.carried.v1', { cable: -1, placa: 1.5, nucleo: 'x', hierro: 2 });
    kv.set('star.stored.v1', 'basura');
    expect(loadCargo(kv)).toEqual(c({ hierro: 2 }));
  });
});
