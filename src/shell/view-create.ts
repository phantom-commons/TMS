import { knownObject } from '../core/object-registry';
import { VIEW_LABEL, type ViewKind } from '../core/room-config';
import { CAM_VIEWS, MAX_NAME, MAX_SIDE_CELLS, MIN_SIDE, deleteRoomDef, newRoomDef, normalizeRoomDef, randomSeed, roomDefById, saveRoomDef, type RoomDef } from '../core/room-def';
import { ownedUnits } from '../experiences/house/units';
import { MAX_RULES, MAX_TEXT, type Action, type Rule, type Trigger } from '../sim/house/rules';
import { paletteFromSeed } from '../sim/house/procedural';
import type { ShellApi } from './shell';

// Crear room: una room es datos. Aquí se ajustan sus datos y sus reglas como nodos visibles:
//   [ Cuando … ] ──▶ [ Entonces … ]
// Los tipos de disparador y de acción son un catálogo cerrado (src/sim/house/rules.ts); el usuario solo elige y ajusta.

const TRIGGER_LABEL: Record<Trigger['t'], string> = { enter: 'Al entrar', step: 'Al pisar una casilla', use: 'Al usar un objeto' };
const ACTION_LABEL: Record<Action['t'], string> = { say: 'Decir un mensaje', goto: 'Llevarte a una casilla', recolor: 'Cambiar los colores' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function renderCreate(api: ShellApi, id?: string): HTMLElement {
  const root = el('section', 'view view-create');
  let def: RoomDef | undefined = id ? roomDefById(api.kv, id) : undefined;
  if (id && !def) {
    root.append(el('h1', '', 'Esa room no existe'));
    const b = el('button', 'wide', 'Volver a Explorar');
    b.onclick = () => api.go('#/explore');
    root.append(b);
    return root;
  }
  if (!def) {
    def = saveRoomDef(api.kv, newRoomDef());
    history.replaceState(null, '', `#/create/${def.id}`);
  }
  let cur: RoomDef = def;
  const commit = (next: RoomDef) => {
    cur = saveRoomDef(api.kv, next);
  };
  const patch = (p: Partial<RoomDef>) => commit({ ...cur, ...p });

  const stepper = (value: number, min: number, max: number, onChange: (n: number) => void, show: (n: number) => string = String): HTMLElement => {
    const w = el('span', 'stepper');
    const minus = el('button', '', '−');
    const out = el('b', '', show(value));
    const plus = el('button', '', '+');
    minus.type = plus.type = 'button';
    minus.setAttribute('aria-label', 'Menos');
    plus.setAttribute('aria-label', 'Más');
    const set = (n: number) => {
      const v = Math.min(max, Math.max(min, n));
      out.textContent = show(v);
      value = v;
      onChange(v);
    };
    minus.onclick = () => set(value - 1);
    plus.onclick = () => set(value + 1);
    w.append(minus, out, plus);
    return w;
  };
  const labelled = (label: string, ctl: HTMLElement): HTMLElement => {
    const r = el('div', 'cr-field');
    r.append(el('span', '', label), ctl);
    return r;
  };

  // ───────────── datos básicos ─────────────
  const paintBasics = (box: HTMLElement) => {
    box.replaceChildren();
    const name = el('input');
    name.value = cur.name;
    name.maxLength = MAX_NAME;
    name.setAttribute('aria-label', 'Nombre de la room');
    name.oninput = () => patch({ name: name.value });
    name.onblur = () => {
      if (!name.value.trim()) {
        name.value = 'Mi room';
        patch({ name: 'Mi room' });
      }
    };
    box.append(labelled('Nombre', name));
    const size = el('div', 'cr-size');
    size.append(
      labelled('Ancho', stepper(cur.w, MIN_SIDE, MAX_SIDE_CELLS, (n) => { patch({ w: n }); paintRules(); })),
      labelled('Fondo', stepper(cur.d, MIN_SIDE, MAX_SIDE_CELLS, (n) => { patch({ d: n }); paintRules(); })),
    );
    box.append(size);
    const small = el('small', 'cr-note', 'Si la achicas, lo que quede fuera se descarta al abrirla.');
    box.append(small);

    // colores procedurales
    const pal = paletteFromSeed(cur.seed);
    const sw = el('div', 'cr-swatches');
    for (const c of [pal.wall, pal.wallTrim, pal.floor, pal.floorAlt, pal.accent, pal.accent2]) {
      const s = el('i');
      s.style.background = c;
      sw.append(s);
    }
    const gen = el('button', 'cr-ghost', 'Generar otros colores');
    gen.type = 'button';
    gen.onclick = () => {
      patch({ seed: randomSeed() });
      paintBasics(box);
    };
    const colors = el('div', 'cr-colors');
    colors.append(sw, gen);
    box.append(labelled('Colores', colors));

    // vistas permitidas
    const views = el('div', 'cr-views');
    for (const v of CAM_VIEWS) {
      const b = el('button', `cr-chip${cur.views.includes(v) ? ' on' : ''}`, VIEW_LABEL[v]);
      b.type = 'button';
      b.onclick = () => {
        const has = cur.views.includes(v);
        if (has && cur.views.length === 1) return api.toast('Tiene que haber al menos una vista');
        const next = has ? cur.views.filter((x) => x !== v) : CAM_VIEWS.filter((x) => x === v || cur.views.includes(x));
        patch({ views: next as ViewKind[], defaultView: next.includes(cur.defaultView) ? cur.defaultView : (next[0] as ViewKind) });
        paintBasics(box);
      };
      views.append(b);
    }
    box.append(labelled('Vistas permitidas', views));
    const sel = el('select');
    for (const v of cur.views) {
      const o = el('option', '', VIEW_LABEL[v]);
      o.value = v;
      o.selected = v === cur.defaultView;
      sel.append(o);
    }
    sel.onchange = () => patch({ defaultView: sel.value as ViewKind });
    box.append(labelled('Vista inicial', sel));
  };

  // ───────────── nodos: reglas visibles ─────────────
  const cellField = (label: string, v: number, max: number, on: (n: number) => void) => labelled(label, stepper(v + 1, 1, max, (n) => on(n - 1)));

  const triggerCard = (r: Rule): HTMLElement => {
    const c = el('div', 'cr-node cr-when');
    c.append(el('small', '', 'Cuando'), el('b', '', TRIGGER_LABEL[r.when.t]));
    const w = r.when;
    const set = (when: Trigger) => commit({ ...cur, rules: cur.rules.map((x) => (x.id === r.id ? { ...x, when } : x)) });
    if (w.t === 'step') {
      c.append(cellField('Columna', w.cx, cur.w, (n) => set({ ...w, cx: n })), cellField('Fila', w.cy, cur.d, (n) => set({ ...w, cy: n })));
    } else if (w.t === 'use') {
      const sel = el('select');
      const owned = Object.keys(ownedUnits(api.kv, api.author)).filter((k) => knownObject(k));
      if (!owned.includes(w.kind)) owned.unshift(w.kind);
      for (const k of owned) {
        const o = el('option', '', knownObject(k)?.obj.name ?? 'Objeto');
        o.value = k;
        o.selected = k === w.kind;
        sel.append(o);
      }
      sel.onchange = () => set({ t: 'use', kind: sel.value });
      c.append(labelled('Objeto', sel));
    } else c.append(el('small', 'cr-note', 'Se cumple cada vez que abres la room.'));
    return c;
  };

  const actionCard = (r: Rule): HTMLElement => {
    const c = el('div', 'cr-node cr-then');
    c.append(el('small', '', 'Entonces'));
    const a = r.then;
    const set = (then: Action) => commit({ ...cur, rules: cur.rules.map((x) => (x.id === r.id ? { ...x, then } : x)) });
    const kind = el('select');
    for (const t of Object.keys(ACTION_LABEL) as Action['t'][]) {
      const o = el('option', '', ACTION_LABEL[t]);
      o.value = t;
      o.selected = t === a.t;
      kind.append(o);
    }
    kind.onchange = () => {
      const t = kind.value as Action['t'];
      set(t === 'say' ? { t, text: 'Hola' } : t === 'goto' ? { t, cx: 0, cy: 0 } : { t, seed: randomSeed() });
      paintRules();
    };
    c.append(kind);
    if (a.t === 'say') {
      const input = el('input');
      input.value = a.text;
      input.maxLength = MAX_TEXT;
      input.placeholder = 'Mensaje';
      input.setAttribute('aria-label', 'Mensaje');
      input.oninput = () => set({ t: 'say', text: input.value });
      c.append(input);
    } else if (a.t === 'goto') {
      c.append(cellField('Columna', a.cx, cur.w, (n) => set({ ...a, cx: n })), cellField('Fila', a.cy, cur.d, (n) => set({ ...a, cy: n })));
    } else {
      const sw = el('div', 'cr-swatches');
      const pal = paletteFromSeed(a.seed);
      for (const col of [pal.wall, pal.floor, pal.floorAlt, pal.accent]) {
        const s = el('i');
        s.style.background = col;
        sw.append(s);
      }
      const gen = el('button', 'cr-ghost', 'Otros colores');
      gen.type = 'button';
      gen.onclick = () => {
        set({ t: 'recolor', seed: randomSeed() });
        paintRules();
      };
      const row = el('div', 'cr-colors');
      row.append(sw, gen);
      c.append(row);
    }
    return c;
  };

  const rulesBox = el('div', 'cr-rules');
  const paintRules = () => {
    rulesBox.replaceChildren();
    if (!cur.rules.length) rulesBox.append(el('p', 'cr-empty', 'Sin reglas todavía. Una regla une un «cuando» con un «entonces».'));
    for (const r of cur.rules) {
      const row = el('div', 'cr-rule');
      const flow = el('div', 'cr-flow');
      flow.append(triggerCard(r), el('span', 'cr-wire', '→'), actionCard(r));
      const del = el('button', 'cr-del', 'Quitar regla');
      del.type = 'button';
      del.onclick = () => {
        commit({ ...cur, rules: cur.rules.filter((x) => x.id !== r.id) });
        paintRules();
      };
      row.append(flow, del);
      rulesBox.append(row);
    }
  };
  const addRule = (when: Trigger) => {
    if (cur.rules.length >= MAX_RULES) return api.toast(`Máximo ${MAX_RULES} reglas`);
    const id = cur.rules.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    commit({ ...cur, rules: [...cur.rules, { id, when, then: { t: 'say', text: 'Hola' } }] });
    paintRules();
  };

  // ───────────── montaje ─────────────
  const head = el('div', 'cr-head');
  const back = el('button', 'cr-back');
  back.type = 'button';
  back.setAttribute('aria-label', 'Volver');
  back.textContent = '←';
  back.onclick = () => api.go('#/explore');
  head.append(back, el('h1', '', 'Crear room'));
  const basics = el('div', 'cr-basics');
  paintBasics(basics);
  paintRules();

  const adders = el('div', 'cr-adders');
  const owned = Object.keys(ownedUnits(api.kv, api.author)).find((k) => knownObject(k));
  const mk = (label: string, make: () => Trigger | null) => {
    const b = el('button', 'cr-ghost', `+ ${label}`);
    b.type = 'button';
    b.onclick = () => {
      const t = make();
      if (t) addRule(t);
      else api.toast('Necesitas al menos un objeto en tu inventario');
    };
    adders.append(b);
  };
  mk(TRIGGER_LABEL.enter, () => ({ t: 'enter' }));
  mk(TRIGGER_LABEL.step, () => ({ t: 'step', cx: 0, cy: 0 }));
  mk(TRIGGER_LABEL.use, () => (owned ? { t: 'use', kind: owned } : null));

  const actions = el('div', 'cr-actions');
  const play = el('button', 'wide cr-primary', 'Amueblar y probar');
  play.type = 'button';
  play.onclick = () => {
    const ok = normalizeRoomDef(cur);
    if (ok) saveRoomDef(api.kv, ok);
    api.go(`#/room/${encodeURIComponent(cur.id)}`);
  };
  const remove = el('button', 'wide cr-danger', 'Borrar esta room');
  remove.type = 'button';
  remove.onclick = () => {
    if (!confirm(`¿Borrar «${cur.name}»? Los objetos colocados vuelven a tu inventario.`)) return;
    deleteRoomDef(api.kv, cur.id);
    api.go('#/explore');
  };
  actions.append(play, remove);

  root.append(
    head,
    el('p', 'lead', 'Una room son datos: tamaño, colores, vistas y reglas. Los muebles los pones tú dentro, con tu inventario.'),
    basics,
    el('h2', 'sec', 'Reglas (nodos)'),
    rulesBox,
    adders,
    actions,
  );
  return root;
}
