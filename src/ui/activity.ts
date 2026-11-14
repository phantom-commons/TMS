import type { LogEntry, LogEntryType } from '../sim/log';
import { getEventTime } from '../sim/history';

export type ActivityRange = '24h' | '7d' | 'all';
export type ActivityGrouping = 'visitor' | 'day';

type ActivitySummary = {
  author: string;
  entries: LogEntry[];
  visits: number;
  steps: number;
  interactions: number;
  lastAt: number;
};

const VISIT_TYPES = new Set<LogEntryType>(['INIT', 'ENTER']);
const INTERACTION_TYPES = new Set<LogEntryType>([
  'INTERACT', 'PLACE', 'PICK_UP', 'DROP', 'PUSH', 'LOCK', 'UNLOCK', 'DOOR', 'NOTE',
]);

function shortKey(author: string): string {
  return `${author.slice(0, 8)}…${author.slice(-6)}`;
}

function latestAt(entries: readonly LogEntry[]): number {
  return entries.reduce((latest, entry) => Math.max(latest, entry.hlc.t), 0);
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function summarize(author: string, entries: LogEntry[]): ActivitySummary {
  return {
    author,
    entries,
    visits: entries.filter((entry) => VISIT_TYPES.has(entry.type)).length,
    steps: entries.filter((entry) => entry.type === 'MOVE').length,
    interactions: entries.filter((entry) => INTERACTION_TYPES.has(entry.type)).length,
    lastAt: latestAt(entries),
  };
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function eventLabel(entry: LogEntry): string {
  const labels: Record<LogEntryType, string> = {
    INIT: 'Creó la habitación',
    ENTER: 'Entró en la habitación',
    MOVE: 'Se desplazó',
    PLACE: 'Colocó un objeto',
    PICK_UP: 'Recogió un objeto',
    DROP: 'Soltó un objeto',
    PUSH: 'Movió un objeto',
    LOCK: 'Bloqueó un objeto',
    UNLOCK: 'Desbloqueó un objeto',
    INTERACT: 'Interactuó',
    DOOR: 'Usó una puerta',
    NOTE: 'Añadió una nota',
  };
  return labels[entry.type];
}

function eventDetail(entry: LogEntry): string {
  if (!entry.payload || typeof entry.payload !== 'object') return '';
  const payload = entry.payload as Record<string, unknown>;
  const entity = typeof payload.entityId === 'string' ? payload.entityId : '';
  const x = typeof payload.x === 'number' ? payload.x : null;
  const y = typeof payload.y === 'number' ? payload.y : null;
  if (entity && x !== null && y !== null) return `${entity} · (${x}, ${y})`;
  if (entity) return entity;
  if (x !== null && y !== null) return `(${x}, ${y})`;
  const cell = payload.cell;
  if (cell && typeof cell === 'object') {
    const point = cell as Record<string, unknown>;
    if (typeof point.x === 'number' && typeof point.y === 'number') return `(${point.x}, ${point.y})`;
  }
  return '';
}

function renderEvent(entry: LogEntry): HTMLLIElement {
  const item = make('li', 'activity-event');
  const title = make('strong', 'activity-event-title', eventLabel(entry));
  const time = make('time', 'activity-event-time', getEventTime(entry));
  const detailText = eventDetail(entry);
  item.append(title, time);
  if (detailText) item.append(make('span', 'activity-event-detail', detailText));
  return item;
}

function renderVisitor(summary: ActivitySummary, localAuthor: string): HTMLDetailsElement {
  const details = make('details', 'activity-group');
  const summaryNode = make('summary', 'activity-group-summary');
  const identity = make('span', 'activity-identity');
  const label = summary.author === localAuthor ? 'Tú' : `Visitante ${shortKey(summary.author)}`;
  identity.append(make('strong', '', label));
  identity.append(make('small', '', `Última actividad · ${new Date(summary.lastAt).toLocaleString()}`));

  const counts = make('span', 'activity-counts');
  counts.append(
    make('i', 'activity-count', `${summary.visits} visitas`),
    make('i', 'activity-count', `${summary.steps} pasos`),
    make('i', 'activity-count', `${summary.interactions} interacciones`),
  );
  summaryNode.append(identity, counts);
  const list = make('ol', 'activity-events');
  for (const entry of [...summary.entries].sort((a, b) => b.hlc.t - a.hlc.t || b.seq - a.seq)) {
    list.append(renderEvent(entry));
  }
  details.append(summaryNode, list);
  return details;
}

function renderDay(day: string, entries: LogEntry[], localAuthor: string): HTMLElement {
  const section = make('section', 'activity-day');
  const date = new Date(`${day}T12:00:00`);
  const title = make('h3', 'activity-day-title', date.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
  }));
  const byAuthor = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const list = byAuthor.get(entry.author) ?? [];
    list.push(entry);
    byAuthor.set(entry.author, list);
  }
  section.append(title);
  for (const [author, authored] of [...byAuthor.entries()].sort((a, b) => {
    return latestAt(b[1]) - latestAt(a[1]);
  })) {
    section.append(renderVisitor(summarize(author, authored), localAuthor));
  }
  return section;
}

