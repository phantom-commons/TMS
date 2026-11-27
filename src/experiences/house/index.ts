import type { ExperienceFactory } from '../../core/experience-registry';
import { GRAPHICS_EVENT, getGraphics } from '../../core/graphics';
import { freeUnits } from '../../core/inventory';
import { knownObject, loadLibrary, registerObject, registryDefs } from '../../core/object-registry';
import { houseKey, isCustomId, roomDefById } from '../../core/room-def';
import { VIEW_LABEL, resolveView, type ViewKind } from '../../core/room-config';
import { cellAhead, dirOfYaw, placementOrigin, snapStep, type Snap } from '../../sim/house/placement';
import { VPC } from '../../core/objects';
import { paletteFromSeed } from '../../sim/house/procedural';
import { detectEvents, runRules } from '../../sim/house/rules';
import { starterHouse } from '../../sim/house/starter';
import {
  MOVE_TICKS,
  TICKS_PER_SECOND,
  applyEdit,
  createHouse,
  nearestFreeCell,
  stepHouse,
  type Dir,
  type EditOp,
  type HouseState,
} from '../../sim/house/state';
import { objectThumb } from '../../ui/object-thumb';
import { reconcileShip } from '../../sim/space/story';
import { advance, loadStory, objectives, planetOpen, saveStory, type Fact, type Story } from '../../sim/space/story';
import { loadShip, saveShip } from '../../sim/space/store';
import { privateStarSeed } from '../../sim/space/spaces';
import { hatchSpot, nearHatch, nearObject } from '../../sim/space/tutorial';
import { playMeteors } from '../../ui/meteors';
import { openShipPanel } from '../../ui/ship-panel';
import { createHouseScene, type CamKind } from './scene';
import { DEFAULT_KEY, loadHouse, saveHouse } from './store';
import { ownedUnits, startInventory, usedUnits } from './units';

// Casa: la room hecha desde cero sobre una sola sim (src/sim/house). Aquí solo hay entrada, cámara y dibujo:
//  · la sim avanza en ticks fijos y se mueve por casillas;
//  · mirar alrededor, el suavizado de los pasos y la animación son del navegador, no de la sim.

const TICK = 1 / TICKS_PER_SECOND;
const isCam = (v: ViewKind): v is CamKind => v === 'fps' || v === 'third' || v === 'iso' || v === 'top';
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

type Hold = 'f' | 'b' | 'l' | 'r';
const HOLD_OFFSET: Record<Hold, number> = { f: 0, r: Math.PI / 2, b: Math.PI, l: -Math.PI / 2 };
const KEYS: Record<string, Hold> = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };

