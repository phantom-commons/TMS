// Relay tonto: ordena, valida y guarda. No es una autoridad de identidad:
// los clientes vuelven a verificar todo (firma, cadena y reglas) al recibirlo.
//
//   npm run relay        → ws://localhost:8787 (en Codespaces: puerto 8787 en Public)
//
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import Database from 'better-sqlite3';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { verifyEntry, type LogEntry } from '../src/sim/log';
import { applyEntry, replay } from '../src/sim/replay';
import { GENESIS_HASH, hashCanonical, hexToBytes } from '../src/sim/hash';
import type { World } from '../src/sim/world';

ed.hashes.sha512 = sha512;

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.RELAY_DB ?? join(dirname(fileURLToPath(import.meta.url)), 'relay.db');
const QUIET = process.env.QUIET === '1';

const ROOM_ID = /^[A-Za-z0-9:_-]{1,64}$/;
const TYPES = new Set(['INIT', 'ENTER', 'MOVE', 'PLACE', 'PICK_UP', 'DROP', 'PUSH', 'LOCK', 'UNLOCK', 'INTERACT', 'ATTACK', 'DOOR', 'NOTE']);
const MAX_PAYLOAD_JSON = 2048;
const MAX_ROOMS = 1000;
const MAX_ENTRIES_PER_ROOM = 200_000;
const BUCKET_CAPACITY = 60;
const BUCKET_REFILL_PER_S = 20;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    roomId    TEXT    NOT NULL,
    rseq      INTEGER NOT NULL,
    relayTime INTEGER NOT NULL,
    author    TEXT    NOT NULL,
    seq       INTEGER NOT NULL,
    hash      TEXT    NOT NULL,
    json      TEXT    NOT NULL,
    PRIMARY KEY (roomId, rseq)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS entries_chain ON entries (roomId, author, seq);
  CREATE INDEX IF NOT EXISTS entries_hash ON entries (roomId, hash);
