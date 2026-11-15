import * as THREE from 'three';
import { key, type World } from '../sim/world';
import { mulberry32, paletteHue, seedToInt } from '../sim/worldgen';

// "Stage": escenografía Three.js de una sala. Es solo presentación — lee el World y nunca lo modifica,
// no firma nada y no toca el log. El suelo con huellas, los avatares y los objetos siguen en sync.ts;
// aquí vive lo que da carácter al espacio: sigilo grabado con la semilla, anillo de eslabones de la
// cadena, columnas con linternas, cornisa, arco de la puerta y polvo en suspensión.

export type StageFrame = {
  /** posición suavizada del avatar propio (para la linterna que le sigue) */
  self: THREE.Vector3 | null;
  /** cuántos eventos firmados lleva la sala: cada uno enciende un eslabón del anillo */
  events: number;
  particles: boolean;
};

export type Stage = {
  setEnabled: (on: boolean) => void;
  update: (world: World, dt: number, frame: StageFrame) => void;
  dispose: () => void;
};

const RING_BEADS = 64;
const RING_RADIUS = 3.0;
const DUST_COUNT = 220;
const MAX_PILLAR_LIGHTS = 4;
const WALL_H = 1; // igual que sync.ts

const fnv = (s: string, salt: number): number => {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
};

/** Semilla hex de 64 si la sala no la trae (salas antiguas): estable por roomId. */
function seedOf(w: World): string {
  if (w.seed) return w.seed;
  let out = '';
  for (let i = 0; i < 8; i++) out += fnv(w.roomId, i).toString(16).padStart(8, '0');
  return out;
}

