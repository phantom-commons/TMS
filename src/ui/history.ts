import type { LogEntry } from '../sim/log';
import { getEventTime } from './time';

const MAX_ROWS = 500;

function shortAuthor(author: string): string {
  return `${author.slice(0, 8)}…${author.slice(-4)}`;
}

export function showHistoryPanel(title: string, entries: readonly LogEntry[], summary: string[] = []): void {
  document.getElementById('history-panel')?.remove();
  const panel = document.createElement('aside');
  panel.id = 'history-panel';
  panel.className = 'history-panel';

  const header = document.createElement('header');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Cerrar historial');
  close.onclick = () => panel.remove();
  header.append(heading, close);
  panel.append(header);

  if (summary.length) {
    const stats = document.createElement('div');
    stats.className = 'history-summary';
    stats.textContent = summary.join(' · ');
    panel.append(stats);
  }

  const count = document.createElement('p');
  count.className = 'history-count';
  count.textContent = `${entries.length} eventos en el historial${entries.length > MAX_ROWS ? ` (mostrando los últimos ${MAX_ROWS})` : ''}`;
  panel.append(count);

  const list = document.createElement('ol');
  list.className = 'history-list';
  for (const entry of [...entries].reverse().slice(0, MAX_ROWS)) {
    const item = document.createElement('li');
    const type = document.createElement('strong');
    type.textContent = entry.type;
    const detail = document.createElement('span');
    detail.textContent = `${shortAuthor(entry.author)} · ${getEventTime(entry)} · ${JSON.stringify(entry.payload)}`;
    item.append(type, detail);
    list.append(item);
  }
  panel.append(list);
  document.body.append(panel);
}
