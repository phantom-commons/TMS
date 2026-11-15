import { ROOM_W, ROOM_H, canStep, canWalk, createGenesisRoom, key, type World } from '../../sim/world';
import { createController } from '../../input/controller';
import { createKeyboard } from '../../input/keyboard';
import { createTouchPad } from '../../input/touchpad';
import { createGamepad } from '../../input/gamepad';
import { attachActionKeys, type ActionName } from '../../input/actions';
import { createScene } from '../../render/scene';
import { createSyncer } from '../../render/sync';
import { createAtriumStage } from '../../render/stage-atrium';
import { loadBackground } from '../../render/asset-store';
import { createCameraRig, CAM_LABEL, CAM_MODES, usesFacing } from '../../render/camera';
import { attachWorldInteractions } from '../../render/interactions';
import { attachSettings } from '../../ui/settings';
import { createSettingsStore, type Settings } from '../../ui/settings-store';
import { createRadial } from '../../ui/radial';
import { createHud, type HudChatMsg, type HudPrompt } from '../../ui/hud';
import { createInspector, type InspectorModel } from '../../ui/inspector';
import { createDevHud } from '../../ui/devhud';
import { createDoorDialog } from '../../ui/door';
import { createLabsPanel } from '../../ui/labs';
import { showToast } from '../../ui/toast';
import { showHistoryPanel } from '../../ui/history';
import { shortPubkey, type Identity } from '../../identity/keys';
import { clearRoom, loadPending, loadRoom, savePending, saveRoomItems } from '../../identity/room-storage';
import { HLClock } from '../../sim/hlc';
import { bytesToHex } from '../../sim/hash';
import { signEntry, verifyChain, verifyEntry, type LogEntry, type LogEntryType } from '../../sim/log';
import { RoomState, type ApplyResult } from '../../sim/room';
import { getCellStats, getCellHistory, getEntityHistory, getEntityStats } from '../../sim/history';
import { entitiesNear, isError, planDrop, planLock, planPickUp, planPush, planPushTo, screenToGrid } from '../../sim/actions';
import { presenceState } from '../../sim/presence';
import { generatePillars, homeRoomId, homeSeed, isHomeRoomId, roomSeed, starterCubes } from '../../sim/worldgen';
import { layoutFor, layoutSpawn, layoutWalls } from '../../sim/layouts';
import { createRelayClient, defaultRelayUrl, type RelayClient, type RelayStatus } from '../../net/relay-client';

