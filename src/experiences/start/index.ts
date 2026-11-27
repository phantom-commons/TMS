import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ExperienceFactory } from '../../core/experience-registry';
import { getGraphics, GRAPHICS_EVENT } from '../../core/graphics';
import type { Counts } from '../../core/inventory';
import { BIOME_IDS } from '../../sim/space/biome';
import { CHUNK, chunkOf, type Thing } from '../../sim/space/chunk';
import { lootOf, type Edit } from '../../sim/space/edits';
import { clearDistance } from '../../sim/space/camera';
import { cellColor, LENSES, thingColor, type Lens } from '../../sim/space/lens';
import { sheetOf, hasTag } from '../../sim/space/sheets';
import { loadCargo, repairFromCargo, saveCargo } from '../../sim/space/cargo';
import { loadParams } from '../../sim/space/ship-params';
import { buildShipMesh, disposeShipMesh } from '../../render/ship-mesh';
import { exportGlb } from '../../render/export-glb';
import { hatchCell, hullVoxels, salvage, MODULE_IDS, MODULES, worldWithShip, type Ship } from '../../sim/space/ship';
import { privateStarSeed } from '../../sim/space/spaces';
import { loadShip, saveShip } from '../../sim/space/store';
import { advance, loadStory, planetOpen, reconcileShip, saveStory } from '../../sim/space/story';
import { leafTexture, rgb, tileTexture } from '../../sim/space/texture';
import { findSpawn, openSpace } from '../../sim/space/world';

// Estrella: primera conexión de src/sim/space con el render. Tercera persona (o cenital) sobre tu planeta.
// La sim no sabe nada de esto: aquí solo hay entrada, cámara y dibujo. Lo que cambia (cofres, cubos, la nave)
// se guarda como ediciones y estado de nave en este navegador; los objetos que recoges quedan «encima» de ti.

const RADIUS = 3; // chunks alrededor
const TILE = 8;
const SPEED = 4.2; // celdas por segundo
const REACH = 1.7;
const R = 0.3;
const KEYS: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const HOLD: Record<string, [number, number]> = { f: [0, 1], b: [0, -1], l: [-1, 0], r: [1, 0] };

type Target = { kind: 'hatch' } | { kind: 'thing'; thing: Thing };

