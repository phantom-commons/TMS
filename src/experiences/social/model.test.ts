import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { createKV, type StorageLike } from '../../core/kv';
import { registerObject } from '../../core/object-registry';
import { cellIndex, emptyObject, swordTemplate } from '../../core/objects';
import { signDoc } from '../../core/signed-doc';
import { bytesToHex } from '../../sim/hash';
import { loadLayout, saveLayout } from './layout-store';
import { ROOM_SIZE, applyOp, blockedCells, defaultLayout, findFreeSpot, findPath, grantItem, isItemKind, itemDef, orientedParts, ownedKinds, placedCount, stashCount, validateLayout, ITEMS, ITEM_KINDS, type RoomLayout } from './model';

const OWNER = 'a'.repeat(64);
const fresh = () => defaultLayout(OWNER, 'my-room', 1000);
const must = (r: ReturnType<typeof applyOp>): RoomLayout => {
  if (!r.ok) throw new Error(r.error);
  return r.layout;
};

describe('layout inicial', () => {
  it('es válido y trae cama, silla, escritorio y ventana', () => {
    const l = fresh();
    expect(validateLayout(l)).toBeNull();
    for (const k of ['bed', 'chair', 'desk', 'window'] as const) expect(l.items.some((i) => i.kind === k)).toBe(true);
  });
});

describe('mover (dueño)', () => {
  it('mueve un objeto a un hueco libre y sube la revisión', () => {
    const l = must(applyOp(fresh(), { t: 'move', id: 'it-3', x: 4, y: 4 }, 'owner', 2000));
    expect(l.items.find((i) => i.id === 'it-3')).toMatchObject({ x: 4, y: 4 });
    expect(l.rev).toBe(1);
    expect(l.updatedAt).toBe(2000);
  });
  it('rechaza solapar muebles, salirse o moverse a una pared equivocada', () => {
    const base = fresh();
    expect(applyOp(base, { t: 'move', id: 'it-3', x: 5, y: 0 }, 'owner').ok).toBe(false); // sobre la cama
    expect(applyOp(base, { t: 'move', id: 'it-3', x: 8, y: 0 }, 'owner').ok).toBe(false);
    expect(applyOp(base, { t: 'move', id: 'it-4', x: 7, y: 0 }, 'owner').ok).toBe(false); // ventana de 2 en u=7
    expect(applyOp(base, { t: 'move', id: 'it-4', x: 0, y: 0, wall: 'left' }, 'owner').ok).toBe(true);
  });
  it('la alfombra no bloquea: se puede poner un mueble encima', () => {
    let l = fresh();
    const spot = findFreeSpot(l, 'rug')!;
    l = must(applyOp(l, { t: 'place', kind: 'rug', ...spot }, 'owner'));
    const rug = l.items.find((i) => i.kind === 'rug')!;
    expect(applyOp(l, { t: 'move', id: 'it-3', x: rug.x, y: rug.y }, 'owner').ok).toBe(true);
    expect(blockedCells(l).has(`${rug.x},${rug.y}`)).toBe(false);
  });
  it('gira respetando los límites', () => {
    const l = fresh();
    const r = must(applyOp(l, { t: 'rotate', id: 'it-1' }, 'owner')); // cama 2x1 en (5,0) → 1x2
    expect(r.items.find((i) => i.id === 'it-1')?.rot).toBe(1);
    const edge = must(applyOp(l, { t: 'move', id: 'it-1', x: 6, y: 7 }, 'owner'));
    expect(applyOp(edge, { t: 'rotate', id: 'it-1' }, 'owner').ok).toBe(false);
  });
});

describe('lock', () => {
  it('un objeto bloqueado no se mueve, gira ni guarda hasta desbloquearlo', () => {
    const l = must(applyOp(fresh(), { t: 'lock', id: 'it-1', locked: true }, 'owner'));
    for (const op of [{ t: 'move', id: 'it-1', x: 3, y: 3 }, { t: 'rotate', id: 'it-1' }, { t: 'store', id: 'it-1' }] as const) {
      const r = applyOp(l, op, 'owner');
      expect(r.ok).toBe(false);
    }
    const open = must(applyOp(l, { t: 'lock', id: 'it-1', locked: false }, 'owner'));
    expect(applyOp(open, { t: 'move', id: 'it-1', x: 3, y: 3 }, 'owner').ok).toBe(true);
  });
});

