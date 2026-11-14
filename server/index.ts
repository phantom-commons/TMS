import { WebSocketServer, type WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { verifyEntry, type LogEntry } from '../src/sim/log';
import { GENESIS_HASH } from '../src/sim/hash';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.RELAY_DB ?? 'server/relay.db';
const ALLOWED = new Set(['INIT', 'ENTER', 'MOVE']);
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    room_id    TEXT    NOT NULL,
    rseq       INTEGER NOT NULL,
    author     TEXT    NOT NULL,
    seq        INTEGER NOT NULL,
    hash       TEXT    NOT NULL,
    relay_time INTEGER NOT NULL,
    json       TEXT    NOT NULL,
    PRIMARY KEY (room_id, rseq),
    UNIQUE (room_id, hash)
  );
  CREATE INDEX IF NOT EXISTS idx_author ON entries (room_id, author, seq);
`);

type Row = { rseq: number; relayTime: number; json: string };
type Item = { rseq: number; relayTime: number; entry: LogEntry };
type AppendResult =
  | { status: 'ok'; item: Item }
  | { status: 'dup' }
  | { status: 'error'; code: string };

const qSince = db.prepare(
  'SELECT rseq, relay_time AS relayTime, json FROM entries WHERE room_id = ? AND rseq > ? ORDER BY rseq LIMIT 1000',
);
const qMax = db.prepare('SELECT COALESCE(MAX(rseq), 0) AS m FROM entries WHERE room_id = ?');
const qHead = db.prepare(
  'SELECT seq, hash FROM entries WHERE room_id = ? AND author = ? ORDER BY seq DESC LIMIT 1',
);
const qHas = db.prepare('SELECT 1 AS x FROM entries WHERE room_id = ? AND hash = ?');
const qInsert = db.prepare(
  'INSERT INTO entries (room_id, rseq, author, seq, hash, relay_time, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

// Una sola transacción: ordenar (rseq) + comprobar cadena + guardar.
const append = db.transaction((room: string, entry: LogEntry): AppendResult => {
  if (qHas.get(room, entry.hash)) return { status: 'dup' };

  const max = (qMax.get(room) as { m: number }).m;
  if (max === 0 && entry.type !== 'INIT') return { status: 'error', code: 'NO_ROOM' };
  if (max > 0 && entry.type === 'INIT') return { status: 'error', code: 'ROOM_EXISTS' };

  const head = qHead.get(room, entry.author) as { seq: number; hash: string } | undefined;
  const chained = head
    ? entry.seq === head.seq + 1 && entry.prevHash === head.hash
    : entry.seq === 0 && entry.prevHash === GENESIS_HASH;
  if (!chained) return { status: 'error', code: 'BAD_CHAIN' };

  const rseq = max + 1;
  const relayTime = Date.now();
  qInsert.run(room, rseq, entry.author, entry.seq, entry.hash, relayTime, JSON.stringify(entry));
  return { status: 'ok', item: { rseq, relayTime, entry } };
});

function isEntry(x: unknown): x is LogEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  const h = e.hlc as Record<string, unknown> | undefined;
  return (
    typeof e.seq === 'number' && Number.isInteger(e.seq) && e.seq >= 0 &&
    typeof e.type === 'string' && typeof e.roomId === 'string' &&
    typeof e.author === 'string' && typeof e.prevHash === 'string' &&
    typeof e.hash === 'string' && typeof e.sig === 'string' && 'payload' in e &&
    typeof h === 'object' && h !== null && typeof h.t === 'number' && typeof h.c === 'number'
  );
}

const rooms = new Map<string, Set<WebSocket>>();
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0', maxPayload: 16 * 1024 });

const send = (ws: WebSocket, m: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
};
const fail = (ws: WebSocket, code: string, hash?: string) => {
  log('✗', code, hash?.slice(0, 8) ?? '');
  send(ws, { t: 'ERROR', code, hash });
};

wss.on('connection', (ws) => {  log('+ conexión,', wss.clients.size, 'clientes');
  let room: string | null = null;

  ws.on('message', (raw) => {
    let m: { t?: unknown; roomId?: unknown; since?: unknown; entry?: unknown };
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return fail(ws, 'BAD_JSON');
    }

    if (m.t === 'HELLO') {
      if (typeof m.roomId !== 'string' || !ROOM_RE.test(m.roomId)) return fail(ws, 'BAD_ROOM');
      const since = typeof m.since === 'number' && Number.isInteger(m.since) && m.since >= 0 ? m.since : 0;
      if (room && room !== m.roomId) rooms.get(room)?.delete(ws);
      room = m.roomId;
      let subs = rooms.get(room);
      if (!subs) rooms.set(room, (subs = new Set()));
      subs.add(ws);

      const rows = qSince.all(room, since) as Row[];
      const head = (qMax.get(room) as { m: number }).m;
      log('APPEND', room, '#' + r.item.rseq, e.type, e.author.slice(0, 8), 'seq', e.seq);

      return send(ws, {
        t: 'SYNC',
        roomId: room,
        head,
        entries: rows.map((r) => ({ rseq: r.rseq, relayTime: r.relayTime, entry: JSON.parse(r.json) })),
      });
    }

    if (m.t === 'APPEND') {
      if (!room) return fail(ws, 'NO_HELLO');
      const e = m.entry;
      if (!isEntry(e)) return fail(ws, 'BAD_ENTRY');
      if (e.roomId !== room) return fail(ws, 'BAD_ROOM', e.hash);
      if (!ALLOWED.has(e.type)) return fail(ws, 'BAD_TYPE', e.hash);

      let valid = false;
      try {
        valid = verifyEntry(e);
      } catch {
        /* entrada malformada */
      }
      if (!valid) return fail(ws, 'BAD_SIG', e.hash);

      const r = append(room, e);
      if (r.status === 'error') return fail(ws, r.code, e.hash);
      if (r.status === 'dup') return;
            log('APPEND', room, '#' + r.item.rseq, e.type, e.author.slice(0, 8), 'seq', e.seq);

      const msg = JSON.stringify({ t: 'ENTRY', roomId: room, item: r.item });
      for (const s of rooms.get(room) ?? []) if (s.readyState === s.OPEN) s.send(msg);
    }
  });

  ws.on('close', () => {log('- cierre', room ?? '-');
    if (room) rooms.get(room)?.delete(ws);
  });
});

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);