export const mountStar: ExperienceFactory = (ctx) => {
  const seed = privateStarSeed(ctx.author);
  const K = { edits: 'star.edits.v1', pos: 'star.pos.v1', view: 'star.view' };
  // antes de la caída no se puede estar aquí: la historia empieza en la nave
  let story = loadStory(ctx.kv);
  if (!planetOpen(story)) {
    ctx.toast('Aún no puedes salir de la nave');
    queueMicrotask(() => ctx.go('#/room/house'));
    return { destroy() {} };
  }
  let ship: Ship = reconcileShip(story, loadShip(ctx.kv, seed));
  const edits: Edit[] = ctx.kv.get<Edit[]>(K.edits, []);
  let seq = edits.reduce((m, e) => Math.max(m, e.seq), 0);
  let cargo = loadCargo(ctx.kv); // encima (se pierde al morir) y guardado en la nave
  const carriedNow = (): Counts => cargo.carried;
  const space = worldWithShip(ship, openSpace(seed, edits));
  space.setExtras(salvage(ship, space)); // cajones de salvamento junto al casco
  const hatch = hatchCell(ship)!;
  const savedPos = ctx.kv.get<{ x: number; y: number } | null>(K.pos, null);
  const start = findSpawn(space, { x: hatch.x, y: hatch.y + 1 });
  const me = { x: (savedPos?.x ?? start.x + 0.5), y: (savedPos?.y ?? start.y + 0.5) };
  let yaw = 0;
  let topView = ctx.kv.get<boolean>(K.view, false);
  let lens: Lens = 'normal';
  let hullStyle: 'voxel' | 'malla' = ctx.kv.get<'voxel' | 'malla'>('star.hull', 'malla');
  let camD = 6.5;

  // ───────────── DOM ─────────────
  const root = ctx.root;
  root.classList.add('hs-root');
  root.innerHTML = `
    <canvas class="hs-canvas"></canvas>
    <header class="hs-top"><button type="button" class="hs-btn hs-back" aria-label="Volver al menú">←</button><span class="hs-title">Tu estrella</span><button type="button" class="hs-btn hs-hull"></button><button type="button" class="hs-btn hs-lens"></button><button type="button" class="hs-btn hs-view"></button></header>
    <div class="hs-hint"></div>
    <button type="button" class="hs-use" hidden></button>
    <div class="hs-pad" role="group" aria-label="Moverse">
      <button type="button" class="hs-pb hs-pf" data-hold="f" aria-label="Adelante">↑</button>
      <button type="button" class="hs-pb hs-pl" data-hold="l" aria-label="Izquierda">←</button>
      <button type="button" class="hs-pb hs-pbk" data-hold="b" aria-label="Atrás">↓</button>
      <button type="button" class="hs-pb hs-pr" data-hold="r" aria-label="Derecha">→</button>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLCanvasElement>('.hs-canvas');

  // ───────────── escena ─────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ecbf0');
  scene.fog = new THREE.Fog('#9ecbf0', RADIUS * CHUNK * 0.45, RADIUS * CHUNK * 0.95);
  scene.add(new THREE.HemisphereLight('#ffffff', '#6b7080', 1.6));
  const sun = new THREE.DirectionalLight('#fff3d6', 1.4);
  sun.position.set(6, 12, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cone = new THREE.ConeGeometry(0.5, 1, 6);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const plane = new THREE.PlaneGeometry(1, 1);
  const cross = (() => {
    const a = plane.clone();
    const b = plane.clone();
    b.rotateY(Math.PI / 2);
    return mergeGeometries([a, b])!;
  })();
  const flat = (c: string) => new THREE.MeshLambertMaterial({ color: c });
  const mats = new Map<string, THREE.MeshLambertMaterial>();
  const mat = (c: string) => mats.get(c) ?? (mats.set(c, flat(c)).get(c)!);
  const leafMat = (() => {
    const px = leafTexture('#4e8a3e', seed, 16);
    const t = new THREE.DataTexture(new Uint8Array(px.buffer.slice(0)), 16, 16, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = true;
    t.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
  })();

  const tileCache = new Map<string, Uint8ClampedArray>();
  const tile = (b: string) => tileCache.get(b) ?? (tileCache.set(b, tileTexture(b as (typeof BIOME_IDS)[number], seed, TILE)).get(b)!);
  const stoneTile = (() => {
    const t = new Uint8ClampedArray(TILE * TILE * 4);
    const c = rgb('#a09a8c');
    for (let i = 0; i < TILE * TILE; i++) t.set([c[0] + ((i * 7) % 9) - 4, c[1] + ((i * 7) % 9) - 4, c[2] + ((i * 7) % 9) - 4, 255], i * 4);
    return t;
  })();

  type Loaded = { ground: THREE.Mesh; objs: THREE.Group };
  const loaded = new Map<string, Loaded>();

  const meshOfThing = (t: Thing): THREE.Object3D => {
    const sh = sheetOf(t.kind);
    const sz = sh?.visual.size ?? 1;
    const color = thingColor(t.kind);
    let m: THREE.Mesh;
    switch (sh?.visual.shape) {
      case 'plano-cruzado':
        m = new THREE.Mesh(cross, leafMat);
        m.scale.set(sz, sz, sz);
        m.position.set(t.x + 0.5, sz / 2, t.y + 0.5);
        return m;
      case 'cono':
        m = new THREE.Mesh(cone, mat('#3f7a3a'));
        m.scale.set(1.2, sz, 1.2);
        m.position.set(t.x + 0.5, sz / 2, t.y + 0.5);
        return m;
      case 'cilindro':
        m = new THREE.Mesh(cyl, mat(color));
        m.scale.set(sz * 0.6, sz * 0.5, sz * 0.6);
        m.position.set(t.x + 0.5, sz * 0.25, t.y + 0.5);
        return m;
      case 'caja':
        m = new THREE.Mesh(box, mat(t.state.open === true ? '#5b3d22' : color));
        m.scale.set(0.9 * sz, 0.6 * sz + 0.1, 0.7 * sz + 0.1);
        m.position.set(t.x + 0.5, (0.6 * sz + 0.1) / 2, t.y + 0.5);
        return m;
      default:
        m = new THREE.Mesh(box, mat(color));
        m.scale.set(sz, sz, sz);
        m.position.set(t.x + 0.5, sz / 2, t.y + 0.5);
        return m;
    }
  };

  const buildObjs = (cx: number, cy: number): THREE.Group => {
    const c = space.chunk(cx, cy);
    const g = new THREE.Group();
    g.visible = lens === 'normal';
    const walls = c.statics.filter(([, k]) => k === 'muro');
    if (walls.length) {
      const im = new THREE.InstancedMesh(box, mat('#6d6a74'), walls.length);
      const m4 = new THREE.Matrix4();
      walls.forEach(([i], n) => im.setMatrixAt(n, m4.makeScale(1, 1.8, 1).setPosition(cx * CHUNK + (i % CHUNK) + 0.5, 0.9, cy * CHUNK + Math.floor(i / CHUNK) + 0.5)));
      g.add(im);
    }
    for (const t of c.things) g.add(meshOfThing(t));
    const byKind = new Map<string, typeof c.props>();
    for (const p of c.props) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
    for (const [kind, list] of byKind) {
      const sh = sheetOf(kind);
      const sz = sh?.visual.size ?? 1;
      const geo = sh?.visual.shape === 'plano-cruzado' ? cross : sh?.visual.shape === 'cono' ? cone : box;
      const m = sh?.visual.shape === 'plano-cruzado' ? leafMat : mat(sh?.visual.shape === 'cono' ? '#3f7a3a' : thingColor(kind));
      const im = new THREE.InstancedMesh(geo, m, list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((p, n) => {
        const s = (p.s / 100) * sz;
        m4.makeScale(sh?.visual.shape === 'cono' ? s * 0.6 : s, s, sh?.visual.shape === 'cono' ? s * 0.6 : s);
        m4.setPosition(cx * CHUNK + p.u / 8, s / 2, cy * CHUNK + p.v / 8);
        im.setMatrixAt(n, m4);
      });
      g.add(im);
    }
    return g;
  };

  const buildGround = (cx: number, cy: number): THREE.Mesh => {
    const c = space.chunk(cx, cy);
    const cv = document.createElement('canvas');
    cv.width = cv.height = CHUNK * TILE;
    const g = cv.getContext('2d')!;
    const stat = new Map(c.statics.map(([i, k]) => [i, k]));
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      if (lens !== 'normal') {
        g.fillStyle = cellColor(lens, c, i % CHUNK, Math.floor(i / CHUNK));
        g.fillRect((i % CHUNK) * TILE, Math.floor(i / CHUNK) * TILE, TILE, TILE);
        continue;
      }
      const px = stat.get(i) ? stoneTile : tile(BIOME_IDS[Number(c.ground[i])]!);
      g.putImageData(new ImageData(new Uint8ClampedArray(px), TILE, TILE), (i % CHUNK) * TILE, Math.floor(i / CHUNK) * TILE);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK, CHUNK), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx * CHUNK + CHUNK / 2, 0, cy * CHUNK + CHUNK / 2);
    return m;
  };

  const disposeLoaded = (l: Loaded) => {
    scene.remove(l.ground, l.objs);
    (l.ground.material as THREE.MeshLambertMaterial).map?.dispose();
    (l.ground.material as THREE.Material).dispose();
    l.ground.geometry.dispose();
    l.objs.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
  };

  let lastC = '';
  const syncChunks = (force = false) => {
    const { cx, cy } = chunkOf(Math.floor(me.x), Math.floor(me.y));
    const key = `${cx},${cy}`;
    if (!force && key === lastC) return;
    lastC = key;
    const want = new Set<string>();
    for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) want.add(`${cx + dx},${cy + dy}`);
    for (const [k, l] of loaded) if (!want.has(k) || force) {
      if (force && want.has(k)) {
        scene.remove(l.objs);
        l.objs.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
        const [x, y] = k.split(',').map(Number) as [number, number];
        l.objs = buildObjs(x, y);
        scene.add(l.objs);
      } else {
        disposeLoaded(l);
        loaded.delete(k);
      }
    }
    for (const k of want) {
      if (loaded.has(k)) continue;
      const [x, y] = k.split(',').map(Number) as [number, number];
      const l = { ground: buildGround(x, y), objs: buildObjs(x, y) };
      scene.add(l.ground, l.objs);
      loaded.set(k, l);
    }
  };

  // nave: casco exterior en voxels (se ve el daño) y marca de la escotilla
  const HULL_COLORS = { casco: '#b9bfc9', casco2: '#a4abb7', quemado: '#3b3a40', luz: '#6fd3e0', motor: '#e0a23a', antena: '#d9dde4', franja: '#c0583a' } as const;
  let hull = new THREE.Group();
  const buildHull = () => {
    scene.remove(hull);
    hull.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
    disposeShipMesh(hull);
    hull = new THREE.Group();
    const door = new THREE.Mesh(plane, mat('#e0a23a'));
    door.rotation.x = -Math.PI / 2;
    door.position.set(hatch.x + 0.5, 0.02, hatch.y + 0.5);
    hull.add(door);
    if (hullStyle === 'malla') {
      const mesh = buildShipMesh(ship, loadParams(ctx.kv));
      mesh.position.set(ship.at!.x, 0, ship.at!.y);
      hull.add(mesh);
    } else {
      const vox = hullVoxels(ship);
      const im = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#ffffff' }), vox.length);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      vox.forEach((v, n) => {
        im.setMatrixAt(n, m4.makeTranslation(ship.at!.x + v.x + 0.5, v.y + 0.5, ship.at!.y + v.z + 0.5));
        im.setColorAt(n, col.set(HULL_COLORS[v.tone]));
      });
      hull.add(im);
    }
    scene.add(hull);
  };
  buildHull();

  const avatar = new THREE.Group();
  {
    const body = new THREE.Mesh(box, mat('#e0a23a'));
    body.scale.set(0.5, 0.9, 0.35);
    body.position.y = 0.55;
    const head = new THREE.Mesh(box, mat('#f2d3b3'));
    head.scale.set(0.38, 0.38, 0.38);
    head.position.y = 1.2;
    avatar.add(body, head);
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  scene.add(avatar, shadow);

  // ───────────── entrada ─────────────
  const held = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (KEYS[k]) {
      held.add(k);
      e.preventDefault();
    } else if (k === 'e' || k === 'f') use();
  };
  const onKeyUp = (e: KeyboardEvent) => void held.delete(e.key.toLowerCase());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const pad = new Set<string>();
  root.querySelectorAll<HTMLElement>('[data-hold]').forEach((b) => {
    const k = b.dataset.hold!;
    b.addEventListener('pointerdown', (e) => {
      pad.add(k);
      b.setPointerCapture(e.pointerId);
    });
    const up = () => void pad.delete(k);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  });
  let drag: { x: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, id: e.pointerId }));
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    yaw -= (e.clientX - drag.x) * 0.008;
    drag.x = e.clientX;
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ───────────── edición y uso ─────────────
  const persist = () => {
    ctx.kv.set(K.edits, edits);
    saveCargo(ctx.kv, cargo);
    saveShip(ctx.kv, ship);
    ctx.kv.set(K.pos, { x: me.x, y: me.y });
  };
  const tryEdit = (e: Omit<Edit, 't' | 'by' | 'seq'>): string | null => {
    const edit: Edit = { ...e, t: Date.now(), by: ctx.author, seq: ++seq };
    edits.push(edit);
    space.setEdits(edits);
    const origin = /^gen:(-?\d+),(-?\d+):/.exec(e.id)!;
    space.chunk(Number(origin[1]), Number(origin[2]));
    const rej = space.rejected().find((r) => r.edit === edit);
    if (rej) {
      edits.pop();
      space.setEdits(edits);
      return rej.reason;
    }
    persist();
    syncChunks(true);
    return null;
  };

  const nearest = (): Target | null => {
    let best: { d: number; t: Target } | null = null;
    const dh = Math.hypot(me.x - (hatch.x + 0.5), me.y - (hatch.y + 0.5));
    if (dh <= REACH) best = { d: dh, t: { kind: 'hatch' } };
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (const t of space.thingsAt(Math.floor(me.x) + dx, Math.floor(me.y) + dy)) {
          if (!hasTag(t.kind, 'abre') && !hasTag(t.kind, 'recogible')) continue;
          if (hasTag(t.kind, 'abre') && t.state.open === true) continue;
          const d = Math.hypot(me.x - (t.x + 0.5), me.y - (t.y + 0.5));
          if (d <= REACH && (!best || d < best.d)) best = { d, t: { kind: 'thing', thing: t } };
        }
      }
    }
    return best?.t ?? null;
  };
  const repairable = () => MODULE_IDS.find((m) => !ship.modules[m] && repairFromCargo(ship, m, cargo).ok);
  const labelOf = (t: Target): string => {
    if (t.kind === 'hatch') return repairable() ? 'Reparar' : 'Entrar';
    return hasTag(t.thing.kind, 'abre') ? 'Abrir' : 'Coger';
  };
  const add = (k: string, n = 1) => (cargo = { ...cargo, carried: { ...cargo.carried, [k]: (cargo.carried[k] ?? 0) + n } });
  function use() {
    const t = nearest();
    if (!t) return;
    if (t.kind === 'hatch') {
      const m = repairable();
      if (m) {
        const r = repairFromCargo(ship, m, cargo);
        if (!r.ok) return ctx.toast(r.reason);
        ship = r.ship;
        cargo = r.cargo;
        buildHull();
        const a = advance(story, { t: 'repaired' }, ship);
        if (a.changed) {
          story = a.story;
          saveStory(ctx.kv, story);
          ctx.toast('La nave está lista para despegar');
        }
        persist();
        return ctx.toast(`${MODULES[m].name} reparado`);
      }
      persist();
      return ctx.go('#/room/house'); // el interior de la nave es Tu Room
    }
    const th = t.thing;
    if (hasTag(th.kind, 'abre')) {
      const why = tryEdit({ id: th.id, op: 'open' });
      if (why) return ctx.toast(why);
      const got = typeof th.state.loot === 'string' ? th.state.loot.split(',').filter(Boolean) : lootOf(seed, th.id);
      got.forEach((k) => add(k));
      persist();
      ctx.toast(`Cofre: ${got.map((k) => sheetOf(k)?.name ?? k).join(', ')}`);
    } else {
      const why = tryEdit({ id: th.id, op: 'take' });
      if (why) return ctx.toast(why);
      add(th.kind);
      persist();
      ctx.toast(`Recoges: ${sheetOf(th.kind)?.name ?? th.kind}`);
    }
  }
  $('.hs-use').addEventListener('click', use);
  $('.hs-back').addEventListener('click', () => ctx.exit());
  const paintView = () => ($('.hs-view').textContent = topView ? 'Vista: arriba' : 'Vista: detrás');
  $('.hs-view').addEventListener('click', () => {
    topView = !topView;
    ctx.kv.set(K.view, topView);
    paintView();
  });
  paintView();
  const LENS_LABEL: Record<Lens, string> = { normal: 'Lente: normal', bioma: 'Lente: bioma', solidos: 'Lente: sólidos', durabilidad: 'Lente: durabilidad', puntos: 'Lente: puntos' };
  const paintHull = () => ($('.hs-hull').textContent = hullStyle === 'malla' ? 'Nave: malla' : 'Nave: voxels');
  $('.hs-hull').addEventListener('click', () => {
    hullStyle = hullStyle === 'malla' ? 'voxel' : 'malla';
    ctx.kv.set('star.hull', hullStyle);
    buildHull();
    paintHull();
  });
  paintHull();
  const paintLens = () => ($('.hs-lens').textContent = LENS_LABEL[lens]);
  $('.hs-lens').addEventListener('click', () => {
    lens = LENSES[(LENSES.indexOf(lens) + 1) % LENSES.length]!;
    for (const l of loaded.values()) disposeLoaded(l);
    loaded.clear();
    lastC = '';
    syncChunks();
    paintLens();
  });
  paintLens();

  // ───────────── bucle ─────────────
  const blocked = (x: number, y: number) => [-R, R].some((ox) => [-R, R].some((oy) => space.solidAt(Math.floor(x + ox), Math.floor(y + oy))));
  let lastPush = 0;
  const push = (dx: number, dy: number, now: number) => {
    if (now - lastPush < 280) return;
    const cx = Math.floor(me.x + dx * 0.6);
    const cy = Math.floor(me.y + dy * 0.6);
    const th = space.thingsAt(cx, cy).find((t) => hasTag(t.kind, 'empujable'));
    if (!th) return;
    lastPush = now;
    tryEdit({ id: th.id, op: 'move', x: th.x + dx, y: th.y + dy });
  };
  const hint = $('.hs-hint');
  const useBtn = $<HTMLButtonElement>('.hs-use');
  let last = performance.now();
  let raf = 0;
  let hudKey = '';
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let ix = 0;
    let iy = 0;
    for (const k of held) { ix += KEYS[k]![0]; iy += KEYS[k]![1]; }
    for (const k of pad) { ix += HOLD[k]![0]; iy += HOLD[k]![1]; }
    if (ix || iy) {
      const len = Math.hypot(ix, iy);
      ix /= len;
      iy /= len;
      const fx = -Math.sin(yaw);
      const fy = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const ry = -Math.sin(yaw);
      const vx = (fx * iy + rx * ix) * SPEED * dt;
      const vy = (fy * iy + ry * ix) * SPEED * dt;
      if (!blocked(me.x + vx, me.y)) me.x += vx;
      else if (Math.abs(vx) > 1e-4) push(Math.sign(vx), 0, now);
      if (!blocked(me.x, me.y + vy)) me.y += vy;
      else if (Math.abs(vy) > 1e-4) push(0, Math.sign(vy), now);
      avatar.rotation.y = Math.atan2(vx, vy);
    }
    syncChunks();
    avatar.position.set(me.x, 0, me.y);
    shadow.position.set(me.x, 0.03, me.y);
    const wantD = topView ? 0.01 : 6.5;
    const h = topView ? 16 : 5;
    const free = topView ? wantD : clearDistance(space, me.x, me.y, yaw, wantD, h);
    camD += (free - camD) * Math.min(1, dt * 8);
    const d = Math.min(camD, wantD);
    camera.position.set(me.x + Math.sin(yaw) * d, h, me.y + Math.cos(yaw) * d);
    camera.lookAt(me.x, 0.8, me.y);
    const t = nearest();
    useBtn.hidden = !t;
    if (t) useBtn.textContent = labelOf(t);
    const key = `${MODULE_IDS.map((m) => (ship.modules[m] ? 1 : 0)).join('')}|${JSON.stringify(cargo)}`;
    if (key !== hudKey) {
      hudKey = key;
      const mods = MODULE_IDS.map((m) => `${MODULES[m].name}: ${ship.modules[m] ? 'ok' : 'roto'}`).join(' · ');
      const have = Object.entries(carriedNow()).filter(([, n]) => n > 0).map(([k, n]) => `${sheetOf(k)?.name ?? k} ×${n}`).join(', ');
      hint.textContent = `${mods}${have ? `  |  Llevas: ${have}` : ''}`;
    }
    renderer.render(scene, camera);
  };
  const onResize = () => {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    renderer.setPixelRatio(getGraphics().pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener(GRAPHICS_EVENT, onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(root);
  onResize();
  syncChunks(true);
  raf = requestAnimationFrame(frame);
  (window as unknown as { __star?: unknown }).__star = { me, get ship() { return ship; }, get carried() { return cargo.carried; }, space, edits, use, hatch, setYaw: (v: number) => (yaw = v), exportShip: async () => { const mesh = buildShipMesh(ship); const buf = await exportGlb(mesh); let bin = ''; new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); } };
  persist();

  return {
    destroy() {
      cancelAnimationFrame(raf);
      persist();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener(GRAPHICS_EVENT, onResize);
      ro.disconnect();
      for (const l of loaded.values()) disposeLoaded(l);
      loaded.clear();
      renderer.dispose();
      delete (window as unknown as { __star?: unknown }).__star;
      root.classList.remove('hs-root');
      root.innerHTML = '';
    },
  };
};