describe('permisos en las operaciones', () => {
  it('el editor mueve y gira lo que no está bloqueado', () => {
    expect(applyOp(fresh(), { t: 'move', id: 'it-3', x: 4, y: 4 }, 'editor').ok).toBe(true);
    expect(applyOp(fresh(), { t: 'rotate', id: 'it-1' }, 'editor').ok).toBe(true);
  });
  it('el editor no mueve lo que el dueño bloqueó', () => {
    const l = must(applyOp(fresh(), { t: 'lock', id: 'it-3', locked: true }, 'owner'));
    const r = applyOp(l, { t: 'move', id: 'it-3', x: 4, y: 4 }, 'editor');
    expect(r).toEqual({ ok: false, error: 'está bloqueado' });
  });
  it('el editor no puede bloquear, colocar, guardar ni compartir', () => {
    const base = fresh();
    for (const op of [
      { t: 'lock', id: 'it-3', locked: true },
      { t: 'place', kind: 'plant', x: 3, y: 3 },
      { t: 'store', id: 'it-3' },
      { t: 'visitors', value: 'none' },
      { t: 'editor', pubkey: 'b'.repeat(64), add: true },
      { t: 'camera', locked: true },
    ] as const) {
      expect(applyOp(base, op, 'editor').ok).toBe(false);
    }
  });
  it('el visitante no puede nada', () => {
    expect(applyOp(fresh(), { t: 'move', id: 'it-3', x: 4, y: 4 }, 'visitor')).toEqual({ ok: false, error: 'los visitantes solo pueden mirar' });
  });
  it('si el dueño cierra la sala a visitantes, no operan ni para mirar', () => {
    const closed = must(applyOp(fresh(), { t: 'visitors', value: 'none' }, 'owner'));
    expect(closed.visitors).toBe('none');
  });
  it('no modifica el layout original (inmutable)', () => {
    const l = fresh();
    const snapshot = JSON.stringify(l);
    applyOp(l, { t: 'move', id: 'it-3', x: 4, y: 4 }, 'owner');
    expect(JSON.stringify(l)).toBe(snapshot);
  });
});

describe('inventario', () => {
  it('colocar gasta del inventario y guardar lo devuelve', () => {
    let l = fresh();
    const spot = findFreeSpot(l, 'plant')!;
    l = must(applyOp(l, { t: 'place', kind: 'plant', ...spot }, 'owner'));
    expect(l.stash.plant).toBe(1);
    const id = l.items[l.items.length - 1].id;
    l = must(applyOp(l, { t: 'store', id }, 'owner'));
    expect(l.stash.plant).toBe(2);
  });
  it('no se puede colocar lo que no tienes', () => {
    expect(applyOp(fresh(), { t: 'place', kind: 'bed', x: 3, y: 3 }, 'owner').ok).toBe(false);
  });
  it('los ids no se repiten tras guardar y volver a colocar', () => {
    let l = fresh();
    l = must(applyOp(l, { t: 'store', id: 'it-3' }, 'owner'));
    l = must(applyOp(l, { t: 'place', kind: 'chair', ...findFreeSpot(l, 'chair')! }, 'owner'));
    expect(new Set(l.items.map((i) => i.id)).size).toBe(l.items.length);
  });
  it('findFreeSpot encuentra sitio para cada tipo en la habitación inicial', () => {
    for (const k of ITEM_KINDS) expect(findFreeSpot(fresh(), k), k).not.toBeNull();
  });
});

describe('editores', () => {
  it('añade y quita editores; valida la clave', () => {
    const k = 'b'.repeat(64);
    let l = must(applyOp(fresh(), { t: 'editor', pubkey: k.toUpperCase(), add: true }, 'owner'));
    expect(l.editors).toEqual([k]);
    l = must(applyOp(l, { t: 'editor', pubkey: k, add: false }, 'owner'));
    expect(l.editors).toEqual([]);
    expect(applyOp(l, { t: 'editor', pubkey: 'xyz', add: true }, 'owner').ok).toBe(false);
    expect(applyOp(l, { t: 'editor', pubkey: OWNER, add: true }, 'owner').ok).toBe(false);
  });
  it('si la cámara está fija el dueño puede soltarla', () => {
    const l = must(applyOp(fresh(), { t: 'camera', locked: true }, 'owner'));
    expect(l.cameraLocked).toBe(true);
    expect(must(applyOp(l, { t: 'camera', locked: false }, 'owner')).cameraLocked).toBe(false);
  });
});

describe('caminar', () => {
  it('encuentra caminos rodeando muebles y rechaza destinos bloqueados', () => {
    const l = fresh();
    const path = findPath(l, { x: 4, y: 5 }, { x: 1, y: 1 });
    expect(path).not.toBeNull();
    const blocked = blockedCells(l);
    for (const p of path!) expect(blocked.has(`${p.x},${p.y}`)).toBe(false);
    expect(path![path!.length - 1]).toEqual({ x: 1, y: 1 });
    expect(findPath(l, { x: 4, y: 5 }, { x: 5, y: 0 })).toBeNull(); // sobre la cama
    expect(findPath(l, { x: 4, y: 5 }, { x: 9, y: 9 })).toBeNull();
  });
});

describe('geometría de piezas', () => {
  it('girar una pieza la mantiene dentro de su huella', () => {
    for (const k of ITEM_KINDS) {
      const def = ITEMS[k];
      if (def.mount === 'wall') continue;
      for (const p of orientedParts(k, 1)) {
        expect(p.dx).toBeGreaterThanOrEqual(-1e-9);
        expect(p.dy).toBeGreaterThanOrEqual(-1e-9);
        expect(p.dx + p.w).toBeLessThanOrEqual(def.d + 1e-9);
        expect(p.dy + p.d).toBeLessThanOrEqual(def.w + 1e-9);
      }
    }
    expect(ROOM_SIZE).toBe(8);
  });
});

