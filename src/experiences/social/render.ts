import { ITEMS, ROOM_SIZE, WALL_H, cellsOf, dims, orientedParts, type PlacedItem, type RoomLayout, type Wall } from './model';

// Render isométrico 2D de Tu Room sobre un <canvas>. Solo dibuja y mide: no decide nada ni guarda estado.
// Proyección 2:1 clásica. Eje x hacia abajo-derecha, eje y hacia abajo-izquierda, z hacia arriba.

export const TW = 64;
export const TH = 32;
export const Z = 32;

/** Vistas de Tu Room: la misma habitación y la misma lógica, con otra base de proyección. */
export type RoomView = 'iso' | 'top';
export type View = { scale: number; ox: number; oy: number; kind?: RoomView };
export type Pt = { x: number; y: number };

// Cada vista es una base lineal: lo que mide un paso en x, en y y en z (altura) sobre la pantalla.
// iso: proyección 2:1 clásica. top: cenital oblicua (arriba de la pantalla = fondo; la altura se asoma un poco hacia arriba-izquierda).
type Basis = { ax: Pt; ay: Pt; az: Pt };
const BASES: Record<RoomView, Basis> = {
  iso: { ax: { x: TW / 2, y: TH / 2 }, ay: { x: -TW / 2, y: TH / 2 }, az: { x: 0, y: -Z } },
  top: { ax: { x: 40, y: 0 }, ay: { x: 0, y: 40 }, az: { x: -10, y: -22 } },
};
const basisOf = (kind: RoomView | undefined): Basis => BASES[kind ?? 'iso'];

export const project = (x: number, y: number, z: number, kind?: RoomView): Pt => {
  const b = basisOf(kind);
  return { x: x * b.ax.x + y * b.ay.x + z * b.az.x, y: x * b.ax.y + y * b.ay.y + z * b.az.y };
};

export const toScreen = (v: View, x: number, y: number, z: number): Pt => {
  const p = project(x, y, z, v.kind);
  return { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale };
};

/** pantalla → coordenadas de suelo (z = 0), fraccionarias */
export function unprojectFloor(v: View, px: number, py: number): Pt {
  const { ax, ay } = basisOf(v.kind);
  const sx = (px - v.ox) / v.scale;
  const sy = (py - v.oy) / v.scale;
  const det = ax.x * ay.y - ay.x * ax.y;
  return { x: (sx * ay.y - ay.x * sy) / det, y: (ax.x * sy - ax.y * sx) / det };
}

const PAD = 28;
export function fitView(w: number, h: number, zoom = 1, panX = 0, panY = 0, kind: RoomView = 'iso'): View {
  // encuadra la caja de la habitación (suelo + paredes) en esta proyección
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const x of [0, ROOM_SIZE]) {
    for (const y of [0, ROOM_SIZE]) {
      for (const z of [0, WALL_H]) {
        const p = project(x, y, z, kind);
        xmin = Math.min(xmin, p.x);
        xmax = Math.max(xmax, p.x);
        ymin = Math.min(ymin, p.y);
        ymax = Math.max(ymax, p.y);
      }
    }
  }
  const base = Math.min(w / (xmax - xmin + PAD), h / (ymax - ymin + PAD));
  const scale = base * zoom;
  return { scale, ox: w / 2 - ((xmin + xmax) / 2) * scale + panX, oy: h / 2 - ((ymin + ymax) / 2) * scale + panY, kind };
}

/** orden de dibujo: mayor = más cerca de la cámara */
const depthAt = (kind: RoomView | undefined, x: number, y: number) => (kind === 'top' ? y * 2 + x * 0.2 : x + y);

// ───────────────── color ─────────────────

