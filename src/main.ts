import './style.css';
import { ROOM_W, ROOM_H, canStep, createGenesisRoom, type World } from './sim/world';
import { createController } from './input/controller';
import { createKeyboard } from './input/keyboard';
import { createTouchPad } from './input/touchpad';
import { createGamepad } from './input/gamepad';
import { createScene } from './render/scene';
import { createSyncer } from './render/sync';
import { ensureIdentity } from './ui/login';
import { attachMenu, getInspectorMode, type InspectorMode } from './ui/menu';
import { attachLocalClock } from './ui/clock';
import { showHistoryPanel } from './ui/history';
import { getCellHistory, getEntityHistory, getAuthorHistory } from './sim/history';
import { attachWorldInteractions } from './render/interactions';
import { shortPubkey } from './identity/keys';
import { HLClock } from './sim/hlc';
import { bytesToHex } from './sim/hash';
import { signEntry, type LogEntryType } from './sim/log';
import { RoomState, type ApplyResult } from './sim/room';
import { loadRoom, saveRoomItems, clearRoom } from './identity/room-storage';
import { connectRelay, type RelayClient } from './net/relay-client';

function relayUrl(): string {
  const env = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (env) return env;
  const { protocol, hostname } = location;
  // GitHub Codespaces: el puerto del relay (8787) se reenvía como otro subdominio
  if (hostname.endsWith('.app.github.dev')) return `wss://${hostname.replace(/-\d+\./, '-8787.')}`;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${hostname}:8787`;
}

async function boot() {
  const identity = await ensureIdentity();
  const author = bytesToHex(identity.publicKey);
  console.log('identity:', identity.username, shortPubkey(identity.publicKey));
  const detachClock = attachLocalClock();
  window.addEventListener('beforeunload', detachClock, { once: true });

  const roomId = new URLSearchParams(location.search).get('room') ?? 'lobby';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw new Error('room inválida');

  const room = new RoomState(roomId);
  const clock = new HLClock(() => Date.now());

  // 1) caché local: se verifica igual que lo que llega del relay
  const cached = room.applyConfirmed(await loadRoom(roomId));
  if (cached.error) {
    console.error('caché corrupta:', cached.error);
    alert('Caché de la room corrupta: ' + cached.error);
    return;
  }
  const mine = room.lastOf(author);
  if (mine) clock.reset(mine.hlc);

  let world: World = room.world() ?? createGenesisRoom(roomId);
  const refresh = () => {
    world = room.world() ?? world;
  };

  const canvas = document.getElementById('app') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing canvas#app');
  const { scene, renderer, cameraRig } = createScene(canvas, ROOM_W, ROOM_H);
  const syncer = createSyncer(scene, world, author);

  let inspectorMode: InspectorMode = getInspectorMode();
  const openRoomLog = () => {
    const entries = room.allEntries();
    const authors = new Set(entries.map((entry) => entry.author));
    showHistoryPanel(`Room Log · ${roomId}`, entries, [
      `${entries.length} eventos`, `${authors.size} autores`, `rseq ${room.lastRseq}`,
    ]);
  };
  const updateInspectorMode = (mode: InspectorMode) => {
    inspectorMode = mode;
    const panel = document.getElementById('history-panel');
    if (mode === 'off') panel?.remove();
    if (mode === 'always' && !panel) openRoomLog();
  };
  attachMenu(identity, {
    onCameraChange: (mode) => cameraRig.setMode(mode),
    onRoomLog: openRoomLog,
    onInspectorChange: updateInspectorMode,
    onOpenLab: () => {
      const panel = document.createElement('aside');
      panel.className = 'history-panel';
      panel.innerHTML = '<header><strong>Three.js Lab</strong><button type="button" aria-label="Cerrar">×</button></header><p>El acceso está reservado en el HUD. El laboratorio aislado se añadirá como módulo independiente para no alterar esta habitación.</p>';
      panel.querySelector('button')?.addEventListener('click', () => panel.remove());
      document.body.append(panel);
    },
  });

  attachWorldInteractions(canvas, () => cameraRig.getCamera(), syncer.entityMeshes, {
    onEntityClick: (entityId) => {
      if (inspectorMode === 'off') return;
      if (entityId.startsWith('player:')) {
        const playerId = entityId.slice('player:'.length);
        showHistoryPanel(`Visitante · ${playerId.slice(0, 8)}`, getAuthorHistory(world, room.allEntries(), playerId));
      } else {
        showHistoryPanel(`Objeto · ${entityId}`, getEntityHistory(world, room.allEntries(), entityId));
      }
    },
    onEntityDrop: (entityId, x, y) => {
      if (inspectorMode !== 'off') showHistoryPanel(`Soltar · ${entityId}`, getEntityHistory(world, room.allEntries(), entityId), [`Destino ${x}, ${y}`, 'El gesto de soltar aún no emite DROP en esta versión']);
    },
    onCellClick: (x, y) => {
      if (inspectorMode === 'off') return;
      showHistoryPanel(`Celda · ${x}, ${y}`, getCellHistory(world, room.allEntries(), x, y));
    },
  });
  if (inspectorMode === 'always') openRoomLog();

  let ready = false; // conectado y sincronizado

  const send = (type: LogEntryType, payload: unknown) => {
    const entry = signEntry(
      { ...room.nextFor(author), type, roomId, payload, author, hlc: clock.tick() },
      identity.privateKey,
    );
    room.addPending(entry);
    refresh();
    relay.append(entry);
  };

  const ensurePresence = () => {
    if (!room.hasInit()) send('INIT', { spawn: { x: 3, y: 3 }, owner: author });
    else if (!world.players[author]) send('ENTER', { x: world.spawn.x, y: world.spawn.y });
  };

  const handle = (res: ApplyResult) => {
    if (res.accepted.length) {
      void saveRoomItems(roomId, res.accepted);
      refresh();
    }
    if (res.error) console.error('entrada rechazada:', res.error);
  };

  const relay: RelayClient = connectRelay(relayUrl(), roomId, () => room.lastRseq, {
    onStatus: (s) => {
      document.title = `TMS · ${s} · ${roomId}`;
      if (s !== 'open') {
        ready = false;
        room.dropPending();
        refresh();
      }
    },
    onSync: (items, head) => {
      if (head < room.lastRseq) {
        // el relay tiene menos historia que tu caché (¿relay reiniciado?)
        console.warn('relay con menos historia que la caché local: descartando caché de la room');
        void clearRoom(roomId).then(() => location.reload());
        return;
      }
      const res = room.applyConfirmed(items);
      handle(res);
      if (res.error) return;
      if (res.gap || room.lastRseq < head) {
        relay.hello(); // faltan entradas: pide el resto
        return;
      }
      ready = true;
      ensurePresence();
    },
    onEntry: (item) => {
      const res = room.applyConfirmed([item]);
      handle(res);
      if (res.gap) relay.hello();
    },
    onError: (code, hash) => {
      console.warn('relay error:', code, hash);
      room.dropPending();
      refresh();
      relay.hello(); // resincroniza; si faltaba entrar, ensurePresence lo repite
    },
  });

  let lastMove = 0;

  const step = (dx: number, dy: number) => {
    if (!ready) return;
    const p = world.players[author];
    if (!p) return;

    const tries: Array<[number, number]> =
      dx !== 0 && dy !== 0 ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
    const m = tries.find(([a, b]) => canStep(world, p.x, p.y, a, b));
    if (!m) return;

    const now = performance.now();
    const cooldown = m[0] !== 0 && m[1] !== 0 ? 170 : 120;
    if (now - lastMove < cooldown) return;
    lastMove = now;

    send('MOVE', { x: p.x + m[0], y: p.y + m[1] });
  };

  const controller = createController([createKeyboard(), createTouchPad(), createGamepad()]);

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const v = controller.read();
    if (v.dx !== 0 || v.dy !== 0) step(v.dx, v.dy);
    syncer.update(world, dt);
    renderer.render(scene, cameraRig.getCamera());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error('boot failed:', e);
  document.body.innerHTML = `<pre style="color:#ff6b6b;padding:24px;font-family:monospace">boot failed:\n${e}</pre>`;
});