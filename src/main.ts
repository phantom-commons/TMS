import './style.css';
import { ROOM_W, ROOM_H, canStep, createGenesisRoom, type World } from './sim/world';
import { createController } from './input/controller';
import { createKeyboard } from './input/keyboard';
import { createTouchPad } from './input/touchpad';
import { createGamepad } from './input/gamepad';
import { ensureIdentity } from './ui/login';
import { attachMenu } from './ui/menu';
import { showHistoryPanel } from './ui/history';
import { attachActivityHud } from './ui/activity';
import { attachCameraControls } from './ui/camera';
import {
  getAuthorHistory,
  getCellHistory,
  getCellStats,
  getEntityHistory,
  getEntityStats,
} from './sim/history';
import { shortPubkey } from './identity/keys';
import { HLClock } from './sim/hlc';
import { bytesToHex } from './sim/hash';
import { signEntry, type LogEntryType } from './sim/log';
import { RoomState, type ApplyResult } from './sim/room';
import { previewEntry, replay } from './sim/replay';
import {
  loadPendingRoom,
  loadRoom,
  savePendingEntry,
  saveRoomItems,
  deletePendingEntries,
} from './identity/room-storage';
import { connectRelay, type RelayClient } from './net/relay-client';

function relayUrl(): string {
  const env = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (env) return env;
  const { protocol, hostname } = location;
  if (hostname.endsWith('.app.github.dev')) return `wss://${hostname.replace(/-\d+\./, '-8787.')}`;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${hostname}:8787`;
}

async function boot() {
  const identity = await ensureIdentity();
  const author = bytesToHex(identity.publicKey);
  console.log('identity:', identity.username, shortPubkey(identity.publicKey));
  attachMenu(identity);

  const params = new URLSearchParams(location.search);
  const isPersonalRoom = !params.has('room');
  // Personal rooms remain device-local by default; adding ?room= explicitly opts into a relay room.
  const roomId = params.get('room') ?? `home-${author.slice(0, 56)}`;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw new Error('room inválida');

  const room = new RoomState(roomId);
  const clock = new HLClock(() => Date.now());

  // Confirmed history is cached separately from events created while offline.
  const cached = room.applyConfirmed(await loadRoom(roomId));
  if (cached.error) throw new Error(`caché local inválida: ${cached.error}`);
  const localPending = await loadPendingRoom(roomId);
  const persistedPendingHashes = new Set(localPending.map((entry) => entry.hash));
  for (const entry of localPending) {
    if (!room.hasConfirmedHash(entry.hash)) room.addPending(entry);
  }

  const mine = room.pendingEntries().filter((entry) => entry.author === author).at(-1)
    ?? room.lastOf(author);
  if (mine) clock.reset(mine.hlc);

  let world: World = room.world() ?? createGenesisRoom(roomId);
  const refresh = () => {
    const current = room.world();
    if (current) world = current;
  };

  const canvas = document.getElementById('app') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing canvas#app');
  // Defer Three.js and rendering modules until the identity and room are ready.
  const [sceneModule, syncModule, interactionsModule] = await Promise.all([
    import('./render/scene'),
    import('./render/sync'),
    import('./render/interactions'),
  ]);
  const { scene, cameraRig, renderer } = sceneModule.createScene(canvas, ROOM_W, ROOM_H);
  attachCameraControls(cameraRig);
  attachActivityHud(() => room.allEntries(), author);
  const syncer = syncModule.createSyncer(scene, world, author);

  let relay: RelayClient | null = null;
  let online = false;
  let synced = false;
  let relayBehind = false;
  let blockedPendingHash: string | null = null;

  const send = (type: LogEntryType, payload: unknown): boolean => {
    const entry = signEntry(
      { ...room.nextFor(author), type, roomId, payload, author, hlc: clock.tick() },
      identity.privateKey,
    );

    // Validate the exact optimistic transition before it enters the durable queue.
    const current = room.world();
    let valid = false;
    if (type === 'INIT' && !current) {
      try {
        replay([entry]);
        valid = true;
      } catch {
        valid = false;
      }
    } else if (current) {
      valid = previewEntry(current, entry) !== null;
    }
    if (!valid) {
      console.warn('acción local inválida:', type, payload);
      return false;
    }

    try {
      room.addPending(entry);
    } catch (error) {
      console.error('no se pudo añadir el evento local:', error);
      return false;
    }
    const persisted = savePendingEntry(roomId, entry);
    void persisted.then(() => {
      persistedPendingHashes.add(entry.hash);
      // A false result only means the socket is not open; the signed entry stays
      // in IndexedDB and will be offered again after the next successful SYNC.
      if (online && synced && !relayBehind) relay?.append(entry);
    }).catch((error) => {
      console.error('no se pudo persistir el evento pendiente:', error);
    });
    refresh();
    return true;
  };

  const ensureStarterCube = () => {
    if (world.entities['starter-cube']) return;
    // v1 rooms already have their original static cube; do not duplicate it.
    if (Object.values(world.cells).some((cell) => cell.kind === 'object')) return;
    const player = world.players[author];
    if (!player) return;

    const offsets: Array<[number, number]> = [
      [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
    ];
    const occupiedPlayers = new Set(
      Object.entries(world.players)
        .filter(([id]) => id !== author)
        .map(([, position]) => `${position.x},${position.y}`),
    );
    const target = offsets
      .map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
      .find(({ x, y }) =>
        world.cells[`${x},${y}`]?.kind === 'floor' &&
        !occupiedPlayers.has(`${x},${y}`) &&
        !Object.values(world.entities).some((entity) =>
          entity.location.kind === 'room' && entity.location.roomId === roomId &&
          entity.location.x === x && entity.location.y === y,
        ),
      );
    if (target) send('PLACE', { entityId: 'starter-cube', x: target.x, y: target.y });
  };

  const ensurePresence = () => {
    if (!room.hasInit()) send('INIT', { spawn: { x: 3, y: 3 }, owner: author });
    if (!world.players[author]) send('ENTER', { x: world.spawn.x, y: world.spawn.y });
    ensureStarterCube();
  };

  const flushPending = () => {
    if (!online || !synced || relayBehind || !relay) return;
    for (const entry of room.pendingEntries()) {
      if (blockedPendingHash === entry.hash || !persistedPendingHashes.has(entry.hash)) break;
      if (!relay.append(entry)) break;
    }
  };

  const handle = (result: ApplyResult) => {
    if (result.accepted.length) {
      void saveRoomItems(roomId, result.accepted);
      void deletePendingEntries(roomId, result.accepted.map((item) => item.entry));
      refresh();
      if (result.accepted.some((item) => item.entry.hash === blockedPendingHash)) {
        blockedPendingHash = null;
      }
    }
    if (result.error) console.error('entrada rechazada por el estado local:', result.error);
  };

  if (isPersonalRoom) {
    // No history is uploaded just because a network happens to be available.
    document.title = `TMS · local · ${roomId}`;
    ensurePresence();
  } else {
    relay = connectRelay(relayUrl(), roomId, () => room.lastRseq, {
      onStatus: (status) => {
        document.title = `TMS · ${status} · ${roomId}`;
        online = status === 'open';
        // Pending events remain in IndexedDB when the relay disconnects.
      },
      onSync: (items, head) => {
        synced = true;
        if (head < room.lastRseq) {
          relayBehind = true;
          // Keep the local copy intact. A relay reset is a conflict to resolve,
          // not permission to erase this device's event history.
          console.warn('el relay tiene menos historia que la copia local; se conserva el estado local');
          refresh();
          return;
        }
        relayBehind = false;
        const result = room.applyConfirmed(items);
        handle(result);
        if (result.error) return;
        if (result.gap || room.lastRseq < head) {
          relay?.hello();
          return;
        }
        refresh();
        ensurePresence();
        flushPending();
      },
      onEntry: (item) => {
        const result = room.applyConfirmed([item]);
        handle(result);
        if (result.gap) relay?.hello();
        else if (!result.error) flushPending();
      },
      onError: (code, hash) => {
        console.warn('relay error:', code, hash);
        if (hash) {
          const failed = room.pendingByHash(hash);
          if (failed) {
            // Preserve the failed event and its descendants for inspection/recovery.
            // Retrying them blindly would only repeat the same permanent rejection.
            blockedPendingHash = hash;
            console.warn('evento pendiente retenido localmente; no se descarta automáticamente:', failed.type, failed.seq);
          }
        }
        relay?.hello();
      },
    });
  }

  let lastMove = 0;
  const step = (dx: number, dy: number) => {
    const player = world.players[author];
    if (!player) return;
    const tries: Array<[number, number]> =
      dx !== 0 && dy !== 0 ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
    const move = tries.find(([x, y]) => canStep(world, player.x, player.y, x, y));
    if (!move) return;

    const now = performance.now();
    const cooldown = move[0] !== 0 && move[1] !== 0 ? 170 : 120;
    if (now - lastMove < cooldown) return;
    lastMove = now;
    send('MOVE', { x: player.x + move[0], y: player.y + move[1] });
  };

  const showEntityHistory = (targetId: string) => {
    if (targetId.startsWith('player:')) {
      const playerId = targetId.slice('player:'.length);
      const entries = getAuthorHistory(world, room.allEntries(), playerId);
      showHistoryPanel(`Jugador ${playerId.slice(0, 8)}…`, entries, [`${entries.length} eventos asociados`]);
      return;
    }
    const entries = getEntityHistory(world, room.allEntries(), targetId);
    const stats = getEntityStats(world, targetId);
    showHistoryPanel(`Objeto ${targetId}`, entries, [
      `${stats.eventCount} eventos`,
      `${stats.clickCount} interacciones`,
      `${stats.pickupCount} recogidas`,
      `${stats.dropCount} colocaciones`,
    ]);
  };

  interactionsModule.attachWorldInteractions(canvas, () => cameraRig.camera, syncer.entityMeshes, {
    onEntityClick: (targetId) => {
      send('INTERACT', { entityId: targetId, kind: 'click' });
      refresh();
      showEntityHistory(targetId);
    },
    onEntityPickup: (entityId) => send('PICK_UP', { entityId }),
    onEntityDrop: (entityId, x, y) => send('DROP', { entityId, x, y }),
    onInteractionLock: (locked) => cameraRig.setInputLocked(locked),
    onCellClick: (x, y) => {
      send('INTERACT', { kind: 'click', cell: { x, y } });
      refresh();
      const entries = getCellHistory(world, room.allEntries(), x, y);
      const stats = getCellStats(world, x, y);
      showHistoryPanel(`Celda ${x}, ${y}`, entries, [
        `${stats.playerVisits} visitas`,
        `${stats.uniqueVisitors} visitantes`,
        `${stats.objectPlacements} colocaciones`,
        `${stats.interactions} interacciones`,
      ]);
    },
    onDragPreview: (cell) => syncer.previewDrop(cell),
  });

  const controller = createController([createKeyboard(), createTouchPad(), createGamepad()]);
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const input = controller.read();
    if (input.dx !== 0 || input.dy !== 0) step(input.dx, input.dy);
    cameraRig.update();
    syncer.update(world, dt);
    renderer.render(scene, cameraRig.camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

boot().catch((error) => {
  console.error('boot failed:', error);
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#ff6b6b;padding:24px;font-family:monospace">boot failed:\n${message}</pre>`;
});
