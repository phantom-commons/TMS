import './hud.css';
import { key, type World } from '../sim/world';
import { presenceState } from '../sim/presence';
import type { Settings } from './settings-store';

// HUD unificado. Antes el estado, los atajos, el botón de ataque y el chat estaban construidos a mano
// dentro de main.ts; aquí viven juntos, comparten estilo y cada pieza obedece a un interruptor de Ajustes.
// El HUD solo LEE (world + frame) y avisa por callbacks: no firma nada ni toca la sim.

export type HudPrompt = { keys: string[]; text: string } | null;

export type HudFrame = {
  world: World;
  self: string;
  online: ReadonlySet<string>;
  /** Date.now() puesto por quien dibuja (la sim no lee el reloj) */
  now: number;
  /** giro de la vista respecto a la rejilla (rad). Con yaw 0 el norte de la sala queda arriba. */
  yaw: number;
  link: 'relay' | 'local' | 'connecting';
  linkLabel: string;
  roomLabel: string;
  pending: number;
  bag: string | null;
  camLabel: string;
  prompt: HudPrompt;
  /** celda seleccionada (se resalta en el minimapa) */
  focus: { x: number; y: number } | null;
  showGhosts: boolean;
};

export type HudChatMsg = { author: string; text: string; mine: boolean };

export type HudDeps = {
  onSend: (text: string) => void;
  onPickDrop: () => void;
  onAttack: () => void;
};

export type Hud = {
  applySettings: (s: Settings) => void;
  update: (frame: HudFrame) => void;
  setChat: (msgs: HudChatMsg[]) => void;
  openChat: () => void;
  closeChat: () => void;
  dispose: () => void;
};

const CELL = 8;
const MAP_REDRAW_MS = 80;
const TEXT_REFRESH_MS = 200;

