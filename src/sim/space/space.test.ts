import { describe, expect, it } from 'vitest';
import { createKV } from '../../core/kv';
import { loadHouse, saveHouse } from '../../experiences/house/store';
import { defsFromObjects, starterHouse } from '../house/starter';
import { objectId } from '../../core/objects';
import { biomeAt, BIOME_IDS } from './biome';
import { CHUNK, cellIndex, chunkHash, generateChunk, originChunkOfThing } from './chunk';
import { checkpoint, foldEdits, lootOf, lootUnitId, propId, type Edit } from './edits';
import { cellColor, dots, LENSES, lodFor } from './lens';
import { hash2, rand01, valueNoise } from './noise';
import { SHEETS, validateSheet, TAGS } from './sheets';
import { crash, crashSite, die, enterShip, exitShip, hatchCell, hullCells, MODULES, newShip, readyToFly, recover, repair, worldWithShip } from './ship';
import { canEnter, privateStarSeed, publicWorld, shipSpace } from './spaces';
import { REGION, structureOfRegion, templateSize, TEMPLATES, validateTemplate } from './templates';
import { leafTexture, tileTexture } from './texture';
import { findSpawn, openSpace } from './world';

const SEED = 'seed-prueba';

describe('ficha de objeto', () => {
  it('todas las fichas del catálogo son válidas y sus etiquetas son del catálogo cerrado', () => {
    for (const s of SHEETS) expect(validateSheet(s), s.kind).toBeNull();
    expect(new Set(SHEETS.map((s) => s.kind)).size).toBe(SHEETS.length);
    expect(TAGS).toContain('solido');
  });
  it('rechaza fichas incoherentes', () => {
    const base = SHEETS[0]!;
    expect(validateSheet({ ...base, tags: ['empujable'] })).toMatch(/solido/);
    expect(validateSheet({ ...base, hardness: 12 })).toMatch(/dureza/);
    expect(validateSheet({ ...base, tags: ['inventada' as never] })).toMatch(/catálogo/);
    expect(validateSheet({ ...base, tags: ['abre', 'recogible'] })).toMatch(/contenedor/);
  });
  it('los props (arbusto, pino) no tienen colisión', () => {
    for (const k of ['arbusto', 'pino']) expect(SHEETS.find((s) => s.kind === k)!.tags).not.toContain('solido');
  });
});

describe('ruido', () => {
  it('es determinista y está en [0,1)', () => {
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2));
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(7, i * 3.3, i * 1.7, 12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(rand01(7, i, -i)).toBeLessThan(1);
    }
  });
});

describe('biomas', () => {
  it('en un área grande salen varios biomas y cada celda es de un bioma válido', () => {
    const seen = new Set<string>();
    for (let y = -200; y < 200; y += 5) for (let x = -200; x < 200; x += 5) seen.add(biomeAt(SEED, x, y));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const b of seen) expect(BIOME_IDS).toContain(b);
  });
  it('depende de la semilla', () => {
    let diff = 0;
    for (let i = 0; i < 400; i++) if (biomeAt('a', i * 7, i * 3) !== biomeAt('b', i * 7, i * 3)) diff++;
    expect(diff).toBeGreaterThan(20);
  });
});