export function showRoomActivityPanel(
  allEntries: readonly LogEntry[],
  localAuthor: string,
): void {
  document.getElementById('activity-panel')?.remove();
  const panel = make('aside', 'activity-panel');
  panel.id = 'activity-panel';

  const header = make('header', 'activity-header');
  const titleBox = make('div', 'activity-title-box');
  titleBox.append(make('strong', '', 'Actividad de la habitación'));
  titleBox.append(make('small', '', 'Visitas, recorridos e interacciones'));
  const close = make('button', 'activity-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar actividad');
  close.addEventListener('click', () => panel.remove());
  header.append(titleBox, close);

  const controls = make('div', 'activity-controls');
  const range = make('select', 'activity-select') as HTMLSelectElement;
  range.setAttribute('aria-label', 'Periodo de actividad');
  range.add(new Option('Últimas 24 horas', '24h'));
  range.add(new Option('Últimos 7 días', '7d'));
  range.add(new Option('Todo el historial', 'all'));
  range.value = '7d';
  const grouping = make('select', 'activity-select') as HTMLSelectElement;
  grouping.setAttribute('aria-label', 'Agrupar actividad');
  grouping.add(new Option('Por visitante', 'visitor'));
  grouping.add(new Option('Por día', 'day'));
  grouping.value = 'visitor';
  controls.append(range, grouping);

  const metrics = make('div', 'activity-overview');
  const content = make('div', 'activity-content');

  const render = () => {
    const now = Date.now();
    const cutoff = range.value === '24h'
      ? now - 24 * 60 * 60 * 1000
      : range.value === '7d'
        ? now - 7 * 24 * 60 * 60 * 1000
        : 0;
    const entries = allEntries
      .filter((entry) => entry.hlc.t >= cutoff)
      .sort((a, b) => b.hlc.t - a.hlc.t || b.seq - a.seq);
    const authors = new Set(entries.map((entry) => entry.author));
    const visits = entries.filter((entry) => VISIT_TYPES.has(entry.type)).length;
    const interactions = entries.filter((entry) => INTERACTION_TYPES.has(entry.type)).length;

    metrics.replaceChildren(
      make('span', 'activity-stat', `${authors.size} visitantes`),
      make('span', 'activity-stat', `${visits} entradas`),
      make('span', 'activity-stat', `${interactions} interacciones`),
    );
    content.replaceChildren();
    if (!entries.length) {
      content.append(make('p', 'activity-empty', 'No hay actividad en este periodo.'));
      return;
    }

    if (grouping.value === 'visitor') {
      const byAuthor = new Map<string, LogEntry[]>();
      for (const entry of entries) {
        const list = byAuthor.get(entry.author) ?? [];
        list.push(entry);
        byAuthor.set(entry.author, list);
      }
      const ordered = [...byAuthor.entries()].sort((a, b) => latestAt(b[1]) - latestAt(a[1]));
      for (const [author, authored] of ordered) content.append(renderVisitor(summarize(author, authored), localAuthor));
    } else {
      const byDay = new Map<string, LogEntry[]>();
      for (const entry of entries) {
        const day = dayKey(entry.hlc.t);
        const list = byDay.get(day) ?? [];
        list.push(entry);
        byDay.set(day, list);
      }
      for (const [day, dayEntries] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
        content.append(renderDay(day, dayEntries, localAuthor));
      }
    }
  };

  range.addEventListener('change', render);
  grouping.addEventListener('change', render);
  panel.append(header, controls, metrics, content);
  document.body.append(panel);
  render();
}

export function attachActivityHud(getEntries: () => readonly LogEntry[], localAuthor: string): void {
  document.getElementById('activity-hud')?.remove();
  const button = make('button', 'activity-hud', '◷');
  button.id = 'activity-hud';
  button.type = 'button';
  button.title = 'Actividad de la habitación';
  button.setAttribute('aria-label', 'Abrir actividad de la habitación');
  button.addEventListener('click', () => showRoomActivityPanel(getEntries(), localAuthor));
  document.body.append(button);
}
