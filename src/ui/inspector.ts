import type { LogEntry } from '../sim/log';
import { getEventTime } from '../sim/history';

export type InspectorModel = {
  title: string;
  summary: string[];
  events: readonly LogEntry[];
};

export type Inspector = {
  render: (model: InspectorModel | null) => void;
  dispose: () => void;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-3)}`;

/** Inspector fijo abajo a la izquierda, tenue: historial del objeto o de la celda seleccionada. */
export function createInspector(onFullLog: () => void): Inspector {
  const root = document.createElement('aside');
  root.className = 'inspector';
  root.hidden = true;

  const head = document.createElement('header');
  const title = document.createElement('strong');
  const full = document.createElement('button');
  full.type = 'button';
  full.textContent = 'log de la sala';
  full.onclick = onFullLog;
  head.append(title, full);

  const summary = document.createElement('p');
  const list = document.createElement('ol');
  root.append(head, summary, list);
  document.body.append(root);

  return {
    render(model) {
      root.hidden = model === null;
      if (!model) return;
      title.textContent = model.title;
      summary.textContent = model.summary.join(' · ');
      list.replaceChildren();
      for (const e of [...model.events].slice(-8).reverse()) {
        const li = document.createElement('li');
        li.textContent = `${e.type} · ${short(e.author)} · ${getEventTime(e)}`;
        list.append(li);
      }
      if (model.events.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'sin eventos todavía';
        list.append(li);
      }
    },
    dispose: () => root.remove(),
  };
}
