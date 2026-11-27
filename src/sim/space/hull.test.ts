import { describe, expect, it } from 'vitest';
import { clearDistance } from './camera';
import { crash, HULL_D, HULL_MASK, HULL_W, hatchCell, hullCells, hullVoxels, MODULE_IDS, MODULES, newShip, repair, salvage } from './ship';
import { findSpawn, openSpace } from './world';

describe('casco en voxels', () => {
  it('es determinista y cabe en la huella del casco', () => {
    const ship = crash(newShip('h1'));
    expect(hullVoxels(ship)).toEqual(hullVoxels(ship));
    for (const v of hullVoxels(ship)) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThan(HULL_W);
      expect(v.z).toBeGreaterThanOrEqual(0);
      expect(v.z).toBeLessThan(HULL_D);
      expect(v.y).toBeGreaterThanOrEqual(0);
    }
  });
  it('no hay dos voxels en la misma posición', () => {
    for (const seed of ['a', 'b', 'c']) {
      const v = hullVoxels(crash(newShip(seed)));
      expect(new Set(v.map((p) => `${p.x},${p.y},${p.z}`)).size).toBe(v.length);
    }
  });
  it('el daño se ve: la nave estrellada tiene menos voxels y quemados; la sana ninguno', () => {
    const ok = hullVoxels(newShip('h2'));
    const bad = hullVoxels(crash(newShip('h2')));
    expect(ok.some((v) => v.tone === 'quemado')).toBe(false);
    expect(bad.some((v) => v.tone === 'quemado')).toBe(true);
    expect(bad.length).toBeLessThan(ok.length + 1);
    expect(ok.filter((v) => v.tone === 'motor')).toHaveLength(4);
  });
  it('reparar el casco y el motor quita los agujeros y las quemaduras de esas zonas', () => {
    let s = crash(newShip('h3'));
    const before = hullVoxels(s).filter((v) => v.tone === 'quemado').length;
    const full = { placa: 9, nucleo: 9, cable: 9 };
    for (const m of ['casco', 'motor', 'energia', 'comunicaciones'] as const) {
      if (s.modules[m]) continue;
      const r = repair(s, m, full);
      if (r.ok) s = r.ship;
    }
    expect(hullVoxels(s).filter((v) => v.tone === 'quemado')).toHaveLength(0);
    expect(before).toBeGreaterThan(0);
    expect(hullVoxels(s).some((v) => v.tone === 'antena')).toBe(true);
  });
});

describe('silueta', () => {
  it('la máscara es rectangular, simétrica de norte a sur y tiene morro más estrecho que el cuerpo', () => {
    expect(HULL_MASK).toHaveLength(HULL_D);
    for (const r of HULL_MASK) expect(r).toHaveLength(HULL_W);
    expect(HULL_MASK[0]).toBe(HULL_MASK[HULL_D - 1]);
    expect(HULL_MASK[1]).toBe(HULL_MASK[HULL_D - 2]);
    const count = (col: number) => HULL_MASK.filter((r) => r[col] === '#').length;
    expect(count(0)).toBeLessThan(count(4));
  });
  it('la sana ocupa exactamente las celdas sólidas en el suelo y la escotilla toca el casco', () => {
    const ship = { ...newShip('sil'), at: { x: 10, y: 20 } };
    const ground = hullVoxels(ship).filter((v) => v.y === 0 && v.tone !== 'motor');
    const cells = new Set(hullCells(ship).map(([x, y]) => `${x - 10},${y - 20}`));
    expect(cells.size).toBe(HULL_MASK.join('').split('#').length - 1);
    for (const v of ground) expect(cells.has(`${v.x},${v.z}`), `${v.x},${v.z}`).toBe(true);
    const h = hatchCell(ship)!;
    expect(cells.has(`${h.x - 10},${h.y - 1 - 20}`)).toBe(true);
    expect(cells.has(`${h.x - 10},${h.y - 20}`)).toBe(false);
  });
  it('las partes con forma de nave existen: cabina, aleta, antena, toberas y morro', () => {
    const v = hullVoxels(newShip('sil2'));
    for (const tone of ['luz', 'antena', 'motor', 'franja'] as const) expect(v.some((p) => p.tone === tone), tone).toBe(true);
    expect(Math.max(...v.map((p) => p.y))).toBeGreaterThanOrEqual(4);
  });
  it('el daño no cambia dónde se puede chocar: la colisión es la de la nave sana', () => {
    const sana = { ...newShip('c'), at: { x: 0, y: 0 } };
    const rota = { ...crash(newShip('c')), at: { x: 0, y: 0 } };
    expect(hullCells(rota)).toEqual(hullCells(sana));
  });
});

