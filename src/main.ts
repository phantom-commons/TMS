import './style.css';
import { canWalk, ROOM_W, ROOM_H } from './sim/world';
import { createScene } from './render/scene';
import { createSyncer } from './render/sync';
import { attachKeyboard, type Dir } from './input/keyboard';
import { ensureIdentity } from './ui/login';
import { attachExportButton } from './ui/export';
import { shortPubkey } from './identity/keys';
import { HLClock } from './sim/hlc';
import { GENESIS_HASH, bytesToHex } from './sim/hash';
import { signEntry, verifyChain, type LogEntry, type UnsealedEntry } from './sim/log';
import { replay, applyEntry } from './sim/replay';
import { loadLog, saveLog } from './identity/log-storage';

async function boot() {
  const identity = await ensureIdentity();
  const author = bytesToHex(identity.publicKey);
  console.log('identity:', identity.username, shortPubkey(identity.publicKey), '| author:', author.slice(0, 12));
  attachExportButton(identity);

  const clock = new HLClock(() => Date.now());
  let entries: LogEntry[] = await loadLog();

  if (entries.length === 0) {
    const init: UnsealedEntry = {
      seq: 0,
      type: 'INIT',
      payload: { roomId: 'room-genesis', spawn: { x: 3, y: 3 }, owner: author },
      author,
      hlc: clock.tick(),
      prevHash: GENESIS_HASH,
    };
    entries = [signEntry(init, identity.privateKey)];
    await saveLog(entries);
    console.log('created INIT entry');
  } else {
    const v = verifyChain(entries, author);
    if (!v.ok) {
      console.error('log verification failed:', v.reason);
      alert('Log corrupto: ' + v.reason);
      return;
    }
    clock.reset(entries[entries.length - 1].hlc);
    console.log('log verified:', entries.length, 'entries, head:', entries[entries.length - 1].hash.slice(0, 12));
  }

  const world = replay(entries);
  console.log('world replayed. player:', world.players.local);

  const canvas = document.getElementById('app') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing canvas#app');

  const { scene, camera, renderer } = createScene(canvas, ROOM_W, ROOM_H);
  const syncer = createSyncer(scene, world);

  const COOLDOWN_MS = 120;
  let lastMove = 0;

  const step = (d: Dir) => {
    const now = performance.now();
    if (now - lastMove < COOLDOWN_MS) return;
    lastMove = now;

    const p = world.players.local ?? { x: 3, y: 3, hlc: { t: 0, c: 0 } };
    let nx = p.x;
    let ny = p.y;
    if (d === 'up') ny -= 1;
    else if (d === 'down') ny += 1;
    else if (d === 'left') nx -= 1;
    else if (d === 'right') nx += 1;

    if (!canWalk(world, nx, ny)) return;

    const prev = entries[entries.length - 1];
    const unsealed: UnsealedEntry = {
      seq: prev.seq + 1,
      type: 'MOVE',
      payload: { x: nx, y: ny },
      author,
      hlc: clock.tick(),
      prevHash: prev.hash,
    };
    const entry = signEntry(unsealed, identity.privateKey);
    entries.push(entry);
    applyEntry(world, entry);
    void saveLog(entries);
  };

  attachKeyboard(step);

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    syncer.update(world, dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error('boot failed:', e);
  document.body.innerHTML = `<pre style="color:#ff6b6b;padding:24px;font-family:monospace">boot failed:\n${e}</pre>`;
});