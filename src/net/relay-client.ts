import * as ed from '@noble/ed25519';
import { hashCanonical, hexToBytes, bytesToHex } from '../sim/hash';
import type { LogEntry } from '../sim/log';
import type { RelayEntry } from '../sim/room';

export type RelayStatus = 'connecting' | 'open' | 'closed';

export type RelayEvents = {
  onStatus: (status: RelayStatus) => void;
  /** reset=true: el relay tiene menos historia que tu caché (p. ej. borraron relay.db). */
  onSync: (entries: RelayEntry[], head: number, reset: boolean) => void;
  onEntry: (item: RelayEntry) => void;
  onError: (code: string, hash: string | undefined, message: string) => void;
  onPresence: (online: string[]) => void;
};

export type RelayClient = {
  readonly url: string;
  /** false si todavía no hay sesión lista; la entrada se reenvía desde onSync. */
  send: (entry: LogEntry) => boolean;
  /** vuelve a pedir lo que falta (HELLO con el rseq actual) sin reconectar */
  resync: () => void;
  close: () => void;
};

/** Mismo host que la página; en Codespaces el puerto 5173 pasa a 8787 (hay que ponerlo Public). */
export function defaultRelayUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_RELAY_URL;
  if (env) return env;
  const { protocol, hostname } = location;
  const secure = protocol === 'https:';
  if (hostname.endsWith('.app.github.dev')) {
    return `wss://${hostname.replace(/-\d+\./, '-8787.')}`;
  }
  return `${secure ? 'wss' : 'ws'}://${hostname}:8787`;
}

export function authMessage(nonce: string, roomId: string): string {
  return hashCanonical({ domain: 'TMS_AUTH', nonce, roomId });
}

export function createRelayClient(opts: {
  url: string;
  roomId: string;
  author: string;
  privateKey: Uint8Array;
  getSince: () => number;
  events: RelayEvents;
}): RelayClient {
  let ws: WebSocket | null = null;
  let ready = false;
  let closed = false;
  let attempt = 0;
  let nonce = '';
  let current: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emitStatus = (s: RelayStatus) => opts.events.onStatus(s);

  const hello = (socket: WebSocket) => {
    const sig = bytesToHex(ed.sign(hexToBytes(authMessage(nonce, opts.roomId)), opts.privateKey));
    socket.send(JSON.stringify({ type: 'HELLO', roomId: opts.roomId, since: opts.getSince(), author: opts.author, sig }));
  };

  const connect = () => {
    if (closed) return;
    ready = false;
    emitStatus('connecting');
    const socket = new WebSocket(opts.url);
    ws = socket;

    socket.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'CHALLENGE':
          nonce = String(msg.nonce);
          current = socket;
          hello(socket);
          break;
        case 'SYNC':
          attempt = 0;
          ready = true;
          emitStatus('open');
          opts.events.onSync(msg.entries as RelayEntry[], Number(msg.head), msg.reset === true);
          break;
        case 'ENTRY':
          opts.events.onEntry(msg.item as RelayEntry);
          break;
        case 'PRESENCE':
          opts.events.onPresence(msg.online as string[]);
          break;
        case 'ERROR':
          opts.events.onError(String(msg.code), typeof msg.hash === 'string' ? msg.hash : undefined, String(msg.message ?? ''));
          break;
      }
    };

    socket.onclose = () => {
      if (ws === socket) ws = null;
      ready = false;
      emitStatus('closed');
      if (closed) return;
      const delay = Math.min(30_000, 500 * 2 ** attempt++);
      timer = setTimeout(connect, delay);
    };
    socket.onerror = () => socket.close();
  };

  connect();

  return {
    url: opts.url,
    send(entry) {
      if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'APPEND', entry }));
      return true;
    },
    resync() {
      if (current && current === ws && ws.readyState === WebSocket.OPEN && nonce) hello(ws);
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}