const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-3)}`;

/** Motor 3D original de TMS, ahora como una experiencia más (la identidad llega ya resuelta). */
export async function bootWorld3D(identity: Identity) {
  const author = bytesToHex(identity.publicKey);
  console.log('identity:', identity.username, shortPubkey(identity.publicKey));

  const store = createSettingsStore();
  const home = homeRoomId(author);
  const requested = new URLSearchParams(location.search).get('room')?.trim() || null;
  const roomId = requested && /^[A-Za-z0-9:_-]{1,64}$/.test(requested) ? requested : home;
  const ownHome = roomId === home;

  const clock = new HLClock(() => Date.now());
  let room = new RoomState(roomId);

  // ───────────── estado local: caché confirmada + acciones propias pendientes ─────────────
  const loadLocal = async () => {
    const cached = room.applyConfirmed(await loadRoom(roomId));
    if (cached.error || cached.gap) {
      console.warn('caché local inconsistente, se descarta:', cached.error ?? 'hueco');
      await clearRoom(roomId);
      room = new RoomState(roomId);
    }
    for (const e of await loadPending(roomId)) {
      if (e.author !== author) break;
      const next = room.nextFor(author);
      if (e.seq < next.seq) continue;
      if (e.seq !== next.seq || e.prevHash !== next.prevHash || !verifyEntry(e)) break;
      room.addPending(e);
    }
    const mine = room.allEntries().filter((e) => e.author === author).pop();
    if (mine) clock.reset(mine.hlc);
  };
  await loadLocal();

  let world: World = room.world() ?? createGenesisRoom(roomId);
  const refresh = () => {
    world = room.world() ?? world;
  };

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const persistPending = (now = false) => {
    if (persistTimer) clearTimeout(persistTimer);
    const run = () => savePending(roomId, room.pendingList());
    if (now) return run();
    persistTimer = setTimeout(() => void run(), 250);
    return Promise.resolve();
  };

  // ───────────── render ─────────────
  const canvas = document.getElementById('app') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing canvas#app');
  const ctx = createScene(canvas, ROOM_W, ROOM_H);
  const rig = createCameraRig(ROOM_W, ROOM_H, store.get().camera);
  ctx.onResize(rig.resize);
  const syncer = createSyncer(ctx.scene, world, author);
  const stage = createAtriumStage(ctx.scene);
  void loadBackground('5244534E9CF5B606F2FF513AA00DDB161B0A4826FFD88A0D3BD03AC29247D198').then((tex) => {
    ctx.scene.background = tex;
  });

  // ───────────── red ─────────────
  let relay: RelayClient | null = null;
  let status: RelayStatus = 'closed';
  let ready = false;
  let online: ReadonlySet<string> = new Set();

  const send = (type: LogEntryType, payload: unknown) => {
    const entry = signEntry(
      { ...room.nextFor(author), type, roomId, payload, author, hlc: clock.tick() },
      identity.privateKey,
    );
    room.addPending(entry);
    refresh();
    void persistPending();
    if (ready) relay?.send(entry);
  };

  const flushPending = () => {
    const queue = [...room.pendingList()];
    const pump = () => {
      for (let i = 0; i < 10 && queue.length; i++) {
        const e = queue.shift();
        if (e) relay?.send(e);
      }
      if (queue.length) setTimeout(pump, 450);
    };
    pump();
  };

  const bootstrapRoom = () => {
    if (room.hasInit()) return;
    const spawn = { x: 3, y: 3 };
    const layout = layoutFor(roomId);
    if (ownHome) {
      const seed = homeSeed(author);
      send('INIT', { spawn, owner: author, seed, doorTo: 'lobby' });
      starterCubes(seed, spawn, generatePillars(seed, spawn)).forEach((c, i) =>
        send('PLACE', { entityId: `${roomId}:cube-${i + 1}`, x: c.x, y: c.y, blocksMovement: true }),
      );
    } else if (layout && (ready || !store.get().online)) {
      // Plantilla pública (p. ej. «atrium»): el INIT solo nombra la plantilla y las celdas salen de
      // layouts.ts, así que cualquiera puede recalcularlas. Si el relay ya la tiene, se espera a ready.
      const seed = roomSeed(roomId);
      const lspawn = layoutSpawn(layout);
      send('INIT', { spawn: lspawn, owner: author, seed, layout, doorTo: 'home' });
      starterCubes(seed, lspawn, layoutWalls(layout)).forEach((c, i) =>
        send('PLACE', { entityId: `${roomId}:cube-${i + 1}`, x: c.x, y: c.y, blocksMovement: true }),
      );
    } else if (ready && !isHomeRoomId(roomId)) {
      const seed = roomSeed(roomId);
      send('INIT', { spawn, owner: author, seed, doorTo: 'home' });
      starterCubes(seed, spawn, generatePillars(seed, spawn)).forEach((c, i) =>
        send('PLACE', { entityId: `${roomId}:cube-${i + 1}`, x: c.x, y: c.y, blocksMovement: true }),
      );
    } else if (ready) {
      showToast('esa habitación todavía no existe en el relay', 4000);
    }
  };

  const ensurePresence = () => {
    if (!room.hasInit()) return bootstrapRoom();
    if (!world.players[author] && (ready || ownHome)) send('ENTER', { x: world.spawn.x, y: world.spawn.y });
  };

  const handle = (res: ApplyResult) => {
    if (res.accepted.length) {
      void saveRoomItems(roomId, res.accepted);
      refresh();
      void persistPending();
    }
    if (res.error) {
      console.error('entrada rechazada:', res.error);
      showToast(`relay inconsistente: ${res.error}`, 5000);
    }
  };

  const startRelay = () => {
    if (relay) return;
    relay = createRelayClient({
      url: defaultRelayUrl(),
      roomId,
      author,
      privateKey: identity.privateKey,
      getSince: () => room.lastRseq,
      events: {
        onStatus: (s) => {
          status = s;
          if (s !== 'open') {
            ready = false;
            online = new Set();
          }
        },
        onSync: (items, head, reset) => {
          if (reset) {
            const mine = room.allEntries().filter((e) => e.author === author);
            room = new RoomState(roomId);
            for (const e of mine) room.addPending(e);
            void clearRoom(roomId).then(() => persistPending(true));
            showToast('el relay estaba vacío: resubiendo tu historial');
          }
          const res = room.applyConfirmed(items);
          handle(res);
          if (res.error) return;
          if (res.gap || room.lastRseq < head) {
            relay?.resync();
            return;
          }
          ready = true;
          refresh();
          flushPending();
          ensurePresence();
        },
        onEntry: (item) => {
          const res = room.applyConfirmed([item]);
          handle(res);
          if (res.gap) relay?.resync();
        },
        onError: (code, hash, message) => {
          console.warn('relay:', code, message);
          if (hash && !room.pendingList().some((p) => p.hash === hash)) return;
          if (code === 'RATE_LIMIT') {
            setTimeout(flushPending, 1000);
            return;
          }
          if (hash) {
            showToast(`rechazado: ${message}`);
            room.dropPending();
            refresh();
            void persistPending(true);
          }
          relay?.resync();
        },
        onPresence: (list) => {
          online = new Set(list);
        },
      },
    });
  };

  const stopRelay = () => {
    relay?.close();
    relay = null;
    ready = false;
    status = 'closed';
    online = new Set();
  };

  // ───────────── navegación entre salas (puerta azul: pisar o hacer clic) ─────────────
  let travelling = false;
  const navigateToRoom = (targetRaw: string) => {
    if (travelling) return;
    travelling = true;
    doorDialog.close();
    doorOpen = false;
    document.getElementById('labs-overlay')?.remove();
    document.getElementById('settings-overlay')?.remove();
    const target = targetRaw === 'home' ? home : targetRaw;
    const p = world.players[author];
    if (p && world.cells[key(p.x, p.y)]?.kind === 'door') {
      const safeX = Math.max(1, p.x - 1);
      if (canStep(world, p.x, p.y, safeX - p.x, 0)) {
        send('MOVE', { x: safeX, y: p.y });
      }
    }
    void persistPending(true).then(() => {
      const url = new URL(window.location.href);
      url.hash = '';
      // sin `room` la app abre el menú; la sala 3D propia se pide con ?exp=world
      if (target === home) {
        url.searchParams.delete('room');
        url.searchParams.set('exp', 'world');
      } else {
        url.searchParams.delete('exp');
        url.searchParams.set('room', target);
      }
      window.location.assign(url.toString());
    });
  };

  const doorDialog = createDoorDialog({ enter: (roomId) => navigateToRoom(roomId), onCancel: () => closeDoor() });
  let doorOpen = false;
  let doorJustClosedAt = 0;
  // tras entrar a una sala no se autoabre la puerta durante los primeros segundos
  const doorGraceUntil = performance.now() + 10000;
  const openDoor = (dest: string) => {
    if (doorOpen) return;
    doorOpen = true;
    doorDialog.open(dest);
  };
  const closeDoor = () => {
    doorJustClosedAt = performance.now();
    doorOpen = false;
    doorDialog.close();
    // Si cancelas (o cierras) mientras pisas la puerta, te sacas de la celda
    // para que el checkDoor no te atrape en un bucle de re-apertura.
    const p = world.players[author];
    if (p && world.cells[key(p.x, p.y)]?.kind === 'door') {
      const safeX = Math.max(1, p.x - 1);
      if (canStep(world, p.x, p.y, safeX - p.x, 0)) {
        send('MOVE', { x: safeX, y: p.y });
      }
    }
  };

  const labsPanel = createLabsPanel({
    place: (entry) => {
      const p = world.players[author];
      if (!p) {
        showToast('entra a una sala primero');
        return;
      }
      const taken = new Set(Object.values(world.players).map((pl) => key(pl.x, pl.y)));
      const size = Math.max(world.size.w, world.size.h);
      let cell: { x: number; y: number } | null = null;
      outerLab: for (let r = 0; r < size; r += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (world.cells[key(nx, ny)]?.kind === 'floor' && !taken.has(key(nx, ny)) && canWalk(world, nx, ny)) {
              cell = { x: nx, y: ny };
              break outerLab;
            }
          }
        }
      }
      if (!cell) {
        showToast('no hay celdas libres cerca');
        return;
      }
      send('PLACE', { entityId: `lab-${entry.hash.slice(0, 8)}`, x: cell.x, y: cell.y, blocksMovement: false, assetHash: entry.hash, assetSize: 0, mimeType: entry.mimeType });
      showToast(`labs: ${entry.path} colocado`);
    },
  });

  // ───────────── acciones ─────────────
  const facingVec = () => {
    const g = screenToGrid(0, -1, rig.yaw());
    return { dx: g.dx, dy: g.dy };
  };

  const doPickDrop = () => {
    const carrying = world.inventories[author]?.length ?? 0;
    if (carrying > 0) {
      const plan = planDrop(world, author, facingVec());
      if (isError(plan)) return showToast(plan.error);
      send('DROP', plan);
    } else {
      const plan = planPickUp(world, author);
      if (isError(plan)) return showToast(plan.error);
      send('PICK_UP', plan);
    }
  };

  const doLock = () => {
    const plan = planLock(world, author);
    if (isError(plan)) return showToast(plan.error);
    send(plan.type, { entityId: plan.entityId });
    showToast(plan.type === 'LOCK' ? 'bloqueado 🔒' : 'desbloqueado 🔓');
  };

  const doAttack = () => {
    const id = hoverId ?? (selected && 'entity' in selected ? selected.entity : null);
    if (!id) {
      showToast('sin objetivo: selecciona o pasa el ratón');
      return;
    }
    send('ATTACK', { entityId: id });
  };

  const cycleCamera = () => {
    const i = CAM_MODES.indexOf(store.get().camera);
    const next = CAM_MODES[(i + 1) % CAM_MODES.length];
    store.set({ camera: next });
    showToast(`cámara: ${CAM_LABEL[next]}`);
  };

  // ───────────── inspector, log, panel dev ─────────────
  let hoverId: string | null = null;
  let selected: { entity: string } | { cell: { x: number; y: number } } | null = null;

  const roomSummary = (): InspectorModel => {
    const all = room.allEntries();
    return {
      title: `sala ${roomId}`,
      summary: [`${all.length} eventos`, `${Object.keys(world.players).length} jugadores`],
      events: all.slice(-8),
    };
  };

  const targetModel = (): InspectorModel | null => {
    const all = room.allEntries();
    const entity = hoverId ?? (selected && 'entity' in selected ? selected.entity : null);
    if (entity) {
      if (entity.startsWith('door:')) {
        const dest = entity.slice('door:'.length);
        return {
          title: `puerta → ${dest === 'home' ? 'tu sala' : dest}`,
          summary: ['clic o camina encima para cruzar'],
          events: [],
        };
      }
      const st = getEntityStats(world, entity);
      return {
        title: entity.startsWith('player:') ? `jugador ${short(entity.slice(7))}` : `objeto ${entity}`,
        summary: [`${st.clickCount} clics`, `${st.movementCount} mov.`, `${st.uniqueActors.length} actores`],
        events: getEntityHistory(world, all, entity),
      };
    }
    if (selected && 'cell' in selected) {
      const { x, y } = selected.cell;
      const st = getCellStats(world, x, y);
      return {
        title: `celda ${x},${y}`,
        summary: [`${st.playerVisits} visitas`, `${st.uniqueVisitors} visitantes`, `${st.objectMoves} mov. de objetos`],
        events: getCellHistory(world, all, x, y),
      };
    }
    return null;
  };

  const fullLog = () => {
    const all = room.allEntries();
    showHistoryPanel(`Log de ${roomId}`, all, [`${all.length} eventos`, `${room.pendingCount} sin confirmar`]);
  };
  const inspector = createInspector(fullLog);
  const refreshInspector = () => {
    const mode = store.get().inspector;
    if (mode === 'off') return inspector.render(null);
    const model = targetModel();
    inspector.render(model ?? (mode === 'always' ? roomSummary() : null));
  };

  const verifyLog = () => {
    const all = room.allEntries();
    const authors = [...new Set(all.map((e) => e.author))];
    for (const a of authors) {
      const v = verifyChain(all.filter((e) => e.author === a), a);
      if (!v.ok) return showToast(`✗ cadena de ${short(a)}: ${v.reason}`, 6000);
    }
    showToast(`✓ ${all.length} entradas, ${authors.length} cadenas verificadas`, 3500);
  };

  const exportLog = () => {
    const blob = new Blob([JSON.stringify({ roomId, entries: room.entries(), pending: room.pendingList() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tms-${roomId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const devHud = createDevHud({ verify: verifyLog, exportLog, fullLog });

  // ───────────── radial + ajustes + hud ─────────────
  const radial = createRadial([
    { id: 'pickdrop', icon: '🎒', label: 'Recoger / soltar', run: doPickDrop },
    { id: 'attack', icon: '⚔️', label: 'Atacar', run: doAttack },
    { id: 'labs', icon: '🧪', label: 'Labs 3D', run: () => labsPanel.open() },
    { id: 'lock', icon: '🔒', label: 'Bloquear', run: doLock },
    { id: 'camera', icon: '🎥', label: 'Cámara', run: cycleCamera },
    { id: 'log', icon: '📜', label: 'Log de la sala', run: fullLog },
    { id: 'dev', icon: '🛠', label: 'Dev (F2)', run: () => store.set({ dev: !store.get().dev }) },
    { id: 'settings', icon: '⚙', label: 'Ajustes', run: () => settings.open() },
  ]);

  const settings = attachSettings({
    identity,
    store,
    homeRoomId: home,
    roomId,
    visitLink: () => `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`,
    goHome: () => navigateToRoom('home'),
  });

  // volver al menú de TMS (la app sin parámetros abre el shell)
  const backBtn = document.createElement('button');
  backBtn.className = 'hud-btn menu-back';
  backBtn.title = 'Volver al menú';
  backBtn.setAttribute('aria-label', 'Volver al menú');
  backBtn.textContent = '☰';
  backBtn.onclick = () => {
    void persistPending(true).then(() => window.location.assign(`${location.pathname}#/explore`));
  };
  document.body.append(backBtn);

  // ───────────── HUD (estado, minimapa, brújula, aviso, chat, atajos) ─────────────
  const hud = createHud({
    onSend: (text) => send('MESSAGE', { text }),
    onPickDrop: doPickDrop,
    onAttack: doAttack,
  });

  const applySettings = (s: Settings) => {
    rig.setMode(s.camera);
    syncer.setHideSelf(s.camera === 'fps');
    ctx.setShadows(s.shadows);
    ctx.setFog(s.fog && usesFacing(s.camera));
    radial.setVisible(s.radial);
    hud.applySettings(s);
    stage.setEnabled(s.stage === 'atrium');
    ctx.setLook(s.stage);
    devHud.setVisible(s.dev);
    if (s.online) startRelay();
    else stopRelay();
    refreshInspector();
  };
  store.subscribe((s) => applySettings(s));
  applySettings(store.get());

  attachActionKeys((a: ActionName) => {
    if (a === 'pickdrop') doPickDrop();
    else if (a === 'attack') doAttack();
    else if (a === 'lock') doLock();
    else if (a === 'camera') cycleCamera();
    else if (a === 'turnL' && usesFacing(rig.mode)) rig.turn(-1);
    else if (a === 'turnR' && usesFacing(rig.mode)) rig.turn(1);
    else if (a === 'dev') store.set({ dev: !store.get().dev });
    else if (a === 'radial') radial.toggle();
    else if (a === 'chat') hud.openChat();
    else if (a === 'escape') {
      hud.closeChat();
      document.getElementById('settings-overlay')?.remove();
      document.getElementById('labs-overlay')?.remove();
      closeDoor();
      selected = null;
      syncer.setSelected(null);
      refreshInspector();
    }
  });

  // ───────────── interacción con el ratón y toque ─────────────
  attachWorldInteractions(canvas, () => rig.camera(), syncer.entityMeshes, {
    onHover: (id) => {
      hoverId = id;
      syncer.setHover(id);
      refreshInspector();
    },
    onEntityClick: (id) => {
      if (id.startsWith('door:')) {
        const dest = id.slice('door:'.length);
        openDoor(dest);
        return;
      }
      selected = { entity: id };
      syncer.setSelected(id);
      if (world.players[author]) send('INTERACT', { kind: 'click', entityId: id });
      const st = getEntityStats(world, id);
      showToast(`${id.startsWith('player:') ? 'jugador' : 'objeto'} · ${st.clickCount} clics · ${st.movementCount} mov. · ${st.uniqueActors.length} actores`);
      refreshInspector();
    },
    onEntityPickup: (entityId: string) => {
      const entity = world.entities[entityId];
      if (!entity) return false;
      const plan = planPickUp(world, author);
      if (isError(plan)) {
        showToast(plan.error);
        return false;
      }
      send('PICK_UP', plan);
      return true;
    },
    onEntityDrop: (id, x, y) => {
      const entity = world.entities[id];
      if (!entity || entity.location.kind !== 'room') return;
      const sx = Math.sign(x - entity.location.x);
      const sy = Math.sign(y - entity.location.y);
      if (sx === 0 && sy === 0) return;
      const plan = planPushTo(world, author, id, entity.location.x + sx, entity.location.y + sy);
      if (isError(plan)) return showToast(plan.error);
      send('PUSH', plan);
    },
    onCellClick: (x, y) => {
      const clickedCell = world.cells[key(x, y)];
      if (clickedCell?.kind === 'door' && clickedCell.targetRoomId) {
        openDoor(clickedCell.targetRoomId);
        return;
      }
      selected = { cell: { x, y } };
      syncer.setSelected(null);
      refreshInspector();
    },
  });
  canvas.addEventListener('wheel', (e) => rig.zoomBy(e.deltaY < 0 ? 1.1 : 0.9), { passive: true });

  // ───────────── movimiento ─────────────
  let lastMove = 0;
  const step = (sx: number, sy: number) => {
    const p = world.players[author];
    if (!p) return;
    const g = screenToGrid(sx, sy, rig.yaw());
    if (g.dx === 0 && g.dy === 0) return;

    const occupied = (x: number, y: number) =>
      Object.entries(world.players).some(([id, pl]) => id !== author && pl.x === x && pl.y === y);
    const tries: Array<[number, number]> =
      g.dx !== 0 && g.dy !== 0 ? [[g.dx, g.dy], [g.dx, 0], [0, g.dy]] : [[g.dx, g.dy]];
    const move = tries.find(([a, b]) => canStep(world, p.x, p.y, a, b) && !occupied(p.x + a, p.y + b));

    const now = performance.now();
    const cooldown = g.dx !== 0 && g.dy !== 0 ? 170 : 120;
    if (now - lastMove < cooldown) return;

    if (move) {
      lastMove = now;
      send('MOVE', { x: p.x + move[0], y: p.y + move[1] });
      return;
    }
    const push = planPush(world, author, g.dx, g.dy);
    if (push) {
      lastMove = now;
      send('PUSH', push);
    }
  };

  const checkDoor = () => {
    // tras cerrar manualmente (Esc/Cancelar) damos un respiro para no reabrir
    // en bucle mientras el jugador sigue pisando la celda de la puerta.
    if (performance.now() - doorJustClosedAt < 800) return;
    // al entrar/cargar en una sala no autoabrimos la puerta (evita la barrera gris al cargar)
    if (performance.now() < doorGraceUntil) return;
    const p = world.players[author];
    if (!p || travelling) return;
    const cell = world.cells[key(p.x, p.y)];
    if (cell?.kind !== 'door' || !cell.targetRoomId) return;
    openDoor(cell.targetRoomId);
  };

  const controller = createController([createKeyboard(), createTouchPad(), createGamepad()]);

  // ───────────── aviso contextual del HUD ─────────────
  let hudLink: 'relay' | 'local' | 'connecting' = 'local';
  let hudLinkLabel = 'local';
  let hudBag: string | null = null;
  let hudPrompt: HudPrompt = null;
  const label = (id: string) => id.split(':').pop() ?? id;
  const computePrompt = (): HudPrompt => {
    const me = world.players[author];
    if (!me || doorOpen || travelling) return null;
    const bag = world.inventories[author] ?? [];
    if (bag.length) return { keys: ['F'], text: `soltar ${label(bag[0])}` };
    const near = entitiesNear(world, author)[0];
    if (near) {
      return near.lockedBy
        ? { keys: [], text: `${label(near.id)} · bloqueado${near.lockedBy === author ? ' por ti' : ''}` }
        : { keys: ['F'], text: `recoger ${label(near.id)}` };
    }
    for (const [k, c] of Object.entries(world.cells)) {
      if (c.kind !== 'door') continue;
      const [dx, dy] = k.split(',').map(Number);
      if (Math.max(Math.abs(dx - me.x), Math.abs(dy - me.y)) <= 1) {
        const dest = c.targetRoomId === 'home' ? 'tu sala' : (c.targetRoomId ?? 'lobby');
        return { keys: [], text: `puerta → ${dest} · pisa o haz clic` };
      }
    }
    return null;
  };

  // ───────────── bucle ─────────────
  let last = performance.now();
  let fps = 60;
  let hudTimer = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;

    const v = controller.read();
    if (v.dx !== 0 || v.dy !== 0) step(v.dx, v.dy);

    syncer.update(world, dt, { selfId: author, online, now: Date.now(), showGhosts: store.get().ghosts });
    rig.update(dt, syncer.selfPosition());
    stage.update(world, dt, { self: syncer.selfPosition(), events: room.entryCount, particles: store.get().fx });
    ctx.renderer.render(ctx.scene, rig.camera());
    checkDoor();
    hud.update({
      world,
      self: author,
      online,
      now: Date.now(),
      yaw: rig.yaw(),
      link: hudLink,
      linkLabel: hudLinkLabel,
      roomLabel: ownHome ? 'tu sala' : roomId.length > 22 ? `${roomId.slice(0, 21)}…` : roomId,
      pending: room.pendingCount,
      bag: hudBag,
      camLabel: CAM_LABEL[rig.mode],
      prompt: hudPrompt,
      focus: selected && 'cell' in selected ? selected.cell : null,
      showGhosts: store.get().ghosts,
    });

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      if (store.get().chat) {
        const msgs: HudChatMsg[] = [];
        for (const e of room.allEntries()) {
          if (e.type !== 'MESSAGE') continue;
          const text = (e.payload as { text?: unknown } | null)?.text;
          if (typeof text === 'string') msgs.push({ author: e.author, text, mine: e.author === author });
        }
        hud.setChat(msgs.slice(-30));
      }
      const connecting = store.get().online && !ready && status !== 'closed';
      hudLink = status === 'open' && ready ? 'relay' : connecting ? 'connecting' : 'local';
      hudLinkLabel = hudLink === 'relay' ? 'relay' : hudLink === 'connecting' ? 'conectando…' : store.get().online ? 'local (sin relay)' : 'local';
      const bag = world.inventories[author] ?? [];
      hudBag = bag.length ? (bag[0].split(':').pop() ?? bag[0]) : null;
      hudPrompt = computePrompt();
      radial.setBadge('pickdrop', bag.length ? '1' : '');
      if (store.get().dev) {
        const all = room.allEntries();
        devHud.update({
          relay: relay?.url ?? 'apagado',
          room: roomId + (ownHome ? ' (mi home)' : ''),
          mode: `${status}${ready ? ' · sync' : ''}`,
          rseq: room.lastRseq,
          pending: room.pendingCount,
          entries: all.length,
          online: online.size,
          players: Object.entries(world.players).map(([id, pl]) => {
            const st = presenceState(id, author, online, pl.hlc.t, Date.now());
            return `${short(id)} ${st} @${pl.x},${pl.y}${id === author ? ' (yo)' : ''}`;
          }),
          entities: Object.keys(world.entities).length,
          me: `${short(author)} ${world.players[author] ? `@${world.players[author].x},${world.players[author].y}` : 'fuera'}`,
          fps: Math.round(fps),
          tail: all.slice(-10).map((e: LogEntry) => `${e.type.padEnd(8)} ${short(e.author)} ${JSON.stringify(e.payload).slice(0, 48)}`),
        });
      }
      if (store.get().inspector === 'always') refreshInspector();
    }
    requestAnimationFrame(tick);
  };

  ensurePresence();
  requestAnimationFrame(tick);
}
