import type { LogEntry } from '../sim/log';

export function getEventTime(entry: LogEntry): string {
  return new Date(entry.hlc.t).toLocaleString();
}