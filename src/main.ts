import './style.css';
import { canStep, ROOM_W, ROOM_H } from './sim/world';   // canWalk ya no se usa
import { createController } from './input/controller';
import { createKeyboard } from './input/keyboard';
import { createTouchPad } from './input/touchpad';
import { createGamepad } from './input/gamepad';
import { createScene } from './render/scene';
import { createSyncer } from './render/sync';
import { ensureIdentity } from './ui/login';
import { attachExportButton } from './ui/export';
import { shortPubkey } from './identity/keys';
import { HLClock } from './sim/hlc';
import { GENESIS_HASH, bytesToHex } from './sim/hash';
import { signEntry, verifyChain, type LogEntry, type UnsealedEntry } from './sim/log';
import { replay, applyEntry } from './sim/replay';
import { loadLog, appendEntry } from './identity/log-storage';

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
    await appendEntry(entries[0]);
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
  console.log('world replayed. player:', world.players[author]);

  const canvas = document.getElementById('app') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing canvas#app');

  const { scene, camera, renderer } = createScene(canvas, ROOM_W, ROOM_H);
  const syncer = createSyncer(scene, world, author);


   let lastMove = 0;

  const step = (dx: number, dy: number) => {
    const p = world.players[author];
    if (!p) return;

    // En diagonal, si hay esquina, intenta deslizarte por cada eje.
    const tries: Array<[number, number]> =
      dx !== 0 && dy !== 0 ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
    const m = tries.find(([a, b]) => canStep(world, p.x, p.y, a, b));
    if (!m) return;

    const now = performance.now();
    const cooldown = m[0] !== 0 && m[1] !== 0 ? 170 : 120; // diagonal ≈ ×1.41
    if (now - lastMove < cooldown) return;
    lastMove = now;

    const prev = entries[entries.length - 1];
    const unsealed: UnsealedEntry = {
      seq: prev.seq + 1,
      type: 'MOVE',
      payload: { x: p.x + m[0], y: p.y + m[1] },
      author,
      hlc: clock.tick(),
      prevHash: prev.hash,
    };
    const entry = signEntry(unsealed, identity.privateKey);
    entries.push(entry);
    applyEntry(world, entry);
    void appendEntry(entry);
  };

  const controller = createController([createKeyboard(), createTouchPad(), createGamepad()]);

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const v = controller.read();
    if (v.dx !== 0 || v.dy !== 0) step(v.dx, v.dy);
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