describe('chunks', () => {
  it('es determinista: misma semilla y coordenadas, mismo chunk', () => {
    expect(chunkHash(generateChunk(SEED, 3, -2))).toBe(chunkHash(generateChunk(SEED, 3, -2)));
    expect(chunkHash(generateChunk(SEED, 3, -2))).not.toBe(chunkHash(generateChunk(SEED, 3, -1)));
    expect(chunkHash(generateChunk('otra', 3, -2))).not.toBe(chunkHash(generateChunk(SEED, 3, -2)));
  });
  it('hash dorado: si cambia, cambió la generación y las ediciones guardadas ya no encajan', () => {
    expect(chunkHash(generateChunk('golden', 0, 0))).toBe(GOLDEN_0_0);
    expect(chunkHash(generateChunk('golden', 3, -2))).toBe(GOLDEN_3_M2);
  });
  it('tiene 256 celdas de suelo, ids de cosa únicos y estables, y props sin colisión', () => {
    for (const [cx, cy] of [[0, 0], [1, 1], [-3, 4], [10, -10]] as const) {
      const c = generateChunk(SEED, cx, cy);
      expect(c.ground).toHaveLength(CHUNK * CHUNK);
      const ids = c.things.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of c.things) expect(originChunkOfThing(t.id)).toEqual({ cx, cy });
      for (const p of c.props) {
        expect(p.u).toBeGreaterThanOrEqual(0);
        expect(p.u).toBeLessThan(CHUNK * 8);
        expect(p.v).toBeLessThan(CHUNK * 8);
      }
    }
  });
  it('rinde: 100 chunks en menos de 1,5 s', () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) generateChunk(SEED, i % 10, Math.floor(i / 10));
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('estructuras', () => {
  it('todas las plantillas son válidas y caben en una región', () => {
    for (const t of TEMPLATES) {
      expect(validateTemplate(t), t.id).toBeNull();
      const { w, d } = templateSize(t);
      expect(w).toBeLessThanOrEqual(REGION);
      expect(d).toBeLessThanOrEqual(REGION);
    }
  });
  it('detecta plantillas rotas', () => {
    expect(validateTemplate({ id: 'x', rows: ['###', '#.#'] })).toMatch(/puerta/);
    expect(validateTemplate({ id: 'x', rows: ['#D#', '#.#', '#?#'] })).toMatch(/símbolo/);
    expect(validateTemplate({ id: 'x', rows: ['#D#', '###', '#.#'] })).toMatch(/inalcanzable/);
    expect(validateTemplate({ id: 'x', rows: ['##', '#...'] })).toMatch(/ancho/);
  });
  it('una estructura que cruza el borde de chunk queda cosida en los dos lados', () => {
    let found = 0;
    for (let ry = -6; ry < 6 && found < 3; ry++) {
      for (let rx = -6; rx < 6 && found < 3; rx++) {
        const p = structureOfRegion(SEED, rx, ry);
        if (!p) continue;
        const { w, d } = templateSize(p.template);
        const crossesX = Math.floor(p.x / CHUNK) !== Math.floor((p.x + w - 1) / CHUNK);
        const crossesY = Math.floor(p.y / CHUNK) !== Math.floor((p.y + d - 1) / CHUNK);
        if (!crossesX && !crossesY) continue;
        found++;
        const space = openSpace(SEED);
        for (let ty = 0; ty < d; ty++) {
          for (let tx = 0; tx < w; tx++) {
            const ch = p.template.rows[ty]![tx]!;
            const got = space.staticAt(p.x + tx, p.y + ty);
            if (ch === '#') expect(got, `${p.template.id} ${tx},${ty}`).toBe('muro');
            else if (ch === ' ') expect(got).toBeUndefined();
            else expect(got).toBe('suelo-estructura');
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
  it('desde fuera se llega a la puerta y a lo de dentro (relleno de celdas libres)', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const space = openSpace(seed);
      let checked = 0;
      for (let ry = -2; ry < 2; ry++) for (let rx = -2; rx < 2; rx++) {
        const p = structureOfRegion(seed, rx, ry);
        if (!p) continue;
        const { w, d } = templateSize(p.template);
        const rows = p.template.rows;
        const dy = rows.findIndex((r) => r.includes('D'));
        const door = { x: p.x + rows[dy]!.indexOf('D'), y: p.y + dy };
        // flood desde la puerta por celdas no sólidas, acotado a la propia plantilla + 1 de margen
        const seen = new Set<string>([`${door.x},${door.y}`]);
        const q = [door];
        while (q.length) {
          const c = q.pop()!;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = c.x + ox;
            const ny = c.y + oy;
            if (nx < p.x || ny < p.y || nx >= p.x + w || ny >= p.y + d || seen.has(`${nx},${ny}`) || space.solidAt(nx, ny)) continue;
            seen.add(`${nx},${ny}`);
            q.push({ x: nx, y: ny });
          }
        }
        // las cosas sólidas de dentro (cofres, cubos) no deben aislar al resto: se llega a más de la mitad del suelo
        const floor = rows.join('').split('').filter((ch) => ch !== '#' && ch !== ' ').length;
        expect(seen.size, `${seed} ${p.template.id}`).toBeGreaterThanOrEqual(Math.ceil(floor / 2));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });
});

describe('ediciones', () => {
  const find = (kind: string) => {
    for (let cx = -4; cx < 4; cx++) for (let cy = -4; cy < 4; cy++) {
      const c = generateChunk(SEED, cx, cy);
      const t = c.things.find((th) => th.kind === kind);
      if (t) return { c, t };
    }
    throw new Error(`sin ${kind}`);
  };
  const e = (over: Partial<Edit> & Pick<Edit, 'id' | 'op'>): Edit => ({ t: 1, by: 'a', seq: 0, ...over });

  it('el orden de llegada no cambia el resultado (todas las permutaciones)', () => {
    const { c, t } = find('cofre');
    const edits: Edit[] = [
      e({ id: t.id, op: 'open', t: 5, by: 'b' }),
      e({ id: t.id, op: 'open', t: 3, by: 'a' }),
      e({ id: t.id, op: 'set', t: 4, by: 'a', seq: 1, state: { nota: 'x' } }),
    ];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const hashes = new Set(perms.map((p) => chunkHash(foldEdits(c, p.map((i) => edits[i]!)).chunk)));
    expect(hashes.size).toBe(1);
  });
  it('doble cobro: gana el primero y el segundo queda rechazado, sin duplicar', () => {
    const { c, t } = find('cofre');
    const r = foldEdits(c, [e({ id: t.id, op: 'open', t: 9, by: 'tarde' }), e({ id: t.id, op: 'open', t: 2, by: 'pronto' })]);
    expect(r.chunk.things.find((x) => x.id === t.id)!.state).toMatchObject({ open: true, by: 'pronto' });
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.edit.by).toBe('tarde');
    expect(lootOf(SEED, t.id)).toEqual(lootOf(SEED, t.id));
    expect(lootUnitId(SEED, t.id, 0)).toBe(lootUnitId(SEED, t.id, 0));
    expect(lootUnitId(SEED, t.id, 0)).not.toBe(lootUnitId(SEED, t.id, 1));
  });
  it('coger dos veces lo mismo: solo la primera cuenta', () => {
    const { c, t } = find('cubo-recogible');
    const r = foldEdits(c, [e({ id: t.id, op: 'take', t: 1, by: 'a' }), e({ id: t.id, op: 'take', t: 2, by: 'b' })]);
    expect(r.chunk.things.some((x) => x.id === t.id)).toBe(false);
    expect(r.rejected).toHaveLength(1);
  });
  it('mover: un paso, a una celda libre, y solo lo empujable', () => {
    const { c, t } = find('cubo-empujable');
    const ok = foldEdits(c, [e({ id: t.id, op: 'move', x: t.x + 1, y: t.y })]);
    const moved = ok.chunk.things.find((x) => x.id === t.id)!;
    if (ok.rejected.length === 0) expect([moved.x, moved.y]).toEqual([t.x + 1, t.y]);
    expect(foldEdits(c, [e({ id: t.id, op: 'move', x: t.x + 5, y: t.y })]).rejected[0]!.reason).toBe('solo un paso');
    const fixed = find('cubo-fijo');
    expect(foldEdits(fixed.c, [e({ id: fixed.t.id, op: 'move', x: fixed.t.x + 1, y: fixed.t.y })]).rejected[0]!.reason).toBe('no se mueve');
  });
  it('no se puede empujar un cubo contra un muro', () => {
    for (let ry = -6; ry < 6; ry++) for (let rx = -6; rx < 6; rx++) {
      const p = structureOfRegion(SEED, rx, ry);
      if (p?.template.id !== 'ruina') continue;
      const space = openSpace(SEED);
      const row = p.template.rows;
      // la ruina tiene un cubo en la fila 3; el muro exterior está tapado por huecos, buscamos un cubo con muro a su lado
      for (let ty = 0; ty < row.length; ty++) for (let tx = 0; tx < row[ty]!.length; tx++) {
        if (row[ty]![tx] !== 'b') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (space.staticAt(p.x + tx + dx, p.y + ty + dy) !== 'muro') continue;
          const cx = Math.floor((p.x + tx) / CHUNK);
          const cy = Math.floor((p.y + ty) / CHUNK);
          const c = generateChunk(SEED, cx, cy);
          const th = c.things.find((x) => x.kind === 'cubo-empujable' && x.x === p.x + tx && x.y === p.y + ty)!;
          const r = foldEdits(c, [e({ id: th.id, op: 'move', x: th.x + dx, y: th.y + dy })], (x, y) => space.staticAt(x, y) === 'muro');
          expect(r.rejected[0]?.reason).toBe('ocupado');
          return;
        }
      }
    }
  });
  it('un prop se «promueve» a cosa al tocarlo y se puede mover', () => {
    for (let cx = -3; cx < 3; cx++) {
      const c = generateChunk(SEED, cx, 0);
      const i = c.props.findIndex((p) => p.kind === 'arbusto');
      if (i < 0) continue;
      const p = c.props[i]!;
      const x = cx * CHUNK + Math.floor(p.u / 8);
      const y = Math.floor(p.v / 8);
      const r = foldEdits(c, [e({ id: propId(cx, 0, i), op: 'move', x: x + 1, y })]);
      expect(r.rejected).toHaveLength(0);
      expect(r.chunk.things.find((t) => t.id === propId(cx, 0, i))).toMatchObject({ kind: 'arbusto', x: x + 1, y });
      expect(r.chunk.props).toHaveLength(c.props.length - 1);
      return;
    }
    throw new Error('sin arbustos');
  });
  it('un punto de control es estable y cambia con las ediciones', () => {
    const { c, t } = find('cofre');
    const a = checkpoint(c);
    const b = checkpoint(foldEdits(c, [e({ id: t.id, op: 'open' })]).chunk);
    expect(a.key).toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });
  it('un id que no existe se rechaza sin romper nada', () => {
    const c = generateChunk(SEED, 0, 0);
    const r = foldEdits(c, [e({ id: 'gen:0,0:cofre:99', op: 'open' })]);
    expect(r.rejected).toHaveLength(1);
    expect(chunkHash(r.chunk)).toBe(chunkHash(c));
  });
});

describe('aparecer', () => {
  it('el punto de aparición está libre con sus vecinas libres, para muchas semillas', () => {
    for (let i = 0; i < 25; i++) {
      const space = openSpace(`s${i}`);
      const s = findSpawn(space);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(space.solidAt(s.x + dx, s.y + dy), `s${i}`).toBe(false);
    }
  });
});

describe('nave', () => {
  it('cae en un sitio libre alrededor, siempre el mismo para la misma semilla', () => {
    for (const seed of ['x1', 'x2', 'x3', 'x4']) {
      const at = crashSite(seed);
      expect(crashSite(seed)).toEqual(at);
      const ship = crash(newShip(seed));
      const space = openSpace(seed);
      for (const [x, y] of hullCells(ship)) expect(space.staticAt(x, y)).toBeUndefined();
      const h = hatchCell(ship)!;
      expect(space.staticAt(h.x, h.y)).toBeUndefined();
    }
  });
  it('al estrellarse se rompen casco y motor; los demás según la semilla', () => {
    const s = crash(newShip('x1'));
    expect(s.status).toBe('crashed');
    expect(s.modules.casco).toBe(false);
    expect(s.modules.motor).toBe(false);
    expect(readyToFly(s)).toBe(false);
  });
  it('reparar gasta piezas, exige tenerlas y al terminar la nave queda lista', () => {
    let s = crash(newShip('x1'));
    expect(repair(s, 'casco', {})).toEqual({ ok: false, reason: 'Te faltan piezas.' });
    expect(repair(newShip('x1'), 'casco', { placa: 9 })).toMatchObject({ ok: false });
    let have: Record<string, number> = { placa: 5, nucleo: 5, cable: 9 };
    for (const id of Object.keys(MODULES) as Array<keyof typeof MODULES>) {
      if (s.modules[id]) continue;
      const r = repair(s, id, have);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.ship;
      have = Object.fromEntries(Object.entries(have).map(([k, v]) => [k, v - (r.consumed[k] ?? 0)]));
      expect(repair(s, id, have)).toMatchObject({ ok: false, reason: 'Ya está reparado.' });
    }
    expect(readyToFly(s)).toBe(true);
    expect(s.status).toBe('landed');
    expect(Object.values(have).every((v) => v >= 0)).toBe(true);
  });
  it('entrar solo junto a la escotilla; salir te deja en la escotilla, libre', () => {
    const seed = 'x2';
    const ship = crash(newShip(seed));
    const h = hatchCell(ship)!;
    expect(enterShip(ship, { space: 'world', x: h.x + 5, y: h.y + 5 })).toMatchObject({ error: expect.any(String) });
    expect(enterShip(ship, { space: 'world', x: h.x + 1, y: h.y })).toEqual({ space: 'ship' });
    const out = exitShip(ship, {});
    expect(out).toEqual({ space: 'world', x: h.x, y: h.y });
    const space = worldWithShip(ship, openSpace(seed));
    expect(space.solidAt(h.x, h.y)).toBe(false);
    for (const [x, y] of hullCells(ship)) expect(space.solidAt(x, y)).toBe(true);
    expect(enterShip(ship, { space: 'ship' })).toMatchObject({ error: expect.any(String) });
  });
  it('en vuelo no hay escotilla al suelo: sin traje no se sale al vacío', () => {
    const ship = newShip('x3');
    expect(exitShip(ship, {})).toMatchObject({ error: expect.stringContaining('traje') });
    expect(exitShip(ship, { traje: 1 })).toEqual({ space: 'orbit' });
    expect(enterShip(ship, { space: 'orbit' })).toEqual({ space: 'ship' });
    expect(enterShip(ship, { space: 'world', x: 0, y: 0 })).toMatchObject({ error: expect.any(String) });
  });
  it('morir: despiertas en la nave, lo que llevabas queda en una cápsula y se recupera', () => {
    const r = die({ cable: 2, placa: 1, nucleo: 0 }, { x: 5, y: 5 }, 1);
    expect(r.respawn).toEqual({ space: 'ship' });
    expect(r.carried).toEqual({});
    expect(r.capsule).toEqual({ id: 'cap:1', at: { x: 5, y: 5 }, items: { cable: 2, placa: 1 } });
    expect(recover(r.capsule!, {}, { x: 9, y: 9 })).toMatchObject({ error: expect.any(String) });
    expect(recover(r.capsule!, { cable: 1 }, { x: 5, y: 6 })).toEqual({ cable: 3, placa: 1 });
    expect(die({}, { x: 0, y: 0 }, 2).capsule).toBeNull();
  });
});

describe('espacios', () => {
  it('nave: solo entra su dueño; mundo público: cualquiera; privado: dueño y amigos', () => {
    expect(canEnter(shipSpace('a'), 'a')).toBe(true);
    expect(canEnter(shipSpace('a'), 'b')).toBe(false);
    expect(canEnter(publicWorld(), 'z')).toBe(true);
    const priv = { kind: 'world', seed: privateStarSeed('a'), access: { who: 'friends', allow: ['a', 'b'] }, sync: 'p2p' } as const;
    expect(canEnter(priv, 'b')).toBe(true);
    expect(canEnter(priv, 'c')).toBe(false);
  });
  it('la estrella privada sale de la clave con separación de dominio y no coincide con la nave', () => {
    expect(privateStarSeed('a')).toBe(privateStarSeed('a'));
    expect(privateStarSeed('a')).not.toBe(privateStarSeed('b'));
    expect(privateStarSeed('a')).not.toBe(shipSpace('a').seed);
  });
  it('migración: lo guardado en house.v1 se carga igual con la semilla de la nave', () => {
    const owner = 'ab'.repeat(32);
    const ship = shipSpace(owner);
    const before = starterHouse(owner);
    const kv = createKV('mig', null);
    saveHouse(kv, before.state); // como lo dejó la versión anterior, en la clave de siempre
    const after = starterHouse(ship.seed);
    const defs = defsFromObjects(after.objects);
    const loaded = loadHouse(kv, after.state, defs);
    expect(loaded.objects.map((o) => [o.kind, o.x, o.y, o.rot])).toEqual(before.state.objects.map((o) => [o.kind, o.x, o.y, o.rot]));
    expect(after.palette).toEqual(before.palette);
    expect(after.objects.map(objectId)).toEqual(before.objects.map(objectId));
  });
});

describe('lentes y texturas', () => {
  it('todas las lentes devuelven un color hex para todas las celdas', () => {
    const c = generateChunk(SEED, 0, 0);
    for (const lens of LENSES) for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) expect(cellColor(lens, c, x, y)).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('la lente de puntos solo marca celdas con contenido', () => {
    const c = generateChunk(SEED, 1, 1);
    const d = dots(c);
    const filled = new Set([...c.statics.map(([i]) => i), ...c.things.map((t) => cellIndex(t.x, t.y))]);
    expect(d).toHaveLength(filled.size);
    expect(d.every((p) => p.color === '#4da3ff')).toBe(true);
  });
  it('el nivel de detalle baja con la distancia', () => {
    expect([5, 20, 40, 100].map(lodFor)).toEqual([3, 2, 1, 0]);
  });
  it('el tile es determinista, repetible, y cada bioma tiene su color medio', () => {
    const avg = (b: (typeof BIOME_IDS)[number]) => {
      const t = tileTexture(b, SEED, 16);
      expect(t).toHaveLength(16 * 16 * 4);
      expect(Array.from(tileTexture(b, SEED, 16))).toEqual(Array.from(t));
      let r = 0;
      for (let i = 0; i < t.length; i += 4) r += t[i]!;
      return r / 256;
    };
    const means = BIOME_IDS.map(avg);
    expect(new Set(means.map((m) => Math.round(m))).size).toBe(BIOME_IDS.length);
  });
  it('el ruido del tile es periódico: sin costura entre el borde y el opuesto', () => {
    const size = 16;
    const a = valueNoise(3, 0, 5, 4, 4);
    const b = valueNoise(3, size, 5, 4, 4);
    expect(b).toBeCloseTo(a, 10);
  });
  it('la hoja tiene alfa 0 o 255 y algo de cada', () => {
    const t = leafTexture('#4e8a3e', SEED, 16);
    const alphas = new Set<number>();
    for (let i = 3; i < t.length; i += 4) alphas.add(t[i]!);
    expect([...alphas].sort()).toEqual([0, 255]);
  });
});

const GOLDEN_0_0 = '925482a5e0a5a86531e5af52306d1c6a25e4996505116911c201ccc551febf8b';
const GOLDEN_3_M2 = '63b37efca579a6853f6873ee7c1891c4fda7a11ad0bdfd8e858a6506188cb282';