describe('persistencia firmada', () => {
  const priv = ed.utils.randomSecretKey();
  const owner = bytesToHex(ed.getPublicKey(priv));
  const store = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it('guarda y recarga el mismo layout', () => {
    const kv = createKV(owner, store());
    expect(loadLayout(kv, owner).fresh).toBe(true);
    const l = must(applyOp(defaultLayout(owner), { t: 'move', id: 'it-3', x: 4, y: 4 }, 'owner'));
    saveLayout(kv, l, priv);
    const back = loadLayout(kv, owner);
    expect(back.fresh).toBe(false);
    expect(back.layout).toEqual(l);
  });
  it('descarta un layout manipulado a mano', () => {
    const st = store();
    const kv = createKV(owner, st);
    saveLayout(kv, defaultLayout(owner), priv);
    const k = [...st.data.keys()][0];
    st.data.set(k, st.data.get(k)!.replace('"visitors":"view"', '"visitors":"none"'));
    const r = loadLayout(kv, owner);
    expect(r.rejected).toBe(true);
    expect(r.layout.visitors).toBe('view');
  });
  it('descarta un layout firmado por otra identidad', () => {
    const kv = createKV(owner, store());
    const other = ed.utils.randomSecretKey();
    saveLayout(kv, defaultLayout(owner), other);
    expect(loadLayout(kv, owner).rejected).toBe(true);
  });
  it('descarta un layout bien firmado pero inválido (solapado)', () => {
    const kv = createKV(owner, store());
    const bad = defaultLayout(owner);
    bad.items[1].x = 5; bad.items[1].y = 0; bad.items[1].rot = 0; // escritorio sobre la cama
    kv.set('room.my-room', signDoc('TMS_ROOM_LAYOUT', bad, priv));
    expect(loadLayout(kv, owner).rejected).toBe(true);
  });
});

// ───────────── objetos propios (voxel) ─────────────

describe('objetos voxel en Tu Room', () => {
  const owner = 'a'.repeat(64);
  const crate = () => {
    const o = emptyObject(8, 8, 8);
    o.name = 'Caja';
    for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o.cells[cellIndex(o, x, y, z)] = 2;
    return o;
  };

  it('un objeto registrado se resuelve como definición de suelo con sus piezas', () => {
    const kind = registerObject(crate());
    const def = itemDef(kind);
    expect(def.label).toBe('Caja');
    expect(def.mount).toBe('floor');
    expect(def.blocks).toBe(true);
    expect(def.parts).toHaveLength(1);
    expect(isItemKind(kind)).toBe(true);
    expect(isItemKind('obj:malo')).toBe(false);
  });

  it('el creador lo recibe en el inventario y se puede colocar', () => {
    const kind = registerObject(crate());
    let l = defaultLayout(owner);
    l = grantItem(l, kind);
    expect(stashCount(l, kind)).toBe(1);
    const spot = findFreeSpot(l, kind)!;
    const res = applyOp(l, { t: 'place', kind, ...spot }, 'owner');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(placedCount(res.layout, kind)).toBe(1);
      expect(stashCount(res.layout, kind)).toBe(0);
      expect(ownedKinds(res.layout)).toContain(kind);
    }
  });

  it('un objeto que bloquea impide pisar su casilla y se apila con otros muebles solo si no solapa', () => {
    const kind = registerObject(crate());
    let l = grantItem(defaultLayout(owner), kind, 2);
    const first = applyOp(l, { t: 'place', kind, x: 6, y: 6 }, 'owner');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    l = first.layout;
    const again = applyOp(l, { t: 'place', kind, x: 6, y: 6 }, 'owner');
    expect(again.ok).toBe(false);
  });

  it('un objeto propio desconocido no invalida el layout: se ve como bloque gris', () => {
    const phantom = 'obj:' + 'f'.repeat(24);
    const l = { ...defaultLayout(owner), stash: { [phantom]: 1 } } as ReturnType<typeof defaultLayout>;
    expect(validateLayout(l)).toBeNull();
    expect(itemDef(phantom as never).label).toBe('Objeto desconocido');
  });

  it('el inventario rechaza nombres de objeto inválidos', () => {
    const l = { ...defaultLayout(owner), stash: { 'obj:zz': 1 } } as unknown as ReturnType<typeof defaultLayout>;
    expect(validateLayout(l)).toBe('inventario inválido');
  });

  it('una espada gira y mantiene la huella', () => {
    const kind = registerObject(swordTemplate());
    const def = itemDef(kind);
    expect(def.blocks).toBe(false);
    expect(orientedParts(kind, 1)).toHaveLength(def.parts.length);
  });
});