const LEGEND: Array<[string, string]> = [
  ['WASD', 'mover'],
  ['F', 'recoger/soltar'],
  ['G', 'atacar'],
  ['L', 'bloquear'],
  ['C', 'cámara'],
  ['Q/E', 'girar'],
  ['R', 'radial'],
  ['Enter', 'chat'],
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-3)}`;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const mix = (a: [number, number, number], b: [number, number, number], t: number): string =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

const FLOOR_COLD: [number, number, number] = [26, 30, 40];
const FLOOR_WARM: [number, number, number] = [150, 128, 84];

export function createHud(deps: HudDeps): Hud {
  const root = el('div', 'hud');
  root.id = 'hud';

  // ───────── estado (arriba a la izquierda) ─────────
  const status = el('div', 'hud-status');
  const dot = el('i', 'hud-dot');
  const roomEl = el('b', 'hud-room');
  const linkEl = el('span', 'hud-link');
  const pendEl = el('span', 'hud-pend');
  const bagEl = el('span', 'hud-bag');
  const camEl = el('span', 'hud-cam');
  status.append(dot, roomEl, linkEl, pendEl, bagEl, camEl);

  // ───────── minimapa + brújula (arriba a la derecha, junto a Ajustes) ─────────
  const mapBox = el('div', 'hud-map');
  const canvas = el('canvas', 'hud-map-canvas');
  const compass = el('div', 'hud-compass');
  compass.title = 'Norte de la sala';
  const needle = el('i', 'hud-needle');
  needle.append(el('span', '', 'N'));
  compass.append(needle);
  mapBox.append(canvas);
  const topRight = el('div', 'hud-tr');
  topRight.append(compass, mapBox);

  // ───────── zona inferior central: aviso, chat, atajos ─────────
  const bottom = el('div', 'hud-bottom');
  const promptEl = el('div', 'hud-prompt');
  promptEl.hidden = true;

  const chat = el('div', 'hud-chat');
  chat.dataset.open = 'false';
  const chatHead = el('button', 'hud-chat-head');
  chatHead.type = 'button';
  const chatIcon = el('span', 'hud-chat-icon', '💬');
  const chatPreview = el('span', 'hud-chat-preview', 'chat de sala');
  const chatBadge = el('em', 'hud-chat-badge');
  chatBadge.hidden = true;
  chatHead.append(chatIcon, chatPreview, chatBadge);
  const chatBody = el('div', 'hud-chat-body');
  const chatLog = el('div', 'hud-chat-log');
  const chatForm = el('form', 'hud-chat-form');
  const chatInput = el('input', 'hud-chat-input');
  chatInput.placeholder = 'mensaje…';
  chatInput.maxLength = 240;
  chatInput.autocomplete = 'off';
  const chatSend = el('button', 'hud-chat-send', '➤');
  chatSend.type = 'submit';
  chatForm.append(chatInput, chatSend);
  chatBody.append(chatLog, chatForm);
  chat.append(chatHead, chatBody);

  const legend = el('div', 'hud-legend');
  for (const [k, label] of LEGEND) {
    const item = el('span');
    item.append(el('kbd', '', k), document.createTextNode(` ${label}`));
    legend.append(item);
  }
  bottom.append(promptEl, chat, legend);

  // ───────── botones rápidos (junto al radial) ─────────
  const dock = el('div', 'hud-dock');
  const pickBtn = el('button', 'hud-dock-btn', '🎒');
  pickBtn.type = 'button';
  pickBtn.title = 'Recoger / soltar (F)';
  pickBtn.onclick = () => deps.onPickDrop();
  const atkBtn = el('button', 'hud-dock-btn', '⚔️');
  atkBtn.type = 'button';
  atkBtn.title = 'Atacar (G)';
  atkBtn.onclick = () => deps.onAttack();
  dock.append(pickBtn, atkBtn);

  root.append(el('div', 'hud-vignette'), status, topRight, bottom, dock);
  document.body.append(root);

  // ───────── chat ─────────
  let chatOpen = false;
  let seen = 0;
  let total = 0;
  let renderedKey = '';
  let lastLine = 'chat de sala';

  const paintPreview = () => {
    chatPreview.textContent = chatOpen ? 'chat de sala' : lastLine;
  };

  const setChatOpen = (open: boolean) => {
    chatOpen = open;
    chat.dataset.open = String(open);
    paintPreview();
    if (open) {
      seen = total;
      chatBadge.hidden = true;
      chatLog.scrollTop = chatLog.scrollHeight;
      chatInput.focus();
    } else {
      chatInput.blur();
    }
  };
  chatHead.onclick = () => setChatOpen(!chatOpen);
  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    deps.onSend(text);
    chatInput.value = '';
  };
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setChatOpen(false);
    }
  });

  // ───────── minimapa ─────────
  const g = canvas.getContext('2d');
  let mapW = 0;
  let mapH = 0;
  let lastMap = 0;
  const sizeCanvas = (w: number, h: number) => {
    if (w === mapW && h === mapH) return;
    mapW = w;
    mapH = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * CELL * dpr;
    canvas.height = h * CELL * dpr;
    canvas.style.aspectRatio = `${w} / ${h}`;
    g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawMap = (f: HudFrame) => {
    if (!g) return;
    const w = f.world;
    sizeCanvas(w.size.w, w.size.h);
    g.clearRect(0, 0, w.size.w * CELL, w.size.h * CELL);

    for (let y = 0; y < w.size.h; y++) {
      for (let x = 0; x < w.size.w; x++) {
        const k = key(x, y);
        const cell = w.cells[k];
        if (!cell) continue;
        if (cell.kind === 'wall') g.fillStyle = 'rgb(66,72,92)';
        else if (cell.kind === 'door') g.fillStyle = 'rgb(90,196,255)';
        else {
          const visits = w.cellActivity[k]?.playerVisits ?? 0;
          const t = Math.min(1, Math.log1p(visits) / Math.log1p(60));
          g.fillStyle = mix(FLOOR_COLD, FLOOR_WARM, t);
        }
        g.fillRect(x * CELL, y * CELL, CELL - 0.6, CELL - 0.6);
      }
    }

    for (const e of Object.values(w.entities)) {
      if (e.location.kind !== 'room' || e.location.roomId !== w.roomId) continue;
      g.fillStyle = e.lockedBy ? 'rgb(154,160,180)' : 'rgb(212,160,74)';
      g.fillRect(e.location.x * CELL + 1.5, e.location.y * CELL + 1.5, CELL - 3.6, CELL - 3.6);
    }

    for (const [id, p] of Object.entries(w.players)) {
      const state = presenceState(id, f.self, f.online, p.hlc.t, f.now);
      if (state === 'hidden' || (state === 'ghost' && !f.showGhosts)) continue;
      const cx = p.x * CELL + CELL / 2;
      const cy = p.y * CELL + CELL / 2;
      const mine = id === f.self;
      g.globalAlpha = state === 'ghost' ? 0.4 : 1;
      g.fillStyle = mine ? '#9b7bff' : `hsl(${parseInt(id.slice(0, 6), 16) % 360} 60% 60%)`;
      g.beginPath();
      g.arc(cx, cy, mine ? 3.2 : 2.6, 0, Math.PI * 2);
      g.fill();
      if (mine) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1;
        g.stroke();
        // hacia dónde mira la cámara: "arriba de la pantalla" expresado en la rejilla
        const ux = -Math.sin(f.yaw);
        const uy = -Math.cos(f.yaw);
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(cx + ux * 7.2, cy + uy * 7.2);
        g.lineTo(cx + ux * 4.4 - uy * 2.2, cy + uy * 4.4 + ux * 2.2);
        g.lineTo(cx + ux * 4.4 + uy * 2.2, cy + uy * 4.4 - ux * 2.2);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    }

    if (f.focus) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.2;
      g.strokeRect(f.focus.x * CELL + 0.6, f.focus.y * CELL + 0.6, CELL - 1.8, CELL - 1.8);
    }
  };

  // ───────── actualización ─────────
  let lastText = 0;
  let lastPrompt = '';
  let needleAngle = 0;
  let lastYaw = 0;
  const cache: Record<string, string> = {};
  const setText = (node: HTMLElement, id: string, value: string) => {
    if (cache[id] === value) return;
    cache[id] = value;
    node.textContent = value;
  };

  const update = (f: HudFrame) => {
    const nowMs = performance.now();

    // brújula: acumula el giro por el camino corto para que la aguja no dé vueltas completas
    needleAngle += wrapPi(f.yaw - lastYaw);
    lastYaw = f.yaw;
    needle.style.transform = `rotate(${needleAngle}rad)`;

    if (nowMs - lastMap >= MAP_REDRAW_MS) {
      lastMap = nowMs;
      drawMap(f);
    }

    if (nowMs - lastText < TEXT_REFRESH_MS) return;
    lastText = nowMs;

    status.dataset.state = f.link;
    setText(roomEl, 'room', f.roomLabel);
    setText(linkEl, 'link', f.linkLabel);
    setText(pendEl, 'pend', f.pending ? `↑${f.pending}` : '');
    pendEl.hidden = f.pending === 0;
    setText(bagEl, 'bag', f.bag ? `🎒 ${f.bag}` : '');
    bagEl.hidden = !f.bag;
    setText(camEl, 'cam', f.camLabel);
    pickBtn.dataset.active = f.bag ? 'true' : 'false';
    pickBtn.title = f.bag ? 'Soltar (F)' : 'Recoger (F)';

    const pk = f.prompt ? JSON.stringify(f.prompt) : '';
    if (pk !== lastPrompt) {
      lastPrompt = pk;
      promptEl.hidden = !f.prompt;
      promptEl.replaceChildren();
      if (f.prompt) {
        for (const k of f.prompt.keys) promptEl.append(el('kbd', '', k));
        promptEl.append(el('span', '', f.prompt.text));
      }
    }
  };

  const setChat = (msgs: HudChatMsg[]) => {
    const last = msgs[msgs.length - 1];
    const k = `${msgs.length}|${last?.text ?? ''}|${last?.author ?? ''}`;
    if (k === renderedKey) return;
    renderedKey = k;
    total = msgs.length;
    chatLog.replaceChildren();
    for (const m of msgs) {
      const row = el('div', m.mine ? 'hud-chat-msg mine' : 'hud-chat-msg');
      row.append(el('b', '', m.mine ? 'tú' : short(m.author)), el('span', '', m.text));
      chatLog.append(row);
    }
    lastLine = last ? `${last.mine ? 'tú' : short(last.author)}: ${last.text}` : 'chat de sala';
    paintPreview();
    if (chatOpen) {
      seen = total;
      chatLog.scrollTop = chatLog.scrollHeight;
    } else {
      const unread = Math.max(0, total - seen);
      chatBadge.hidden = unread === 0;
      chatBadge.textContent = String(unread);
    }
  };

  const applySettings = (s: Settings) => {
    root.dataset.stage = s.stage;
    status.hidden = !s.status;
    mapBox.hidden = !s.minimap;
    compass.hidden = !s.compass;
    legend.hidden = !s.hints;
    chat.hidden = !s.chat;
    if (!s.chat && chatOpen) setChatOpen(false);
    dock.hidden = !s.dock;
  };

  return {
    applySettings,
    update,
    setChat,
    openChat: () => setChatOpen(true),
    closeChat: () => setChatOpen(false),
    dispose: () => root.remove(),
  };
}
