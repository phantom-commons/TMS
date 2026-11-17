import { nodeType } from '../../sim/nodes/catalog';
import { normalizeManifest, type Manifest, type NodeSpec } from '../../sim/nodes/manifest';
import type { ParamDef } from '../../sim/nodes/params';

// Panel de reglas GENÉRICO: se dibuja a partir del esquema de cada nodo (sliders para enteros, interruptores,
// listas). No sabe nada de Salto: sirve para cualquier manifiesto. Los cambios se acotan con normalizeManifest.

const ENUM_LABELS: Record<string, string> = {
  down: 'Abajo', none: 'Ninguna', left: 'Izquierda', right: 'Derecha', up: 'Arriba',
  touch: 'Al tocar', interval: 'Cada cierto tiempo', offscreen: 'Al salir de pantalla', lifetime: 'Tras un tiempo',
};

export type RulesPanelOptions = {
  title: string;
  manifest: Manifest;
  /** «lista.índice.parámetro» que no se muestran, p. ej. world.0.cols */
  hide?: (scope: string, node: NodeSpec, key: string) => boolean;
  onCommit: (m: Manifest) => void;
  onReset: () => void;
  onClose: () => void;
};

const SCOPE_TITLE: Record<string, string> = { world: 'Mundo', player: 'Jugador' };

export function openRulesPanel(host: HTMLElement, opts: RulesPanelOptions): { close: () => void } {
  let manifest = opts.manifest;
  const sheet = document.createElement('div');
  sheet.className = 'rules-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Reglas');
  host.append(sheet);

  const commit = (edit: (draft: Manifest) => void) => {
    const draft = structuredClone(manifest);
    edit(draft);
    manifest = normalizeManifest(draft, manifest);
    opts.onCommit(manifest);
    render(); // un cambio puede arreglar otro (p. ej. máximo ≥ mínimo): se redibuja desde el manifiesto acotado
  };

  const row = (def: ParamDef, value: unknown, onSet: (v: number | boolean | string) => void): HTMLElement => {
    const wrap = document.createElement('label');
    wrap.className = 'rules-row';
    const name = document.createElement('span');
    name.className = 'rules-name';
    name.textContent = def.label;
    wrap.append(name);
    if (def.type === 'int') {
      const out = document.createElement('output');
      out.className = 'rules-val';
      const unit = def.unit ? ` ${def.unit}` : '';
      out.textContent = `${String(value)}${unit}`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step ?? 1);
      input.value = String(value);
      input.oninput = () => (out.textContent = `${input.value}${unit}`);
      input.onchange = () => onSet(Number(input.value));
      wrap.append(out, input);
    } else if (def.type === 'bool') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value === true;
      input.onchange = () => onSet(input.checked);
      wrap.classList.add('rules-switch');
      wrap.append(input);
    } else {
      const sel = document.createElement('select');
      const options = def.type === 'enum' ? [...def.options] : Object.keys(manifest.prefabs);
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = def.type === 'enum' ? (ENUM_LABELS[o] ?? o) : o;
        sel.append(opt);
      }
      sel.value = String(value);
      sel.onchange = () => onSet(sel.value);
      wrap.append(sel);
    }
    return wrap;
  };

  const group = (scope: string, title: string, list: NodeSpec[], apply: (m: Manifest) => NodeSpec[]): HTMLElement[] => {
    const out: HTMLElement[] = [];
    list.forEach((node, index) => {
      const t = nodeType(node.type);
      if (!t) return;
      const entries = Object.entries(t.schema).filter(([key]) => !opts.hide?.(scope, node, key));
      if (entries.length === 0) return;
      const card = document.createElement('section');
      card.className = 'rules-card';
      const h = document.createElement('h3');
      h.textContent = t.label === title ? t.label : `${title} · ${t.label}`;
      const help = document.createElement('p');
      help.textContent = t.help;
      card.append(h, help);
      for (const [key, def] of entries) {
        card.append(row(def, node.params[key], (v) => commit((m) => { const n = apply(m)[index]; if (n) n.params[key] = v; })));
      }
      out.push(card);
    });
    return out;
  };

  function render() {
    sheet.replaceChildren();
    const head = document.createElement('header');
    head.className = 'rules-head';
    const h = document.createElement('h2');
    h.textContent = opts.title;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'rules-btn';
    reset.textContent = 'Restablecer';
    reset.onclick = () => {
      opts.onReset();
      close();
    };
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'rules-btn rules-close';
    closeBtn.setAttribute('aria-label', 'Cerrar reglas');
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => close();
    head.append(h, reset, closeBtn);
    const note = document.createElement('p');
    note.className = 'rules-note';
    note.textContent = 'Los cambios se aplican en la próxima partida. Cada combinación de reglas tiene su propio récord.';
    sheet.append(head, note);
    for (const c of group('world', SCOPE_TITLE.world!, manifest.world, (m) => m.world)) sheet.append(c);
    for (const c of group('player', SCOPE_TITLE.player!, manifest.player, (m) => m.player)) sheet.append(c);
    for (const id of Object.keys(manifest.prefabs)) {
      for (const c of group('prefab', `Objeto «${id}»`, manifest.prefabs[id] ?? [], (m) => m.prefabs[id] ?? [])) sheet.append(c);
    }
  }

  function close() {
    sheet.remove();
    opts.onClose();
  }
  render();
  return { close };
}

