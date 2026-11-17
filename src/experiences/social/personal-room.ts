import type { ExperienceFactory } from '../../core/experience-registry';
import { VIEW_LABEL, resolveView, type ViewKind } from '../../core/room-config';
import { ROLE_LABEL, canRole, roleOf, type Capability, type Role } from '../../core/permissions';
import { shortPubkey } from '../../identity/keys';
import { hexToBytes } from '../../sim/hash';
import { loadLayout, saveLayout } from './layout-store';
import {
  ITEMS,
  ITEM_KINDS,
  ROOM_SIZE,
  applyOp,
  findFreeSpot,
  findPath,
  blockedCells,
  type ItemKind,
  type Op,
  type PlacedItem,
  type RoomLayout,
  type Wall,
} from './model';
import { drawRoom, fitView, ownerHue, pickItem, pickWallSlot, unprojectFloor, type Pt, type RoomView, type View } from './render';

// Tu Room: habitación isométrica 2D (barata en móvil). Dos modos:
//   Caminar → tu avatar recorre la habitación.
//   Editar  → mueves, giras, bloqueas o guardas muebles, según tu rol.
// Todo cambio pasa por applyOp(layout, op, rol): este archivo solo traduce gestos a operaciones.

const DRAG_PX = 6;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2.2;

type Mode = 'walk' | 'edit';
type Drag = { id: string; offX: number; offY: number; ghost: { item: PlacedItem; valid: boolean } };

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export const mountPersonalRoom: ExperienceFactory = (ctx) => {
  const loaded = loadLayout(ctx.kv, ctx.author);
  let layout: RoomLayout = loaded.layout;
  if (loaded.rejected) ctx.toast('tu layout guardado no pasó la verificación de firma: se restauró el inicial', 5000);

  let preview: Role | null = null;
  let mode: Mode = 'walk';
  let selectedId: string | null = null;
  let hover: Pt | null = null;
  let drag: Drag | null = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let dirty = true;
  let sheetOpen = false;

  const role = (): Role => preview ?? roleOf({ owner: layout.owner, editors: layout.editors, visitors: layout.visitors }, ctx.author);
  const can = (cap: Capability) =>
    canRole(role(), cap, { policy: ctx.config.policy, cameraLocked: layout.cameraLocked, visitors: layout.visitors });

  // ───────────── DOM ─────────────
  const root = ctx.root;
  root.classList.add('pr-root');
  root.innerHTML = `
    <header class="pr-top">
      <button class="gf-icon pr-back" type="button" aria-label="Volver al menú">←</button>
      <div class="pr-title">🛋️ Tu Room <span class="pr-role"></span></div>
      <span class="gf-lock pr-camlock" title="El dueño fijó la cámara" hidden>📷 fija</span>
      <button class="gf-icon pr-gear" type="button" aria-label="Permisos" hidden>⚙</button>
    </header>
    <div class="pr-banner" hidden><span></span><button type="button">Volver a Dueño</button></div>
    <div class="pr-stage">
      <canvas class="pr-canvas"></canvas>
      <div class="pr-zoom"><button type="button" data-z="in" aria-label="Acercar">+</button><button type="button" data-z="out" aria-label="Alejar">−</button><button type="button" data-z="reset" aria-label="Centrar">◎</button><button type="button" class="pr-viewbtn" data-z="view" aria-label="Cambiar vista"></button></div>
      <div class="pr-private" hidden><div class="gf-card"><h2>🔒 Room privada</h2><p>El dueño no permite visitas en este momento.</p></div></div>
    </div>
    <div class="pr-dock">
      <div class="pr-modes" role="tablist"><button type="button" data-mode="walk">🚶 Caminar</button><button type="button" data-mode="edit">✏️ Editar</button></div>
      <div class="pr-edit" hidden>
        <div class="pr-sel"></div>
        <div class="pr-tray"></div>
      </div>
    </div>
    <div class="pr-sheet" hidden><div class="pr-sheet-card"></div></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLCanvasElement>('.pr-canvas');
  const stage = $<HTMLElement>('.pr-stage');
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas 2D no disponible');

  // ───────────── avatar ─────────────
  const avatar = { x: 4, y: 5, path: [] as Pt[], moving: false };
  const placeAvatar = () => {
    const blocked = blockedCells(layout);
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < ROOM_SIZE && y < ROOM_SIZE && !blocked.has(`${x},${y}`);
    const ax = Math.round(avatar.x);
    const ay = Math.round(avatar.y);
    if (free(ax, ay)) return;
    for (let r = 1; r < ROOM_SIZE; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (free(ax + dx, ay + dy)) {
            avatar.x = ax + dx;
            avatar.y = ay + dy;
            avatar.path = [];
            return;
          }
        }
      }
    }
  };
  placeAvatar();

  // ───────────── tamaño ─────────────
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const resize = () => {
    cssW = stage.clientWidth;
    cssH = stage.clientHeight;
    if (cssW < 10 || cssH < 10) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // Vista: la room declara cuáles permite; tu elección se guarda por jugador y solo cuenta si puedes mover la cámara.
  const VIEW_KEY = 'room.my-room.view';
  let viewPref = ctx.kv.get<string | null>(VIEW_KEY, null);
  const drawable = (k: ViewKind): k is RoomView => k === 'iso' || k === 'top';
  const viewKind = (): RoomView => {
    const k = resolveView(ctx.config, viewPref, can('camera'));
    return drawable(k) ? k : 'iso';
  };
  const choices = (): RoomView[] => ctx.config.view.allowed.filter(drawable);
  const cycleView = () => {
    if (!can('camera')) return;
    const list = choices();
    if (list.length < 2) return;
    viewPref = list[(list.indexOf(viewKind()) + 1) % list.length];
    ctx.kv.set(VIEW_KEY, viewPref);
    panX = 0;
    panY = 0;
    dirty = true;
    refreshViewBtn();
  };
  const refreshViewBtn = () => {
    const b = root.querySelector<HTMLButtonElement>('.pr-viewbtn');
    if (!b) return;
    const list = choices();
    b.hidden = list.length < 2;
    const next = list[(list.indexOf(viewKind()) + 1) % Math.max(1, list.length)];
    b.textContent = viewKind() === 'iso' ? '▦' : '◇';
    b.title = `Vista actual: ${VIEW_LABEL[viewKind()]} · cambiar a ${VIEW_LABEL[next ?? viewKind()]}`;
  };
  const view = (): View => fitView(cssW, cssH, zoom, panX, panY, viewKind());

  // ───────────── cámara ─────────────
  const clampCam = () => {
    if (!can('camera')) {
      zoom = 1;
      panX = 0;
      panY = 0;
      return;
    }
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    const lim = Math.max(0, zoom - 1) * cssW * 0.5 + cssW * 0.12;
    const limY = Math.max(0, zoom - 1) * cssH * 0.5 + cssH * 0.12;
    panX = Math.min(lim, Math.max(-lim, panX));
    panY = Math.min(limY, Math.max(-limY, panY));
  };
  const zoomBy = (k: number) => {
    if (!can('camera')) return;
    zoom *= k;
    clampCam();
    dirty = true;
  };

  // ───────────── cambios del layout ─────────────
  const commit = (op: Op): boolean => {
    const res = applyOp(layout, op, role());
    if (!res.ok) {
      ctx.toast(res.error);
      return false;
    }
    layout = res.layout;
    saveLayout(ctx.kv, layout, ctx.identity.privateKey);
    avatar.path = [];
    placeAvatar();
    if (selectedId && !layout.items.some((i) => i.id === selectedId)) selectedId = null;
    sync();
    return true;
  };

  const selected = () => (selectedId ? (layout.items.find((i) => i.id === selectedId) ?? null) : null);

  // ───────────── interfaz según rol ─────────────
  const roleEl = $('.pr-role');
  const sel = $('.pr-sel');
  const tray = $('.pr-tray');
  const sheet = $('.pr-sheet');
  const sheetCard = $('.pr-sheet-card');

  const sync = () => {
    clampCam();
    const r = role();
    const seeing = can('view');
    if (!can('move') && mode === 'edit') mode = 'walk';
    if (!seeing) {
      mode = 'walk';
      selectedId = null;
      drag = null;
    }
    roleEl.textContent = preview ? `${ROLE_LABEL[r]} · prueba` : ROLE_LABEL[r];
    roleEl.className = `pr-role pr-role-${r}`;
    $<HTMLElement>('.pr-private').hidden = seeing;
    $<HTMLElement>('.pr-camlock').hidden = !layout.cameraLocked;
    $<HTMLElement>('.pr-zoom').hidden = !can('camera') || !seeing;
    refreshViewBtn();
    $<HTMLElement>('.pr-gear').hidden = !(roleOf({ owner: layout.owner, editors: layout.editors, visitors: layout.visitors }, ctx.author) === 'owner' && !preview);
    const banner = $<HTMLElement>('.pr-banner');
    banner.hidden = preview === null;
    banner.querySelector('span')!.textContent = `Probando como ${ROLE_LABEL[r]} · los cambios se guardan igual`;

    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      const m = b.dataset.mode as Mode;
      b.classList.toggle('active', m === mode);
      b.hidden = m === 'edit' && !can('move');
    });
    $<HTMLElement>('.pr-modes').hidden = !seeing;
    const edit = $<HTMLElement>('.pr-edit');
    edit.hidden = mode !== 'edit' || !seeing;

    // barra del objeto elegido
    const it = selected();
    sel.innerHTML = '';
    if (!it) {
      const p = document.createElement('p');
      p.className = 'pr-hint';
      p.textContent = 'Toca un objeto para elegirlo · arrástralo o toca una casilla para moverlo';
      sel.append(p);
    } else {
      const def = ITEMS[it.kind];
      const label = document.createElement('b');
      label.className = 'pr-sel-name';
      label.textContent = `${def.icon} ${def.label}${it.locked ? ' 🔒' : ''}`;
      sel.append(label);
      const add = (act: string, text: string, enabled: boolean) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = act;
        b.textContent = text;
        b.disabled = !enabled;
        sel.append(b);
      };
      add('rotate', '↻ Girar', can('move') && !it.locked && def.mount === 'floor');
      if (can('lock')) add('lock', it.locked ? '🔓 Desbloquear' : '🔒 Bloquear', true);
      if (can('manage')) add('store', '📥 Guardar', !it.locked);
      if (it.locked && !can('lock')) {
        const p = document.createElement('p');
        p.className = 'pr-hint';
        p.textContent = 'Bloqueado por el dueño';
        sel.append(p);
      }
    }

    // bandeja del inventario
    tray.innerHTML = '';
    if (can('manage')) {
      const entries = ITEM_KINDS.filter((k) => (layout.stash[k] ?? 0) > 0);
      if (entries.length === 0) {
        const p = document.createElement('span');
        p.className = 'pr-hint';
        p.textContent = 'Inventario vacío';
        tray.append(p);
      }
      for (const k of entries) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.place = k;
        b.title = `Colocar ${ITEMS[k].label}`;
        b.textContent = `${ITEMS[k].icon} ×${layout.stash[k]}`;
        tray.append(b);
      }
    }
    if (sheetOpen) renderSheet();
    dirty = true;
  };

  // ───────────── panel de permisos (solo dueño) ─────────────
  const renderSheet = () => {
    const mine = ctx.author;
    const rows = layout.editors
      .map((e) => `<li><code>${shortPubkey(hexToBytes(e))}</code><button type="button" data-rm="${e}">Quitar</button></li>`)
      .join('');
    const seg = (name: string, cur: string, opts: Array<[string, string]>) =>
      `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${cur === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    sheetCard.innerHTML = `
      <header><h3>Permisos de Tu Room</h3><button type="button" class="gf-icon" data-close aria-label="Cerrar">×</button></header>
      <h4>Visitantes</h4>
      ${seg('visitors', layout.visitors, [['view', 'Pueden mirar'], ['none', 'Privada']])}
      <h4>Cámara</h4>
      ${seg('camera', layout.cameraLocked ? 'locked' : 'free', [['free', 'Libre'], ['locked', 'Fija para todos']])}
      <h4>Editores <small>(mueven objetos no bloqueados)</small></h4>
      <ul class="pr-editors">${rows || '<li class="pr-hint">Nadie todavía. Solo tú editas.</li>'}</ul>
      <form class="pr-add"><input name="k" placeholder="clave pública (64 hex)" spellcheck="false" autocomplete="off" /><button type="submit">Añadir</button></form>
      <p class="pr-hint">Tu clave: <code>${shortPubkey(hexToBytes(mine))}</code> <button type="button" data-copy>Copiar</button></p>
      <h4>Probar como</h4>
      ${seg('preview', 'owner', [['owner', 'Dueño'], ['editor', 'Editor'], ['visitor', 'Visitante']])}
      <p class="pr-hint">Los cambios se firman con tu identidad y se guardan en este dispositivo.</p>`;
  };
  const openSheet = (on: boolean) => {
    sheetOpen = on;
    sheet.hidden = !on;
    if (on) renderSheet();
  };

  sheet.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t === sheet || t.closest('[data-close]')) return openSheet(false);
    const seg = t.closest<HTMLElement>('[data-seg] button');
    if (seg) {
      const name = (seg.parentElement as HTMLElement).dataset.seg;
      const v = seg.dataset.v ?? '';
      if (name === 'visitors') commit({ t: 'visitors', value: v === 'none' ? 'none' : 'view' });
      else if (name === 'camera') commit({ t: 'camera', locked: v === 'locked' });
      else if (name === 'preview' && v !== 'owner') {
        preview = v as Role;
        openSheet(false);
        sync();
      }
      return;
    }
    const rm = t.closest<HTMLElement>('[data-rm]');
    if (rm) return void commit({ t: 'editor', pubkey: rm.dataset.rm ?? '', add: false });
    if (t.closest('[data-copy]')) {
      try {
        await navigator.clipboard.writeText(ctx.author);
        ctx.toast('clave pública copiada');
      } catch {
        ctx.toast(ctx.author, 7000);
      }
    }
  });
  sheet.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = sheet.querySelector<HTMLInputElement>('input[name=k]');
    if (!input?.value.trim()) return;
    if (commit({ t: 'editor', pubkey: input.value, add: true })) ctx.toast('editor añadido');
  });

  // ───────────── botones ─────────────
  $('.pr-back').addEventListener('click', () => ctx.exit());
  $('.pr-gear').addEventListener('click', () => openSheet(true));
  $('.pr-banner button').addEventListener('click', () => {
    preview = null;
    sync();
  });
  $('.pr-zoom').addEventListener('click', (e) => {
    const z = (e.target as HTMLElement).closest<HTMLElement>('[data-z]')?.dataset.z;
    if (z === 'in') zoomBy(1.25);
    else if (z === 'out') zoomBy(0.8);
    else if (z === 'view') cycleView();
    else if (z === 'reset') {
      zoom = 1;
      panX = 0;
      panY = 0;
      dirty = true;
    }
  });
  $('.pr-modes').addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
    if (!m || (m === 'edit' && !can('move'))) return;
    mode = m;
    if (m === 'walk') selectedId = null;
    sync();
  });
  const act = (name: string) => {
    const it = selected();
    if (!it) return;
    if (name === 'rotate') commit({ t: 'rotate', id: it.id });
    else if (name === 'lock') commit({ t: 'lock', id: it.id, locked: !it.locked });
    else if (name === 'store') commit({ t: 'store', id: it.id });
  };
  sel.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (a && !a.disabled) act(a.dataset.act ?? '');
  });
  tray.addEventListener('click', (e) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-place]')?.dataset.place as ItemKind | undefined;
    if (!kind) return;
    const spot = findFreeSpot(layout, kind);
    if (!spot) return void ctx.toast('no hay hueco libre para eso');
    if (commit({ t: 'place', kind, ...spot })) {
      selectedId = layout.items[layout.items.length - 1].id;
      sync();
    }
  });

  // ───────────── gestos ─────────────
  const local = (e: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tileAt = (p: Pt) => {
    const f = unprojectFloor(view(), p.x, p.y);
    return { x: Math.floor(f.x), y: Math.floor(f.y) };
  };

  const pointers = new Map<number, Pt>();
  let pinchDist = 0;
  let down: { p: Pt; hit: PlacedItem | null; moved: boolean; panning: boolean; grabTile: Pt } | null = null;

  const ghostFor = (it: PlacedItem, p: Pt, d: Drag): Drag['ghost'] | null => {
    const v = view();
    const def = ITEMS[it.kind];
    let moved: PlacedItem;
    let op: Op;
    if (def.mount === 'wall') {
      const slot = pickWallSlot(v, p.x, p.y);
      if (!slot) return null;
      const u = Math.min(ROOM_SIZE - def.w, Math.max(0, slot.u - d.offX));
      moved = { ...it, x: u, y: 0, wall: slot.wall };
      op = { t: 'move', id: it.id, x: u, y: 0, wall: slot.wall };
    } else {
      const t = tileAt(p);
      const x = t.x - d.offX;
      const y = t.y - d.offY;
      moved = { ...it, x, y };
      op = { t: 'move', id: it.id, x, y };
    }
    return { item: moved, valid: applyOp(layout, op, role()).ok };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!can('view')) return;
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      drag = null;
      down = null;
      return;
    }
    const hit = mode === 'edit' ? pickItem(layout, view(), p.x, p.y) : null;
    down = { p, hit, moved: false, panning: false, grabTile: tileAt(p) };
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      const t = tileAt(p);
      const next = can('view') ? t : null;
      if (!hover || !next || hover.x !== next.x || hover.y !== next.y) {
        hover = next;
        dirty = true;
      }
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, p);

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) zoomBy(d / pinchDist);
      pinchDist = d;
      return;
    }
    if (!down) return;
    const dist = Math.hypot(p.x - down.p.x, p.y - down.p.y);
    if (!down.moved && dist > DRAG_PX) {
      down.moved = true;
      // ¿empieza arrastrando un objeto? solo si el rol lo permite y no está bloqueado
      if (down.hit && can('move') && !down.hit.locked) {
        const it = down.hit;
        selectedId = it.id;
        const def = ITEMS[it.kind];
        let offX = down.grabTile.x - it.x;
        let offY = down.grabTile.y - it.y;
        if (def.mount === 'wall') {
          const slot = pickWallSlot(view(), down.p.x, down.p.y);
          offX = slot ? slot.u - it.x : 0;
          offY = 0;
        }
        drag = { id: it.id, offX, offY, ghost: { item: it, valid: true } };
        sync();
      } else if (!down.hit && can('camera')) {
        down.panning = true;
      } else if (down.hit?.locked) {
        ctx.toast('está bloqueado 🔒');
        down = null;
        return;
      }
    }
    if (drag) {
      const it = layout.items.find((i) => i.id === drag?.id);
      const gh = it ? ghostFor(it, p, drag) : null;
      if (gh) drag.ghost = gh;
      dirty = true;
    } else if (down.panning) {
      panX += e.movementX;
      panY += e.movementY;
      clampCam();
      dirty = true;
    }
  });

  const finish = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    const d = down;
    down = null;
    if (!d) return;
    const p = local(e);

    if (drag) {
      const dr = drag;
      drag = null;
      const it = layout.items.find((i) => i.id === dr.id);
      if (it && dr.ghost.valid && (dr.ghost.item.x !== it.x || dr.ghost.item.y !== it.y || dr.ghost.item.wall !== it.wall)) {
        const w = dr.ghost.item.wall;
        commit({ t: 'move', id: it.id, x: dr.ghost.item.x, y: dr.ghost.item.y, ...(w ? { wall: w } : {}) });
      } else if (it && !dr.ghost.valid) {
        ctx.toast('ahí no cabe');
      }
      dirty = true;
      sync();
      return;
    }
    if (d.moved) return; // fue un paneo

    // ── toque ──
    if (mode === 'edit') {
      if (d.hit) {
        selectedId = d.hit.id;
        if (d.hit.locked) ctx.toast(can('lock') ? 'bloqueado: desbloquéalo para moverlo' : 'bloqueado por el dueño');
        return sync();
      }
      const it = selected();
      if (!it) return;
      if (it.locked) return void ctx.toast('está bloqueado 🔒');
      const def = ITEMS[it.kind];
      if (def.mount === 'wall') {
        const slot = pickWallSlot(view(), p.x, p.y);
        if (slot) commit({ t: 'move', id: it.id, x: Math.min(ROOM_SIZE - def.w, slot.u), y: 0, wall: slot.wall as Wall });
        return;
      }
      const t = tileAt(p);
      const w = it.rot ? def.d : def.w;
      const h = it.rot ? def.w : def.d;
      commit({ t: 'move', id: it.id, x: t.x - Math.floor((w - 1) / 2), y: t.y - Math.floor((h - 1) / 2) });
      return;
    }

    // caminar
    const t = tileAt(p);
    const path = findPath(layout, { x: Math.round(avatar.x), y: Math.round(avatar.y) }, t);
    if (!path) return void ctx.toast('no puedes ir ahí');
    avatar.path = path;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    down = null;
    drag = null;
    dirty = true;
  });
  canvas.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      dirty = true;
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!can('camera')) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );

  // ───────────── teclado ─────────────
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.code === 'Escape') {
      if (sheetOpen) openSheet(false);
      else if (selectedId) {
        selectedId = null;
        sync();
      }
    } else if (e.code === 'KeyR') act('rotate');
    else if (e.code === 'KeyL') act('lock');
    else if (e.code === 'Delete' || e.code === 'Backspace') act('store');
    else if (e.code === 'KeyE' && can('move')) {
      mode = mode === 'edit' ? 'walk' : 'edit';
      sync();
    } else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  // ───────────── bucle (solo redibuja si hace falta) ─────────────
  const SPEED = 3.4; // casillas/s
  let last = performance.now();
  let t = 0;
  let raf = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    avatar.moving = avatar.path.length > 0;
    if (avatar.moving) {
      const target = avatar.path[0];
      const dx = target.x - avatar.x;
      const dy = target.y - avatar.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED * dt;
      if (dist <= step) {
        avatar.x = target.x;
        avatar.y = target.y;
        avatar.path.shift();
      } else {
        avatar.x += (dx / dist) * step;
        avatar.y += (dy / dist) * step;
      }
      dirty = true;
    }
    if (dirty && cssW > 10 && cssH > 10) {
      dirty = false;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const it = drag ? layout.items.find((i) => i.id === drag?.id) : null;
      const wallDrag = !!it && ITEMS[it.kind].mount === 'wall';
      drawRoom(g, cssW, cssH, view(), layout, {
        hue: ownerHue(layout.owner),
        selectedId: mode === 'edit' ? selectedId : null,
        ghost: drag?.ghost ?? null,
        hideId: drag?.id ?? null,
        hover: mode === 'walk' || (mode === 'edit' && selectedId && !drag) ? hover : null,
        showLocks: mode === 'edit',
        trail: avatar.path,
        avatar: { x: avatar.x, y: avatar.y, moving: avatar.moving, t },
        wallSlots: wallDrag,
      });
    }
    raf = requestAnimationFrame(frame);
  };

  sync();
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      root.classList.remove('pr-root');
      root.innerHTML = '';
    },
  };
};