export const mountHouse: ExperienceFactory = (ctx) => {
  // ───────────── sim + objetos ─────────────
  const base = starterHouse(ctx.author);
  base.objects.forEach(registerObject); // los muebles de serie son objetos como los demás
  loadLibrary(ctx.kv); // y los que hayas creado en el Taller
  startInventory(ctx.kv, ctx.identity.privateKey, ctx.author);
  const defs = registryDefs;
  // Tu Room es la casa de serie; una room creada por ti es otra casa con su tamaño, su semilla de color y sus reglas
  const def = isCustomId(ctx.config.id) ? roomDefById(ctx.kv, ctx.config.id) : undefined;
  if (isCustomId(ctx.config.id) && !def) throw new Error('esa room ya no existe');
  const storeKey = def ? houseKey(def.id) : DEFAULT_KEY;
  const VIEW_KEY = `room.${ctx.config.id}.view`;
  const rules = def?.rules ?? [];
  const first = def ? createHouse(def.seed, def.w, def.d) : base.state;
  let state: HouseState = loadHouse(ctx.kv, first, defs, storeKey);
  const startPalette = def ? paletteFromSeed(def.seed) : base.palette;

  // Si una unidad que estaba colocada ya no es tuya (la regalaste, la prestaste, venció un préstamo), sale de la room.
  {
    const owned = ownedUnits(ctx.kv, ctx.author);
    const used = usedUnits(ctx.kv, ctx.author);
    const gone: string[] = [];
    for (const kind of Object.keys(used)) {
      let excess = (used[kind] ?? 0) - (owned[kind] ?? 0);
      for (let i = state.objects.length - 1; i >= 0 && excess > 0; i--) {
        const o = state.objects[i];
        if (o && o.kind === kind) {
          const r = applyEdit(state, { t: 'remove', id: o.id }, defs);
          if (r.ok) {
            state = r.state;
            excess--;
            gone.push(knownObject(kind)?.obj.name ?? 'objeto');
          }
        }
      }
    }
    if (gone.length) {
      saveHouse(ctx.kv, state, storeKey);
      setTimeout(() => ctx.toast(`Ya no tienes: ${[...new Set(gone)].join(', ')}`), 600);
    }
  }

  // ───────────── DOM ─────────────
  const root = ctx.root;
  root.classList.add('hs-root');
  root.innerHTML = `
    <canvas class="hs-canvas"></canvas>
    <header class="hs-top">
      <button type="button" class="hs-btn hs-back" aria-label="Volver al menú">←</button>
      <span class="hs-title"></span>
      <button type="button" class="hs-btn hs-rules" hidden>Reglas</button>
      <button type="button" class="hs-btn hs-ship" hidden>Nave</button>
      <button type="button" class="hs-btn hs-view"></button>
      <button type="button" class="hs-btn hs-editbtn">Editar</button>
    </header>
    <div class="hs-say" hidden></div>
    <button type="button" class="hs-use" hidden>Usar</button>
    <div class="hs-goals" hidden></div>
    <button type="button" class="hs-btn hs-skip" hidden>Saltar tutorial</button>
    <div class="hs-hint">Arrastra para mirar · usa las flechas para moverte</div>
    <div class="hs-pad" role="group" aria-label="Moverse">
      <button type="button" class="hs-pb hs-pf" data-hold="f" aria-label="Adelante">↑</button>
      <button type="button" class="hs-pb hs-pl" data-hold="l" aria-label="Izquierda">←</button>
      <button type="button" class="hs-pb hs-pbk" data-hold="b" aria-label="Atrás">↓</button>
      <button type="button" class="hs-pb hs-pr" data-hold="r" aria-label="Derecha">→</button>
    </div>
    <section class="hs-edit" hidden>
      <div class="hs-actions">
        <button type="button" data-act="rotate">Girar</button>
        <button type="button" data-act="remove">Quitar</button>
        <button type="button" data-act="snap"></button>
        <span class="hs-nudge">
          <button type="button" data-nudge="f" aria-label="Empujar adelante">↑</button>
          <button type="button" data-nudge="l" aria-label="Empujar a la izquierda">←</button>
          <button type="button" data-nudge="b" aria-label="Empujar atrás">↓</button>
          <button type="button" data-nudge="r" aria-label="Empujar a la derecha">→</button>
        </span>
      </div>
      <div class="hs-shelf"></div>
      <small class="hs-help">Toca un objeto para elegirlo y toca el suelo para llevarlo allí. Toca uno de abajo para colocarlo delante de ti.</small>
    </section>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLCanvasElement>('.hs-canvas');

  const scene = createHouseScene(canvas, state, startPalette, () => getGraphics().pixelRatio);

  // ───────────── vista ─────────────
  let viewPref = ctx.kv.get<string | null>(VIEW_KEY, null);
  const cams = (): CamKind[] => ctx.config.view.allowed.filter(isCam);
  const camKind = (): CamKind => {
    const k = resolveView(ctx.config, viewPref, ctx.can('camera'));
    return isCam(k) ? k : 'fps';
  };
  let yaw = 0;
  let lookAcc = 0; // cuánto has mirado alrededor (para el objetivo del tutorial)
  let pitch = 0;
  const baseYaw = () => (camKind() === 'iso' ? -0.6 : camKind() === 'top' ? 0 : yaw);
  const paintViewBtn = () => {
    const b = $<HTMLButtonElement>('.hs-view');
    b.hidden = cams().length < 2 || !ctx.can('camera');
    b.textContent = VIEW_LABEL[camKind()];
    b.title = 'Cambiar de vista';
  };
  $('.hs-view').addEventListener('click', () => {
    const list = cams();
    if (list.length < 2) return;
    viewPref = list[(list.indexOf(camKind()) + 1) % list.length] as CamKind;
    ctx.kv.set(VIEW_KEY, viewPref);
    paintViewBtn();
  });

  // ───────────── entrada: movimiento ─────────────
  const held: Hold[] = []; // el último pulsado manda
  const press = (h: Hold) => {
    if (!held.includes(h)) held.push(h);
  };
  const release = (h: Hold) => {
    const i = held.indexOf(h);
    if (i >= 0) held.splice(i, 1);
  };
  const moveInput = (): Dir | null => {
    const h = held[held.length - 1];
    return h ? dirOfYaw(baseYaw() + (HOLD_OFFSET[h] as number)) : null;
  };
  root.querySelectorAll<HTMLElement>('[data-hold]').forEach((b) => {
    const h = b.dataset.hold as Hold;
    b.addEventListener('pointerdown', (e) => {
      b.setPointerCapture(e.pointerId);
      press(h);
      b.classList.add('on');
    });
    const up = () => {
      release(h);
      b.classList.remove('on');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  });
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea')) return;
    const k = e.key.toLowerCase();
    if (KEYS[k]) {
      press(KEYS[k] as Hold);
      e.preventDefault();
    } else if (k === 'q' || k === 'e') {
      yaw += k === 'q' ? -Math.PI / 2 : Math.PI / 2;
      lookAcc += 200;
    }
    else if (k === 'escape' && editing) setEditing(false);
    else if (k === 'f' || k === 'enter') {
      if (!storyUse()) useQueued = lookDir();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const h = KEYS[e.key.toLowerCase()];
    if (h) release(h);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ───────────── entrada: mirar y tocar ─────────────
  let editing = false;
  let selected: number | null = null;
  let snap: Snap = 'cell';
  let down: { x: number; y: number; t: number; moved: boolean; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) < 8) return;
    if (!down.moved) {
      down.moved = true;
      down.x = e.clientX;
      down.y = e.clientY;
      return;
    }
    if (camKind() === 'fps' || camKind() === 'third') {
      yaw += dx * 0.006;
      pitch = clamp(pitch - dy * 0.006, -1.2, 1.2);
      lookAcc += Math.abs(dx) + Math.abs(dy);
    }
    down.x = e.clientX;
    down.y = e.clientY;
  });
  const endPointer = (e: PointerEvent) => {
    if (!down || down.id !== e.pointerId) return;
    const wasTap = !down.moved && performance.now() - down.t < 450;
    down = null;
    if (wasTap && editing) onTap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => (down = null));

  // ───────────── edición ─────────────
  const commit = (op: EditOp): boolean => {
    const r = applyEdit(state, op, defs);
    if (!r.ok) {
      ctx.toast(r.error);
      return false;
    }
    state = r.state;
    if (r.id != null && (op.t === 'place' || op.t === 'move' || op.t === 'rotate')) selected = r.id;
    if (op.t === 'remove') selected = null;
    saveHouse(ctx.kv, state, storeKey);
    scene.syncObjects(state);
    if (editing) paintShelf();
    scene.setSelected(selected);
    return true;
  };

  const onTap = (cx: number, cy: number) => {
    const hit = scene.pick(cx, cy);
    if (hit.objectId != null && hit.objectId !== selected) {
      selected = hit.objectId;
      scene.setSelected(selected);
      return;
    }
    if (selected != null && hit.floor) {
      const cur = state.objects.find((o) => o.id === selected);
      if (!cur) return;
      const o = placementOrigin(state, defs, cur.kind, cur.rot, hit.floor.x * VPC, hit.floor.z * VPC, snap);
      if (o) commit({ t: 'move', id: cur.id, x: o.x, y: o.y });
      return;
    }
    if (hit.objectId == null) {
      selected = null;
      scene.setSelected(null);
    }
  };

  const placeAhead = (kind: string) => {
    const free = freeUnits(ownedUnits(ctx.kv, ctx.author), usedUnits(ctx.kv, ctx.author), kind);
    if (free <= 0) return ctx.toast('No te quedan unidades libres de ese objeto');
    const ahead = cellAhead(state, dirOfYaw(baseYaw()));
    const cell = nearestFreeCell(state, defs, ahead.cx, ahead.cy) ?? ahead;
    const o = placementOrigin(state, defs, kind, 0, (cell.cx + 0.5) * VPC, (cell.cy + 0.5) * VPC, snap);
    if (o) commit({ t: 'place', kind, x: o.x, y: o.y });
  };

  // la estantería es tu inventario: solo lo que tienes, con las unidades libres que te quedan
  const paintShelf = () => {
    const shelf = $('.hs-shelf');
    shelf.innerHTML = '';
    const owned = ownedUnits(ctx.kv, ctx.author);
    const used = usedUnits(ctx.kv, ctx.author);
    for (const kind of Object.keys(owned)) {
      const info = knownObject(kind);
      if (!info) continue;
      const free = freeUnits(owned, used, kind);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hs-item';
      b.disabled = free === 0;
      const img = new Image();
      const url = objectThumb(kind, 52);
      if (url) img.src = url;
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = `${info.obj.name} ×${free}`;
      b.append(img, label);
      b.onclick = () => placeAhead(kind);
      shelf.append(b);
    }
    if (!shelf.children.length) shelf.textContent = 'Tu inventario está vacío. Crea objetos en el Taller.';
  };

  const paintEdit = () => {
    $('[data-act="snap"]').textContent = snap === 'cell' ? 'Encaje: casilla' : 'Encaje: voxel';
  };
  const setEditing = (on: boolean) => {
    editing = on;
    $<HTMLElement>('.hs-edit').hidden = !on;
    $('.hs-editbtn').classList.toggle('active', on);
    $('.hs-editbtn').textContent = on ? 'Listo' : 'Editar';
    $<HTMLElement>('.hs-hint').hidden = on;
    if (on) {
      paintShelf();
      paintEdit();
    } else {
      selected = null;
      scene.setSelected(null);
    }
  };
  $('.hs-editbtn').addEventListener('click', () => ctx.can('manage') && setEditing(!editing));
  $('.hs-editbtn').hidden = !ctx.can('manage');
  $('.hs-back').addEventListener('click', () => ctx.exit());

  root.querySelector('.hs-edit')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const nudge = t.closest<HTMLElement>('[data-nudge]')?.dataset.nudge as Hold | undefined;
    if (act === 'snap') {
      snap = snap === 'cell' ? 'voxel' : 'cell';
      paintEdit();
    } else if (act === 'rotate' && selected != null) commit({ t: 'rotate', id: selected });
    else if (act === 'remove' && selected != null) commit({ t: 'remove', id: selected });
    else if (nudge && selected != null) {
      const cur = state.objects.find((o) => o.id === selected);
      if (!cur) return;
      const dir = dirOfYaw(baseYaw() + (HOLD_OFFSET[nudge] as number));
      const step = snapStep(snap);
      const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir] as [number, number];
      commit({ t: 'move', id: cur.id, x: cur.x + dx * step, y: cur.y + dy * step });
    } else if ((act === 'rotate' || act === 'remove') && selected == null) ctx.toast('Toca primero un objeto');
  });

  // ───────────── reglas de la room (solo las que ella declara) ─────────────
  let faceYaw = 0; // hacia dónde mira el avatar en 3ª persona/isométrica
  let useQueued: Dir | null = null;
  let sayTimer = 0;
  const say = (text: string) => {
    const el = $<HTMLElement>('.hs-say');
    el.textContent = text;
    el.hidden = false;
    window.clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => (el.hidden = true), 3200);
  };
  const fire = (events: ReturnType<typeof detectEvents>) => {
    if (!events.length) return;
    const r = runRules(state, rules, events, defs);
    state = r.state;
    r.says.forEach(say);
    if (r.seed) scene.setPalette(paletteFromSeed(r.seed));
  };
  const lookDir = (): Dir => dirOfYaw(camKind() === 'fps' || camKind() === 'third' ? yaw : faceYaw);
  const useBtn = $<HTMLButtonElement>('.hs-use');
  useBtn.hidden = !rules.some((r) => r.when.t === 'use');
  // ───────────── historia: Tu Room es el interior de la nave; la escotilla está en la pared sur ─────────────
  const storyOn = !def && ctx.config.id === 'house';
  const seedStar = privateStarSeed(ctx.author);
  let story: Story | null = storyOn ? loadStory(ctx.kv) : null;
  const goalsEl = $<HTMLElement>('.hs-goals');
  const skipBtn = $<HTMLButtonElement>('.hs-skip');
  const hatch = hatchSpot(state.w, state.d);
  if (storyOn) scene.setHatch(hatch.x, hatch.y);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const paintGoals = () => {
    if (!story) return;
    const list = story.step === 'lista' ? [] : objectives(story, coarse ? 'touch' : 'keys');
    goalsEl.hidden = list.length === 0;
    goalsEl.replaceChildren(
      ...list.map((o) => {
        const el = document.createElement('div');
        el.className = `hs-goal${o.done ? ' done' : ''}`;
        el.textContent = o.text;
        return el;
      }),
    );
    skipBtn.hidden = story.step !== 'tutorial';
    $<HTMLButtonElement>('.hs-ship').hidden = !planetOpen(story);
    // los objetivos sustituyen a la ayuda genérica mientras haya historia en curso
    $<HTMLElement>('.hs-hint').hidden = list.length > 0;
  };
  const runMeteors = () => playMeteors(root, { onDone: () => feed({ t: 'meteorsDone' }) });
  function feed(f: Fact) {
    if (!story) return;
    const r = advance(story, f, loadShip(ctx.kv, seedStar));
    if (!r.changed) return;
    story = r.story;
    saveStory(ctx.kv, story);
    paintGoals();
    if (r.effects.some((e) => e.t === 'crash')) {
      saveShip(ctx.kv, reconcileShip(story, loadShip(ctx.kv, seedStar)));
      feed({ t: 'landed' });
      saveHouse(ctx.kv, state, storeKey);
      ctx.go('#/room/star');
    } else if (story.step === 'meteoritos') runMeteors();
  }
  const storyTick = () => {
    if (!story) return;
    const p = state.player;
    const here = nearHatch(p.cx, p.cy, state.w, state.d);
    if (story.step === 'tutorial') {
      if (p.cx !== startCell.x || p.cy !== startCell.y) feed({ t: 'moved' });
      if (lookAcc > 90) feed({ t: 'looked' });
      // empiezas pegado a la escotilla: solo cuenta cuando ya te has movido y vuelves a ella
      if (here && story.done.includes('mover')) feed({ t: 'atHatch' });
    }
    // el botón Usar aparece cuando hay algo que hacer: reglas de uso, tutorial activo o junto a la escotilla
    useBtn.hidden = !(rules.some((r) => r.when.t === 'use') || story.step === 'tutorial' || here);
    if (here && story.step !== 'tutorial') useBtn.textContent = planetOpen(story) ? 'Salir' : 'Usar';
    else useBtn.textContent = 'Usar';
  };
  const startCell = { x: state.player.cx, y: state.player.cy };
  const storyUse = (): boolean => {
    if (!story) return false;
    const p = state.player;
    const here = nearHatch(p.cx, p.cy, state.w, state.d);
    if (story.step === 'tutorial' && nearObject(p.cx, p.cy, state.objects.map((o) => ({ x: Math.floor(o.x / VPC), y: Math.floor(o.y / VPC) })))) feed({ t: 'used' });
    if (!here) return false;
    if (story.step === 'salir') feed({ t: 'exited' });
    else if (planetOpen(story)) {
      saveHouse(ctx.kv, state, storeKey);
      ctx.go('#/room/star');
    } else if (story.step === 'tutorial') say('Primero termina de aprender los controles');
    else say('Aún no puedes salir');
    return true;
  };
  useBtn.addEventListener('click', () => {
    if (storyUse()) return;
    useQueued = lookDir();
  });
  skipBtn.addEventListener('click', () => feed({ t: 'skipTutorial' }));
  $('.hs-ship').addEventListener('click', () => openShipPanel({ kv: ctx.kv, seed: seedStar, toast: ctx.toast, onChange: () => { story = loadStory(ctx.kv); paintGoals(); } }));
  paintGoals();
  // reanudar si se recargó a mitad de la lluvia o de la caída
  if (story?.step === 'meteoritos') runMeteors();
  else if (story?.step === 'caida') {
    saveShip(ctx.kv, reconcileShip(story, loadShip(ctx.kv, seedStar)));
    feed({ t: 'landed' });
    ctx.go('#/room/star');
  }
  $('.hs-title').textContent = def?.name ?? 'Tu Room';
  if (def && ctx.can('manage')) {
    const rb = $<HTMLButtonElement>('.hs-rules');
    rb.hidden = false;
    rb.addEventListener('click', () => ctx.go(`#/create/${def.id}`));
  }

  // ───────────── bucle: ticks fijos + dibujo interpolado ─────────────
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= TICK) {
      const input = moveInput();
      const before = state.player;
      const prev = state;
      state = stepHouse(state, { move: input }, defs);
      if (rules.length) fire(detectEvents(prev, state, defs));
      if (useQueued != null) {
        if (rules.length) fire(detectEvents(state, state, defs, useQueued));
        useQueued = null;
      }
      if (state.player !== before && state.player.moveLeft === MOVE_TICKS && input != null) {
        faceYaw = (input * Math.PI) / 2;
        if (state.tick % 4 === 0) saveHouse(ctx.kv, state, storeKey);
      }
      acc -= TICK;
    }
    storyTick();
    const p = state.player;
    const t = p.moveLeft > 0 ? clamp((MOVE_TICKS - p.moveLeft + acc / TICK) / MOVE_TICKS, 0, 1) : 1;
    const px = p.fromX + (p.cx - p.fromX) * t + 0.5;
    const pz = p.fromY + (p.cy - p.fromY) * t + 0.5;
    const kind = camKind();
    scene.setPlayer(px, pz, kind === 'fps' || kind === 'third' ? yaw : faceYaw, kind !== 'fps');
    scene.setCamera(kind, yaw, pitch, px, pz);
    scene.render();
  };

  scene.syncObjects(state);
  paintViewBtn();
  fire([{ t: 'enter' }]);
  const onResize = () => scene.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener(GRAPHICS_EVENT, onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(root);
  raf = requestAnimationFrame((n) => {
    last = n;
    frame(n);
  });

  // hook de pruebas y depuración: lectura de la sim sin tocarla
  (window as unknown as { __house?: () => HouseState }).__house = () => state;

  return {
    destroy() {
      cancelAnimationFrame(raf);
      saveHouse(ctx.kv, state, storeKey);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener(GRAPHICS_EVENT, onResize);
      ro.disconnect();
      scene.dispose();
      delete (window as unknown as { __house?: unknown }).__house;
      root.classList.remove('hs-root');
      root.innerHTML = '';
    },
  };
};