const clamp8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function shade(hex: string, k: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${clamp8(r * k)},${clamp8(g * k)},${clamp8(b * k)})`;
}
function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Tono de la habitación: sale de tu clave pública, como la sala 3D. */
export function ownerHue(owner: string): number {
  return (parseInt(owner.slice(0, 2), 16) / 255) * 360 || 260;
}

// ───────────────── primitivas ─────────────────

type G = CanvasRenderingContext2D;

function poly(g: G, v: View, pts: Array<[number, number, number]>, fill?: string | CanvasGradient, stroke?: string, lw = 1) {
  g.beginPath();
  pts.forEach(([x, y, z], i) => {
    const p = toScreen(v, x, y, z);
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  });
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }
}

function box(g: G, v: View, x: number, y: number, z: number, w: number, d: number, h: number, color: string) {
  poly(g, v, [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], shade(color, 0.82)); // cara izquierda (+y)
  poly(g, v, [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], shade(color, 0.62)); // cara derecha (+x)
  poly(g, v, [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], shade(color, 1.08)); // arriba
}

export const wallPt = (wall: Wall, u: number, z: number): [number, number, number] => (wall === 'left' ? [0, u, z] : [u, 0, z]);

function wallQuad(wall: Wall, u0: number, u1: number, z0: number, z1: number): Array<[number, number, number]> {
  return [wallPt(wall, u0, z0), wallPt(wall, u1, z0), wallPt(wall, u1, z1), wallPt(wall, u0, z1)];
}

// ───────────────── hit-testing ─────────────────

function inPoly(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const heightOf = (it: PlacedItem) => orientedParts(it.kind, it.rot).reduce((m, p) => Math.max(m, p.dz + p.h), 0.05);

/** Silueta en pantalla (para elegir objetos con el dedo). */
export function silhouette(v: View, it: PlacedItem): Pt[] {
  const def = ITEMS[it.kind];
  if (def.mount === 'wall') {
    const wall = it.wall ?? 'left';
    return wallQuad(wall, it.x, it.x + def.w, def.z0 ?? 0.8, def.z1 ?? 2).map(([x, y, z]) => toScreen(v, x, y, z));
  }
  const { w, d } = dims(it);
  const h = heightOf(it);
  const { x, y } = it;
  const c: Array<[number, number, number]> =
    h <= 0.1
      ? [[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]]
      : [[x, y, h], [x + w, y, h], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0], [x, y + d, h]];
  return c.map(([a, b, z]) => toScreen(v, a, b, z));
}

const depthKey = (it: PlacedItem, kind?: RoomView) => {
  const { w, d } = dims(it);
  return depthAt(kind, it.x + w, it.y + d);
};

/** Objeto más cercano a la cámara bajo el puntero. Las alfombras solo cuentan si no hay nada encima. */
export function pickItem(layout: RoomLayout, v: View, px: number, py: number): PlacedItem | null {
  const p = { x: px, y: py };
  const sorted = [...layout.items].sort((a, b) => {
    const rug = (i: PlacedItem) => (ITEMS[i.kind].mount === 'floor' && !ITEMS[i.kind].blocks ? 0 : 1);
    return rug(b) - rug(a) || depthKey(b, v.kind) - depthKey(a, v.kind);
  });
  for (const it of sorted) if (inPoly(p, silhouette(v, it))) return it;
  return null;
}

/** Hueco de pared bajo el puntero */
export function pickWallSlot(v: View, px: number, py: number): { wall: Wall; u: number } | null {
  const p = { x: px, y: py };
  for (const wall of ['left', 'right'] as const) {
    for (let u = 0; u < ROOM_SIZE; u++) {
      if (inPoly(p, wallQuad(wall, u, u + 1, 0, WALL_H).map(([x, y, z]) => toScreen(v, x, y, z)))) return { wall, u };
    }
  }
  return null;
}

// ───────────────── dibujo ─────────────────

export type DrawOpts = {
  hue: number;
  selectedId?: string | null;
  ghost?: { item: PlacedItem; valid: boolean } | null;
  hover?: Pt | null;
  showLocks?: boolean;
  /** casillas de destino marcadas (camino del avatar) */
  trail?: Pt[];
  avatar?: { x: number; y: number; moving: boolean; t: number } | null;
  /** el objeto que se arrastra se dibuja en el ghost, no en su sitio */
  hideId?: string | null;
  /** resalta los huecos de pared (al arrastrar un objeto de pared) */
  wallSlots?: boolean;
};

export function drawRoom(g: G, w: number, h: number, v: View, layout: RoomLayout, o: DrawOpts): void {
  g.clearRect(0, 0, w, h);
  const N = ROOM_SIZE;
  const floorA = hsl(o.hue, 20, 34);
  const floorB = hsl(o.hue, 20, 30);
  const wallL = hsl(o.hue, 26, 46);
  const wallR = hsl(o.hue, 26, 38);

  // paredes
  poly(g, v, wallQuad('left', 0, N, 0, WALL_H), wallL);
  poly(g, v, wallQuad('right', 0, N, 0, WALL_H), wallR);
  poly(g, v, wallQuad('left', 0, N, 0, 0.22), shade(wallL, 0.78));
  poly(g, v, wallQuad('right', 0, N, 0, 0.22), shade(wallR, 0.78));
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let u = 1; u < N; u++) {
    for (const wall of ['left', 'right'] as const) {
      const a = wallPt(wall, u, 0.22);
      const b = wallPt(wall, u, WALL_H);
      const pa = toScreen(v, ...a);
      const pb = toScreen(v, ...b);
      g.beginPath();
      g.moveTo(pa.x, pa.y);
      g.lineTo(pb.x, pb.y);
      g.stroke();
    }
  }
  poly(g, v, [[0, 0, 0], [0, 0, WALL_H]], undefined, 'rgba(255,255,255,0.18)', 2);

  // suelo
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) poly(g, v, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], (x + y) % 2 ? floorA : floorB);
  }
  poly(g, v, [[0, 0, 0], [N, 0, 0], [N, N, 0], [0, N, 0]], undefined, 'rgba(255,255,255,0.10)', 1.5);

  if (o.wallSlots) {
    for (const wall of ['left', 'right'] as const) {
      for (let u = 0; u < N; u++) poly(g, v, wallQuad(wall, u + 0.04, u + 0.96, 0.3, WALL_H - 0.15), 'rgba(155,123,255,0.10)', 'rgba(155,123,255,0.35)');
    }
  }

  // objetos de pared
  const drawWallItem = (it: PlacedItem, alpha = 1) => {
    const def = ITEMS[it.kind];
    const wall = it.wall ?? 'left';
    const u0 = it.x;
    const u1 = it.x + def.w;
    const z0 = def.z0 ?? 0.8;
    const z1 = def.z1 ?? 2;
    g.globalAlpha = alpha;
    poly(g, v, wallQuad(wall, u0, u1, z0, z1), def.style === 'window' ? '#e9edf5' : '#fff4f0');
    const m = 0.09;
    const inner = wallQuad(wall, u0 + m, u1 - m, z0 + m, z1 - m);
    if (def.style === 'window') {
      const a = toScreen(v, ...inner[0]);
      const b = toScreen(v, ...inner[3]);
      const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, '#9fd6ff');
      grad.addColorStop(1, '#e9f6ff');
      poly(g, v, inner, grad);
      const mid = (u0 + u1) / 2;
      poly(g, v, [wallPt(wall, mid, z0 + m), wallPt(wall, mid, z1 - m)], undefined, '#e9edf5', 3 * v.scale);
      poly(g, v, [wallPt(wall, u0 + m, (z0 + z1) / 2), wallPt(wall, u1 - m, (z0 + z1) / 2)], undefined, '#e9edf5', 3 * v.scale);
    } else {
      poly(g, v, inner, '#ff8fa3');
      poly(g, v, wallQuad(wall, u0 + 0.2, u1 - 0.2, z0 + 0.15, z0 + 0.45), '#ffd9a0');
      poly(g, v, wallQuad(wall, u0 + 0.28, u1 - 0.28, z1 - 0.38, z1 - 0.2), '#fff1f3');
    }
    g.globalAlpha = 1;
  };
  for (const it of layout.items) if (ITEMS[it.kind].mount === 'wall' && it.id !== o.hideId) drawWallItem(it);

  // alfombras (planas)
  const drawParts = (it: PlacedItem, alpha = 1) => {
    g.globalAlpha = alpha;
    for (const p of orientedParts(it.kind, it.rot)) box(g, v, it.x + p.dx, it.y + p.dy, p.dz, p.w, p.d, p.h, p.color);
    g.globalAlpha = 1;
  };
  for (const it of layout.items) if (ITEMS[it.kind].mount === 'floor' && !ITEMS[it.kind].blocks && it.id !== o.hideId) drawParts(it);

  // marcas de suelo: camino, casilla bajo el puntero, selección
  for (const t of o.trail ?? []) poly(g, v, [[t.x + 0.3, t.y + 0.3, 0], [t.x + 0.7, t.y + 0.3, 0], [t.x + 0.7, t.y + 0.7, 0], [t.x + 0.3, t.y + 0.7, 0]], 'rgba(255,255,255,0.18)');
  if (o.hover && o.hover.x >= 0 && o.hover.y >= 0 && o.hover.x < N && o.hover.y < N) {
    const { x, y } = o.hover;
    poly(g, v, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], 'rgba(155,123,255,0.22)', 'rgba(217,204,255,0.6)', 1.5);
  }
  const sel = o.selectedId ? layout.items.find((i) => i.id === o.selectedId) : null;
  if (sel && sel.id !== o.hideId && ITEMS[sel.kind].mount === 'floor') {
    for (const [x, y] of cellsOf(sel)) poly(g, v, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], 'rgba(155,123,255,0.28)', 'rgba(217,204,255,0.9)', 1.5);
  }
  if (o.ghost && ITEMS[o.ghost.item.kind].mount === 'floor') {
    const col = o.ghost.valid ? 'rgba(80,220,140,0.35)' : 'rgba(255,90,110,0.38)';
    for (const [x, y] of cellsOf(o.ghost.item)) poly(g, v, [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], col);
  }

  // objetos del suelo y avatar, de atrás hacia delante
  type Drawable = { key: number; draw: () => void };
  const list: Drawable[] = [];
  for (const it of layout.items) {
    const def = ITEMS[it.kind];
    if (def.mount !== 'floor' || !def.blocks || it.id === o.hideId) continue;
    list.push({ key: depthKey(it, v.kind) - 0.01, draw: () => drawParts(it) });
  }
  if (o.ghost) {
    const it = o.ghost.item;
    if (ITEMS[it.kind].mount === 'floor') list.push({ key: depthKey(it, v.kind) + 100, draw: () => drawParts(it, o.ghost?.valid ? 0.78 : 0.5) });
  }
  if (o.avatar) {
    const a = o.avatar;
    list.push({
      key: depthAt(v.kind, a.x, a.y) + 1.2,
      draw: () => {
        const bob = a.moving ? Math.abs(Math.sin(a.t * 10)) * 0.07 : 0;
        const s = toScreen(v, a.x + 0.5, a.y + 0.5, 0);
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath();
        const shadowW = v.kind === 'top' ? 15 : 14;
        const shadowH = v.kind === 'top' ? 9 : 7;
        g.ellipse(s.x, s.y, shadowW * v.scale, shadowH * v.scale, 0, 0, Math.PI * 2);
        g.fill();
        const cx = a.x + 0.5 - 0.17;
        const cy = a.y + 0.5 - 0.17;
        box(g, v, cx, cy, bob, 0.34, 0.34, 0.5, shade(hsl(o.hue, 55, 58), 1));
        box(g, v, cx + 0.03, cy + 0.03, 0.5 + bob, 0.28, 0.28, 0.28, '#f2c9a0');
        const eye = toScreen(v, cx + 0.31, cy + 0.34, 0.66 + bob);
        g.fillStyle = '#2b3040';
        g.fillRect(eye.x - 1.5 * v.scale, eye.y - 1.5 * v.scale, 3 * v.scale, 3 * v.scale);
      },
    });
  }
  list.sort((p, q) => p.key - q.key).forEach((d) => d.draw());

  if (o.ghost && ITEMS[o.ghost.item.kind].mount === 'wall') drawWallItem(o.ghost.item, o.ghost.valid ? 0.8 : 0.45);

  // selección y candados
  if (sel && sel.id !== o.hideId) {
    const s = silhouette(v, sel);
    g.beginPath();
    s.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.strokeStyle = '#d9ccff';
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.stroke();
    g.setLineDash([]);
  }
  if (o.showLocks) {
    g.font = `${Math.max(12, 16 * v.scale)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const it of layout.items) {
      if (!it.locked || it.id === o.hideId) continue;
      const s = silhouette(v, it);
      const top = s.reduce((m, p) => (p.y < m.y ? p : m), s[0]);
      const cx = s.reduce((a, p) => a + p.x, 0) / s.length;
      g.fillStyle = 'rgba(16,19,26,0.78)';
      g.beginPath();
      g.arc(cx, top.y - 2, 11 * Math.max(0.8, v.scale), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText('🔒', cx, top.y - 1);
    }
  }
}
