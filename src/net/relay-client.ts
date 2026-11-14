import type { LogEntry } from '../sim/log';
import type { RelayEntry } from '../sim/room';

export type RelayHandlers = {
  onStatus: (s: 'connecting' | 'open' | 'closed') => void;
  onSync: (items: RelayEntry[], head: number) => void;
  onEntry: (item: RelayEntry) => void;
  onError: (code: string, hash?: string) => void;
};

export type RelayClient = {
  append: (entry: LogEntry) => boolean;
  hello: () => void;
  close: () => void;
};

type ServerMsg =
  | { t: 'SYNC'; roomId: string; head: number; entries: RelayEntry[] }
  | { t: 'ENTRY'; roomId: string; item: RelayEntry }
  | { t: 'ERROR'; code: string; hash?: string };

export function connectRelay(
  url: string,
  roomId: string,
  getSince: () => number,
  h: RelayHandlers,
): RelayClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const send = (m: unknown): boolean => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(m));
    return true;
  };
  const hello = () => void send({ t: 'HELLO', roomId, since: getSince() });

  const open = () => {
    h.onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      h.onStatus('open');
      hello();
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'SYNC') h.onSync(m.entries, m.head);
      else if (m.t === 'ENTRY') h.onEntry(m.item);
      else if (m.t === 'ERROR') h.onError(m.code, m.hash);
    };
    ws.onclose = () => {
      h.onStatus('closed');
      if (!closed) window.setTimeout(open, Math.min(10_000, 500 * 2 ** retry++));
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return {
    append: (entry) => send({ t: 'APPEND', entry }),
    hello,
    close: () => {
      closed = true;
      ws?.close();
    },
  };
}