describe('escotilla y cámara', () => {
  it('junto a la escotilla siempre hay sitio para moverse (30 semillas)', () => {
    for (let i = 0; i < 30; i++) {
      const seed = `esc${i}`;
      const ship = crash(newShip(seed));
      const space = openSpace(seed);
      space.setBlockers(hullCells(ship));
      const h = hatchCell(ship)!;
      expect(space.solidAt(h.x, h.y), seed).toBe(false);
      const seen = new Set<string>([`${h.x},${h.y}`]);
      const q = [h];
      while (q.length && seen.size < 60) {
        const c = q.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const k = `${c.x + dx},${c.y + dy}`;
          if (seen.has(k) || space.solidAt(c.x + dx, c.y + dy)) continue;
          seen.add(k);
          q.push({ x: c.x + dx, y: c.y + dy });
        }
      }
      expect(seen.size, seed).toBeGreaterThanOrEqual(60);
      const sp = findSpawn(space, { x: h.x, y: h.y + 1 });
      expect(space.solidAt(sp.x, sp.y)).toBe(false);
    }
  });
  it('la cámara se acerca si hay un muro entre ella y el jugador', () => {
    const wall = { solidAt: (x: number) => x >= 3 };
    const d = clearDistance(wall, 0.5, 0.5, Math.PI / 2, 6, 1.5);
    expect(d).toBeLessThan(6);
    expect(d).toBeGreaterThanOrEqual(1.6);
  });
  it('sin obstáculos la cámara mantiene su distancia, y por encima del muro no se acerca', () => {
    expect(clearDistance({ solidAt: () => false }, 0, 0, 0, 6, 5)).toBe(6);
    expect(clearDistance({ solidAt: () => true }, 0, 0, 0, 6, 5, 2)).toBe(6);
  });
});

describe('restos de la nave (suministros garantizados)', () => {
  const needOf = (ship: ReturnType<typeof crash>) => {
    const need: Record<string, number> = {};
    for (const m of MODULE_IDS) if (!ship.modules[m]) for (const [k, v] of Object.entries(MODULES[m].needs)) need[k] = (need[k] ?? 0) + v;
    return need;
  };
  it('para 60 semillas hay dos cajones libres con piezas de sobra para reparar todo, sin mirar más allá', () => {
    for (let i = 0; i < 60; i++) {
      const seed = `salv${i}`;
      const ship = crash(newShip(seed));
      const space = openSpace(seed);
      space.setBlockers(hullCells(ship));
      const extras = salvage(ship, space);
      expect(extras, seed).toHaveLength(2);
      const have: Record<string, number> = {};
      for (const t of extras) {
        expect(space.solidAt(t.x, t.y), `${seed} cajón en sólido`).toBe(false);
        for (const k of String(t.state.loot).split(',').filter(Boolean)) have[k] = (have[k] ?? 0) + 1;
      }
      for (const [k, v] of Object.entries(needOf(ship))) expect(have[k] ?? 0, `${seed} ${k}`).toBeGreaterThanOrEqual(v);
    }
  });
  it('los cajones existen en el espacio, se abren una vez y su botín es el declarado', () => {
    const seed = 'salv-open';
    const ship = crash(newShip(seed));
    const space = openSpace(seed);
    space.setBlockers(hullCells(ship));
    const extras = salvage(ship, space);
    space.setExtras(extras);
    const t = extras[0]!;
    expect(space.thingsAt(t.x, t.y).some((x) => x.id === t.id)).toBe(true);
    const edit = { id: t.id, t: 1, by: 'a', seq: 1, op: 'open' as const };
    space.setEdits([edit, { ...edit, t: 2, by: 'b' }]);
    const c = space.chunk(Math.floor(t.x / 16), Math.floor(t.y / 16));
    expect(c.things.find((x) => x.id === t.id)!.state).toMatchObject({ open: true, by: 'a' });
    expect(space.rejected()).toHaveLength(1);
  });
  it('los cajones son siempre los mismos aunque ya se hayan reparado módulos', () => {
    const seed = 'salv-same';
    const ship = crash(newShip(seed));
    const space = openSpace(seed);
    space.setBlockers(hullCells(ship));
    const a = salvage(ship, space);
    const r = repair(ship, 'casco', { placa: 5 });
    if (!r.ok) throw new Error('no repara');
    expect(salvage(r.ship, space)).toEqual(a);
  });
  it('una nave en vuelo no deja restos', () => {
    expect(salvage(newShip('x'), { solidAt: () => false })).toEqual([]);
  });
});