`);

const qRoomEntries = db.prepare('SELECT rseq, relayTime, json FROM entries WHERE roomId = ? AND rseq > ? ORDER BY rseq');
const qHasHash = db.prepare('SELECT 1 FROM entries WHERE roomId = ? AND hash = ?');
const qRoomCount = db.prepare('SELECT COUNT(DISTINCT roomId) AS n FROM entries');
const qInsert = db.prepare('INSERT INTO entries (roomId, rseq, relayTime, author, seq, hash, json) VALUES (?, ?, ?, ?, ?, ?, ?)');

type RelayEntry = { rseq: number; relayTime: number; entry: LogEntry };

type Client = {
  ws: WebSocket;
  nonce: string;
  author: string | null;
  room: Room | null;
  tokens: number;
  lastRefill: number;
};

class Room {
  readonly id: string;
  world: World | null = null;
  rseq = 0;
  heads = new Map<string, { seq: number; hash: string }>();
  clients = new Set<Client>();

  constructor(id: string) {
    this.id = id;
    for (const row of qRoomEntries.all(id, 0) as Array<{ rseq: number; relayTime: number; json: string }>) {
      const entry = JSON.parse(row.json) as LogEntry;
      this.heads.set(entry.author, { seq: entry.seq, hash: entry.hash });
      if (!this.world) this.world = replay([entry]);
      else applyEntry(this.world, entry);
      this.rseq = row.rseq;
    }
  }

  entriesSince(since: number): RelayEntry[] {
    return (qRoomEntries.all(this.id, since) as Array<{ rseq: number; relayTime: number; json: string }>).map((r) => ({
      rseq: r.rseq,
      relayTime: r.relayTime,
      entry: JSON.parse(r.json) as LogEntry,
    }));
  }

  online(): string[] {
    return [...new Set([...this.clients].map((c) => c.author).filter((a): a is string => !!a))];
  }

  broadcast(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) if (c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  }
}

const rooms = new Map<string, Room>();

function getRoom(id: string): Room | null {
  let room = rooms.get(id);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = new Room(id);
    rooms.set(id, room);
  }
  return room;
}

const log = (...args: unknown[]) => {
  if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...args);
};

const send = (c: Client, msg: unknown) => {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
};
const fail = (c: Client, code: string, message: string, hash?: string) => {
  log('✗', code, message, c.author?.slice(0, 8) ?? '-');
  send(c, { type: 'ERROR', code, message, ...(hash ? { hash } : {}) });
};

function leave(c: Client): void {
  const room = c.room;
  if (!room) return;
  room.clients.delete(c);
  c.room = null;
  room.broadcast({ type: 'PRESENCE', roomId: room.id, online: room.online() });
}

function hello(c: Client, msg: Record<string, unknown>): void {
  const roomId = msg.roomId;
  const since = msg.since;
  const author = msg.author;
  const sig = msg.sig;
  if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) return fail(c, 'BAD_ROOM', 'roomId inválido');
  if (typeof author !== 'string' || !/^[0-9a-f]{64}$/i.test(author)) return fail(c, 'BAD_AUTH', 'author inválido');
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/i.test(sig)) return fail(c, 'BAD_AUTH', 'firma inválida');
  let okSig = false;
  try {
    okSig = ed.verify(hexToBytes(sig), hexToBytes(hashCanonical({ domain: 'TMS_AUTH', nonce: c.nonce, roomId })), hexToBytes(author));
  } catch { /* firma malformada */ }
  if (!okSig) return fail(c, 'BAD_AUTH', 'no demostraste tener esa clave');

  const room = getRoom(roomId);
  if (!room) return fail(c, 'TOO_MANY_ROOMS', 'el relay no acepta más salas');
  leave(c);
  c.author = author;

  const sinceN = typeof since === 'number' && Number.isInteger(since) && since >= 0 ? since : 0;
  const reset = sinceN > room.rseq;
  const entries = room.entriesSince(reset ? 0 : sinceN);
  send(c, { type: 'SYNC', roomId, entries, head: room.rseq, reset });
  c.room = room;
  room.clients.add(c);
  room.broadcast({ type: 'PRESENCE', roomId, online: room.online() });
  log('→ hello', roomId, author.slice(0, 8), `since=${sinceN} head=${room.rseq}${reset ? ' RESET' : ''}`);
}

function append(c: Client, raw: unknown): void {
  const room = c.room;
  if (!room || !c.author) return fail(c, 'NO_HELLO', 'primero HELLO');

  const now = Date.now();
  c.tokens = Math.min(BUCKET_CAPACITY, c.tokens + ((now - c.lastRefill) / 1000) * BUCKET_REFILL_PER_S);
  c.lastRefill = now;
  const hash = typeof (raw as { hash?: unknown })?.hash === 'string' ? (raw as { hash: string }).hash : undefined;
  if (c.tokens < 1) return fail(c, 'RATE_LIMIT', 'demasiado rápido', hash);
  c.tokens -= 1;

  if (typeof raw !== 'object' || raw === null) return fail(c, 'BAD_ENTRY', 'entrada inválida');
  const entry = raw as LogEntry;
  if (entry.roomId !== room.id) return fail(c, 'BAD_ROOM', 'la entrada es de otra sala', hash);
  if (entry.author !== c.author) return fail(c, 'BAD_AUTHOR', 'solo puedes firmar con tu propia clave', hash);
  if (!TYPES.has(entry.type)) return fail(c, 'BAD_TYPE', `tipo desconocido: ${String(entry.type)}`, hash);
  if (JSON.stringify(entry.payload ?? null).length > MAX_PAYLOAD_JSON) return fail(c, 'TOO_BIG', 'payload demasiado grande', hash);
  if (!verifyEntry(entry)) return fail(c, 'BAD_SIG', 'hash o firma inválidos', hash);

  const head = room.heads.get(entry.author);
  if (head && entry.seq <= head.seq) {
    // reenvío de algo ya guardado: se ignora (el cliente lo recibirá en el SYNC / ENTRY)
    if (qHasHash.get(room.id, entry.hash)) return;
    return fail(c, 'BAD_CHAIN', 'seq ya usado', entry.hash);
  }
  const chained = head ? entry.seq === head.seq + 1 && entry.prevHash === head.hash : entry.seq === 0 && entry.prevHash === GENESIS_HASH;
  if (!chained) return fail(c, 'BAD_CHAIN', 'cadena rota', entry.hash);
  if (room.rseq >= MAX_ENTRIES_PER_ROOM) return fail(c, 'ROOM_FULL', 'la sala llegó a su límite', entry.hash);

  // reglas del mundo: el relay usa la misma sim pura que los clientes
  if (entry.type === 'INIT') {
    if (room.world) return fail(c, 'ROOM_EXISTS', 'la sala ya existe', entry.hash);
    try {
      room.world = replay([entry]);
    } catch (error) {
      return fail(c, 'BAD_ACTION', (error as Error).message, entry.hash);
    }
  } else {
    if (!room.world) return fail(c, 'NO_ROOM', 'la sala aún no existe (falta INIT)', entry.hash);
    if (!applyEntry(room.world, entry)) return fail(c, 'BAD_ACTION', `${entry.type} no es válido ahora`, entry.hash);
  }

  const item: RelayEntry = { rseq: room.rseq + 1, relayTime: now, entry };
  try {
    qInsert.run(room.id, item.rseq, item.relayTime, entry.author, entry.seq, entry.hash, JSON.stringify(entry));
  } catch (error) {
    rooms.delete(room.id); // el mundo en memoria ya cambió: se recarga desde disco
    return fail(c, 'STORE_ERROR', (error as Error).message, entry.hash);
  }
  room.rseq = item.rseq;
  room.heads.set(entry.author, { seq: entry.seq, hash: entry.hash });
  room.broadcast({ type: 'ENTRY', roomId: room.id, item });
  log(`#${item.rseq}`, room.id, entry.type, entry.author.slice(0, 8), JSON.stringify(entry.payload));
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    const { n } = qRoomCount.get() as { n: number };
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: n, loaded: rooms.size }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('TMS relay\n');
});

const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const c: Client = {
    ws,
    nonce: randomBytes(16).toString('hex'),
    author: null,
    room: null,
    tokens: BUCKET_CAPACITY,
    lastRefill: Date.now(),
  };
  send(c, { type: 'CHALLENGE', nonce: c.nonce });

  ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return fail(c, 'BAD_JSON', 'mensaje ilegible');
    }
    if (msg.type === 'HELLO') hello(c, msg);
    else if (msg.type === 'APPEND') append(c, msg.entry);
    else fail(c, 'BAD_MESSAGE', `tipo desconocido: ${String(msg.type)}`);
  });
  ws.on('close', () => leave(c));
  ws.on('error', () => ws.close());
});

http.listen(PORT, '0.0.0.0', () => log(`relay listo en :${PORT}  db=${DB_PATH}`));

const shutdown = () => {
  wss.close();
  http.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
