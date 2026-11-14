import { WebSocketServer, type WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { verifyEntry, type LogEntry } from '../src/sim/log';
import { GENESIS_HASH } from '../src/sim/hash';
import { applyEntry, replay } from '../src/sim/replay';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.RELAY_DB ?? 'server/relay.db';
const ALLOWED = new Set([
  'INIT', 'ENTER', 'MOVE', 'PLACE', 'PICK_UP', 'DROP', 'PUSH', 'LOCK', 'UNLOCK', 'INTERACT',
]);
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
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
  CREATE UNIQUE INDEX IF NOT EXISTS idx_author_seq_unique ON entries (room_id, author, seq);
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
const qAll = db.prepare('SELECT json FROM entries WHERE room_id = ? ORDER BY rseq');
const qMax = db.prepare('SELECT COALESCE(MAX(rseq), 0) AS m FROM entries WHERE room_id = ?');
const qHead = db.prepare(
  'SELECT seq, hash FROM entries WHERE room_id = ? AND author = ? ORDER BY seq DESC LIMIT 1',
);
const qHas = db.prepare('SELECT 1 AS x FROM entries WHERE room_id = ? AND hash = ?');
const qInsert = db.prepare(
  'INSERT INTO entries (room_id, rseq, author, seq, hash, relay_time, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

/**
 * Relay order (rseq) is the room's total order. Each author independently
 * maintains a signed seq/prevHash chain. Semantic validation is performed
 * against the latest ordered room state before an rseq is allocated.
 */
const append = db.transaction((room: string, entry: LogEntry): AppendResult => {
  if (qHas.get(room, entry.hash)) return { status: 'dup' };

  const max = (qMax.get(room) as { m: number }).m;
  const priorRows = qAll.all(room) as Array<{ json: string }>;
  if (max === 0) {
    if (entry.type !== 'INIT') return { status: 'error', code: 'NO_ROOM' };
    try {
      replay([entry]);
    } catch {
      return { status: 'error', code: 'INVALID_ACTION' };
    }
  } else {
    if (entry.type === 'INIT') return { status: 'error', code: 'ROOM_EXISTS' };
    try {
      const current = replay(priorRows.map((row) => JSON.parse(row.json) as LogEntry));
      if (!applyEntry(current, entry)) return { status: 'error', code: 'INVALID_ACTION' };
    } catch {
      return { status: 'error', code: 'CORRUPT_ROOM' };
    }
  }

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

function isEntry(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const hlc = entry.hlc as Record<string, unknown> | undefined;
  return (
    typeof entry.seq === 'number' && Number.isInteger(entry.seq) && entry.seq >= 0 &&
    typeof entry.type === 'string' && typeof entry.roomId === 'string' &&
    typeof entry.author === 'string' && typeof entry.prevHash === 'string' &&
    typeof entry.hash === 'string' && typeof entry.sig === 'string' && 'payload' in entry &&
    typeof hlc === 'object' && hlc !== null &&
    typeof hlc.t === 'number' && Number.isFinite(hlc.t) &&
    typeof hlc.c === 'number' && Number.isInteger(hlc.c) && hlc.c >= 0
  );
}

const rooms = new Map<string, Set<WebSocket>>();
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0', maxPayload: 16 * 1024 });

const send = (ws: WebSocket, message: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
};
const fail = (ws: WebSocket, code: string, hash?: string) => {
  log('✗', code, hash?.slice(0, 8) ?? '');
  send(ws, { t: 'ERROR', code, hash });
};

wss.on('connection', (ws) => {
  log('+ conexión', wss.clients.size, 'clientes');
  let room: string | null = null;

  ws.on('message', (raw) => {
    let message: { t?: unknown; roomId?: unknown; since?: unknown; entry?: unknown };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      fail(ws, 'BAD_JSON');
      return;
    }

    if (message.t === 'HELLO') {
      if (typeof message.roomId !== 'string' || !ROOM_RE.test(message.roomId)) {
        fail(ws, 'BAD_ROOM');
        return;
      }
      const since = typeof message.since === 'number' && Number.isInteger(message.since) && message.since >= 0
        ? message.since
        : 0;

      if (room && room !== message.roomId) rooms.get(room)?.delete(ws);
      room = message.roomId;
      let subscribers = rooms.get(room);
      if (!subscribers) rooms.set(room, (subscribers = new Set()));
      subscribers.add(ws);

      const rows = qSince.all(room, since) as Row[];
      const head = (qMax.get(room) as { m: number }).m;
      send(ws, {
        t: 'SYNC',
        roomId: room,
        head,
        entries: rows.map((row) => ({
          rseq: row.rseq,
          relayTime: row.relayTime,
          entry: JSON.parse(row.json) as LogEntry,
        })),
      });
      return;
    }

    if (message.t === 'APPEND') {
      if (!room) {
        fail(ws, 'NO_HELLO');
        return;
      }
      const entry = message.entry;
      if (!isEntry(entry)) {
        fail(ws, 'BAD_ENTRY');
        return;
      }
      if (entry.roomId !== room) {
        fail(ws, 'BAD_ROOM', entry.hash);
        return;
      }
      if (!ALLOWED.has(entry.type)) {
        fail(ws, 'BAD_TYPE', entry.hash);
        return;
      }
      if (!verifyEntry(entry)) {
        fail(ws, 'BAD_SIG', entry.hash);
        return;
      }

      const result = append(room, entry);
      if (result.status === 'error') {
        fail(ws, result.code, entry.hash);
        return;
      }
      if (result.status === 'dup') return;

      log('APPEND', room, `#${result.item.rseq}`, entry.type, entry.author.slice(0, 8), 'seq', entry.seq);
      const payload = JSON.stringify({ t: 'ENTRY', roomId: room, item: result.item });
      for (const subscriber of rooms.get(room) ?? []) {
        if (subscriber.readyState === subscriber.OPEN) subscriber.send(payload);
      }
    }
  });

  ws.on('close', () => {
    log('- cierre', room ?? '-');
    if (room) {
      const subscribers = rooms.get(room);
      subscribers?.delete(ws);
      if (subscribers?.size === 0) rooms.delete(room);
    }
  });
});

wss.on('listening', () => log(`relay escuchando en ${PORT}`));
wss.on('error', (error) => log('error del relay:', error.message));

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...args);