function makeSigil(seedHex: string, hue: number): THREE.CanvasTexture {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);
  g.translate(S / 2, S / 2);
  g.lineCap = 'round';
  g.shadowColor = `hsl(${hue} 90% 60%)`;
  g.shadowBlur = 14;
  g.strokeStyle = `hsl(${hue} 75% 70%)`;

  const ring = (r: number, w: number, a = 1) => {
    g.globalAlpha = a;
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  };
  ring(486, 5);
  ring(446, 2, 0.7);
  ring(330, 3, 0.8);
  ring(150, 4);

  // 64 marcas = los 64 hex de la semilla de la sala; la longitud es el valor del dígito.
  g.globalAlpha = 0.9;
  g.lineWidth = 5;
  for (let i = 0; i < 64; i++) {
    const v = parseInt(seedHex[i] ?? '0', 16) || 0;
    const a = (i / 64) * Math.PI * 2 - Math.PI / 2;
    const r0 = 440;
    const r1 = r0 - (14 + v * 4.2);
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.stroke();
  }

  // dodecágono + estrella {12/5}
  g.globalAlpha = 0.55;
  g.lineWidth = 2.5;
  const pt = (i: number, r: number) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  };
  g.beginPath();
  for (let i = 0; i <= 12; i++) {
    const [x, y] = pt(i, 300);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.globalAlpha = 0.35;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const [x0, y0] = pt(i, 300);
    const [x1, y1] = pt((i + 5) % 12, 300);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  }
  g.stroke();

  // cruz del centro
  g.globalAlpha = 0.8;
  g.lineWidth = 3;
  for (const a of [0, Math.PI / 2]) {
    g.beginPath();
    g.moveTo(Math.cos(a) * 110, Math.sin(a) * 110);
    g.lineTo(-Math.cos(a) * 110, -Math.sin(a) * 110);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

type Block = { x: number; y: number; len: number };

/** Une columnas contiguas en horizontal (p. ej. un altar de 2 celdas) en un solo bloque. */
function interiorBlocks(w: World): Block[] {
  const blocks: Block[] = [];
  for (let y = 1; y < w.size.h - 1; y++) {
    let x = 1;
    while (x < w.size.w - 1) {
      if (w.cells[key(x, y)]?.kind !== 'wall') {
        x++;
        continue;
      }
      let len = 1;
      while (x + len < w.size.w - 1 && w.cells[key(x + len, y)]?.kind === 'wall') len++;
      blocks.push({ x, y, len });
      x += len;
    }
  }
  return blocks;
}

export function createAtriumStage(scene: THREE.Scene): Stage {
  const group = new THREE.Group();
  group.name = 'stage-atrium';
  scene.add(group);

  let enabled = true;
  let signature = '';
  let disposables: Array<{ dispose: () => void }> = [];
  let accent = new THREE.Color(0x9b7bff);

  // animables que se recrean en cada build
  let ring: THREE.InstancedMesh | null = null;
  let ringGroup: THREE.Group | null = null;
  let crystals: THREE.InstancedMesh | null = null;
  let crystalBase: Array<{ x: number; z: number; phase: number }> = [];
  let pillarLights: Array<{ light: THREE.PointLight; base: number; phase: number; pos: THREE.Vector3 }> = [];
  let doorLights: THREE.PointLight[] = [];
  let portals: THREE.Mesh[] = [];
  let dust: THREE.Points | null = null;
  let dustSeed: Float32Array = new Float32Array(0);
  let torch: THREE.PointLight | null = null;

  let lastEvents = -1;
  let pulse = 0;
  let time = 0;

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const dim = new THREE.Color();

  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  const clear = () => {
    group.clear();
    disposables.forEach((d) => d.dispose());
    disposables = [];
    ring = null;
    ringGroup = null;
    crystals = null;
    crystalBase = [];
    pillarLights = [];
    doorLights = [];
    portals = [];
    dust = null;
    torch = null;
  };

  const build = (w: World) => {
    clear();
    const seedHex = seedOf(w);
    const hue = w.seed ? paletteHue(w.seed) : 36;
    accent = new THREE.Color().setHSL(hue / 360, 0.7, 0.62);
    dim.setHSL(hue / 360, 0.3, 0.18);
    const stone = new THREE.Color().setHSL(hue / 360, 0.1, 0.3);
    const W = w.size.w;
    const H = w.size.h;
    const cx = W / 2;
    const cz = H / 2;

    // ───── sigilo grabado en el suelo ─────
    const sigilTex = track(makeSigil(seedHex, hue));
    const sigilMat = track(new THREE.MeshBasicMaterial({
      map: sigilTex,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    const sigilGeo = track(new THREE.PlaneGeometry(9.4, 9.4));
    const sigil = new THREE.Mesh(sigilGeo, sigilMat);
    sigil.rotation.x = -Math.PI / 2;
    sigil.position.set(cx, 0.028, cz);
    sigil.renderOrder = 1;
    group.add(sigil);

    // ───── anillo de la cadena: un eslabón por evento firmado (los últimos 64) ─────
    ringGroup = new THREE.Group();
    ringGroup.position.set(cx, 0.17, cz);
    const beadGeo = track(new THREE.OctahedronGeometry(0.09));
    const beadMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring = new THREE.InstancedMesh(beadGeo, beadMat, RING_BEADS);
    ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < RING_BEADS; i++) ring.setColorAt(i, dim);
    ringGroup.add(ring);
    group.add(ringGroup);
    lastEvents = -1;

    // ───── cornisa y franja luminosa del perímetro ─────
    const border: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border.push({ x, y });
      }
    }
    const corniceGeo = track(new THREE.BoxGeometry(1.1, 0.1, 1.1));
    const corniceMat = track(new THREE.MeshLambertMaterial({ color: stone }));
    const cornice = new THREE.InstancedMesh(corniceGeo, corniceMat, border.length);
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    border.forEach((b, i) => {
      tmpM.makeTranslation(b.x + 0.5, WALL_H + 0.05, b.y + 0.5);
      cornice.setMatrixAt(i, tmpM);
    });
    group.add(cornice);

    const doorCells = border.filter((b) => w.cells[key(b.x, b.y)]?.kind === 'door');
    const isDoor = (x: number, y: number) => doorCells.some((d) => d.x === x && d.y === y);
    const strips: Array<{ x: number; z: number; alongX: boolean }> = [];
    for (const b of border) {
      const corner = (b.x === 0 || b.x === W - 1) && (b.y === 0 || b.y === H - 1);
      if (corner || isDoor(b.x, b.y)) continue;
      if (b.y === 0) strips.push({ x: b.x + 0.5, z: 1.02, alongX: true });
      else if (b.y === H - 1) strips.push({ x: b.x + 0.5, z: H - 1.02, alongX: true });
      else if (b.x === 0) strips.push({ x: 1.02, z: b.y + 0.5, alongX: false });
      else strips.push({ x: W - 1.02, z: b.y + 0.5, alongX: false });
    }
    const stripGeo = track(new THREE.BoxGeometry(0.96, 0.05, 0.05));
    const stripMat = track(new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.75 }));
    const stripMesh = new THREE.InstancedMesh(stripGeo, stripMat, strips.length);
    strips.forEach((s, i) => {
      tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), s.alongX ? 0 : Math.PI / 2);
      tmpM.compose(tmpV.set(s.x, 0.8, s.z), tmpQ, tmpS.set(1, 1, 1));
      stripMesh.setMatrixAt(i, tmpM);
    });
    group.add(stripMesh);

    // ───── columnas / altar: plinto, capitel, cristal flotante y (algunas) luz ─────
    const blocks = interiorBlocks(w);
    const plinthGeo = track(new THREE.BoxGeometry(1, 1, 1));
    const plinthMat = track(new THREE.MeshLambertMaterial({ color: stone }));
    const plinths = new THREE.InstancedMesh(plinthGeo, plinthMat, Math.max(1, blocks.length * 2));
    plinths.count = blocks.length * 2;
    plinths.castShadow = true;
    plinths.receiveShadow = true;
    blocks.forEach((b, i) => {
      // zócalo
      tmpM.compose(tmpV.set(b.x + b.len / 2, 0.06, b.y + 0.5), tmpQ.identity(), tmpS.set(b.len + 0.14, 0.12, 1.14));
      plinths.setMatrixAt(i * 2, tmpM);
      // capitel
      tmpM.compose(tmpV.set(b.x + b.len / 2, WALL_H + 0.06, b.y + 0.5), tmpQ.identity(), tmpS.set(b.len + 0.14, 0.12, 1.14));
      plinths.setMatrixAt(i * 2 + 1, tmpM);
    });
    group.add(plinths);

    const crystalGeo = track(new THREE.OctahedronGeometry(0.15));
    const crystalMat = track(new THREE.MeshBasicMaterial({ color: accent }));
    crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, Math.max(1, blocks.length));
    crystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    crystals.count = blocks.length;
    crystalBase = blocks.map((b, i) => ({ x: b.x + b.len / 2, z: b.y + 0.5, phase: i * 1.7 }));
    group.add(crystals);

    // luces solo en unos pocos bloques (los largos —el altar— primero), elegidos con la semilla
    const rnd = mulberry32(seedToInt(seedHex) ^ 0xa5a5a5a5);
    const order = blocks
      .map((b) => ({ b, k: (b.len > 1 ? 0 : 1) + rnd() * 0.99 }))
      .sort((a, b) => a.k - b.k)
      .slice(0, MAX_PILLAR_LIGHTS);
    for (const { b } of order) {
      const light = new THREE.PointLight(accent, 6, 7, 2);
      const pos = new THREE.Vector3(b.x + b.len / 2, WALL_H + 0.55, b.y + 0.5);
      light.position.copy(pos);
      group.add(light);
      pillarLights.push({ light, base: 6, phase: rnd() * 6.28, pos });
    }

    // ───── arco de la puerta ─────
    const postMat = track(new THREE.MeshLambertMaterial({ color: stone }));
    const glowMat = track(new THREE.MeshBasicMaterial({
      color: 0x5ac4ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    const portalGeo = track(new THREE.PlaneGeometry(0.95, 1.25));
    for (const d of doorCells) {
      const inx = d.x === W - 1 ? -1 : d.x === 0 ? 1 : 0;
      const inz = d.y === H - 1 ? -1 : d.y === 0 ? 1 : 0;
      const ax = inz !== 0 ? 1 : 0; // el muro corre a lo largo de x
      const az = inx !== 0 ? 1 : 0; // …o de z
      const baseX = d.x + 0.5 + inx * 0.34;
      const baseZ = d.y + 0.5 + inz * 0.34;
      const postGeo = track(new THREE.BoxGeometry(ax ? 0.2 : 0.3, 1.5, az ? 0.2 : 0.3));
      const lintelGeo = track(new THREE.BoxGeometry(ax ? 1.5 : 0.3, 0.14, az ? 1.5 : 0.3));
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(baseX + ax * s * 0.6, 0.75, baseZ + az * s * 0.6);
        p.castShadow = true;
        group.add(p);
      }
      const lintel = new THREE.Mesh(lintelGeo, postMat);
      lintel.position.set(baseX, 1.57, baseZ);
      lintel.castShadow = true;
      group.add(lintel);

      const portal = new THREE.Mesh(portalGeo, glowMat);
      portal.position.set(d.x + 0.5 + inx * 0.5, 0.65, d.y + 0.5 + inz * 0.5);
      portal.rotation.y = Math.atan2(inx, inz);
      portal.renderOrder = 2;
      group.add(portal);
      portals.push(portal);

      const light = new THREE.PointLight(0x5ac4ff, 5, 5, 2);
      light.position.set(d.x + 0.5 + inx * 0.9, 0.8, d.y + 0.5 + inz * 0.9);
      group.add(light);
      doorLights.push(light);
    }

    // ───── linterna que sigue al avatar propio ─────
    torch = new THREE.PointLight(0xffd9a8, 2.2, 5, 2);
    torch.position.set(cx, 1.3, cz);
    group.add(torch);

    // ───── polvo en suspensión ─────
    dustSeed = new Float32Array(DUST_COUNT * 3);
    const pos = new Float32Array(DUST_COUNT * 3);
    const dr = mulberry32(seedToInt(seedHex) ^ 0x1234567);
    for (let i = 0; i < DUST_COUNT; i++) {
      dustSeed[i * 3] = dr() * (W - 2) + 1;
      dustSeed[i * 3 + 1] = dr();
      dustSeed[i * 3 + 2] = dr() * (H - 2) + 1;
    }
    const dustGeo = track(new THREE.BufferGeometry());
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dustMat = track(new THREE.PointsMaterial({
      color: tmpC.copy(accent).lerp(new THREE.Color(0xffffff), 0.55),
      size: 2.4 * dpr,
      sizeAttenuation: false, // en cámaras ortográficas el tamaño con atenuación se vuelve invisible
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    group.add(dust);

    signature = sigOf(w);
  };

  const sigOf = (w: World) => {
    const doors: string[] = [];
    for (const [k, c] of Object.entries(w.cells)) if (c.kind === 'door') doors.push(k);
    return `${w.roomId}|${w.layout ?? ''}|${w.seed ?? ''}|${w.size.w}x${w.size.h}|${doors.join(';')}`;
  };

  const update = (w: World, dt: number, frame: StageFrame) => {
    if (!enabled) return;
    time += dt;
    if (sigOf(w) !== signature) build(w);

    // anillo de la cadena
    if (ring && ringGroup) {
      if (lastEvents < 0) lastEvents = frame.events;
      else if (frame.events > lastEvents) {
        pulse = 1;
        lastEvents = frame.events;
      } else lastEvents = frame.events;
      pulse = Math.max(0, pulse - dt * 1.6);
      ringGroup.rotation.y += dt * 0.12;

      const active = Math.min(frame.events, RING_BEADS);
      const newest = frame.events > 0 ? (frame.events - 1) % RING_BEADS : -1;
      for (let k = 0; k < RING_BEADS; k++) {
        const a = (k / RING_BEADS) * Math.PI * 2;
        const on = frame.events >= RING_BEADS || k < active;
        const age = newest < 0 ? RING_BEADS : (newest - k + RING_BEADS) % RING_BEADS;
        const fresh = on ? 1 - age / RING_BEADS : 0;
        const s = on ? 0.7 + fresh * 0.5 + (k === newest ? pulse * 1.3 : 0) : 0.0001;
        tmpM.compose(
          tmpV.set(Math.cos(a) * RING_RADIUS, Math.sin(time * 1.5 + k) * 0.02, Math.sin(a) * RING_RADIUS),
          tmpQ.setFromAxisAngle(tmpS.set(0, 1, 0), time + k),
          tmpS.set(s, s, s),
        );
        ring.setMatrixAt(k, tmpM);
        ring.setColorAt(k, tmpC.copy(dim).lerp(accent, on ? 0.25 + fresh * 0.75 : 0));
      }
      ring.instanceMatrix.needsUpdate = true;
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    }

    // cristales flotando sobre las columnas
    if (crystals) {
      crystalBase.forEach((c, i) => {
        tmpM.compose(
          tmpV.set(c.x, WALL_H + 0.5 + Math.sin(time * 1.3 + c.phase) * 0.07, c.z),
          tmpQ.setFromAxisAngle(tmpS.set(0, 1, 0), time * 0.8 + c.phase),
          tmpS.set(1, 1.5, 1),
        );
        crystals?.setMatrixAt(i, tmpM);
      });
      crystals.instanceMatrix.needsUpdate = true;
    }

    // luces: parpadeo suave y más fuertes cuando te acercas
    for (const p of pillarLights) {
      const flick = 1 + Math.sin(time * 5.1 + p.phase) * 0.06 + Math.sin(time * 13.7 + p.phase * 2) * 0.03;
      const near = frame.self ? Math.max(0, 1 - frame.self.distanceTo(p.pos) / 5) : 0;
      p.light.intensity = p.base * flick * (1 + near * 0.6);
    }
    for (const m of portals) (m.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(time * 2.2) * 0.08;
    for (const l of doorLights) l.intensity = 5 + Math.sin(time * 2.2) * 1.2;
    if (torch) {
      torch.visible = frame.self !== null;
      if (frame.self) torch.position.set(frame.self.x, 1.3, frame.self.z);
    }

    // polvo
    if (dust) {
      dust.visible = frame.particles;
      if (frame.particles) {
        const attr = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < DUST_COUNT; i++) {
          const bx = dustSeed[i * 3];
          const by = dustSeed[i * 3 + 1];
          const bz = dustSeed[i * 3 + 2];
          const rise = (by + time * (0.02 + by * 0.03)) % 1;
          attr.setXYZ(
            i,
            bx + Math.sin(time * 0.3 + i) * 0.35,
            0.15 + rise * 2.6,
            bz + Math.cos(time * 0.27 + i * 1.3) * 0.35,
          );
        }
        attr.needsUpdate = true;
      }
    }
  };

  return {
    setEnabled(on) {
      enabled = on;
      group.visible = on;
    },
    update,
    dispose() {
      clear();
      scene.remove(group);
    },
  };
}
