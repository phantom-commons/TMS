export type DevInfo = {
  relay: string;
  room: string;
  mode: string;
  rseq: number;
  pending: number;
  entries: number;
  online: number;
  players: string[];
  entities: number;
  me: string;
  fps: number;
  tail: string[];
};

export type DevHud = {
  setVisible: (v: boolean) => void;
  update: (info: DevInfo) => void;
  dispose: () => void;
};

/** Panel de desarrollador (F2): estado del relay, la cadena y las últimas entradas. */
export function createDevHud(actions: { verify: () => void; exportLog: () => void; fullLog: () => void }): DevHud {
  const root = document.createElement('aside');
  root.className = 'dev-hud';
  root.hidden = true;
  const pre = document.createElement('pre');
  const row = document.createElement('div');
  for (const [label, run] of [['verificar cadena', actions.verify], ['exportar log', actions.exportLog], ['log completo', actions.fullLog]] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = run;
    row.append(b);
  }
  root.append(pre, row);
  document.body.append(root);

  return {
    setVisible: (v) => void (root.hidden = !v),
    update(i) {
      pre.textContent = [
        `sala     ${i.room}`,
        `modo     ${i.mode}   relay ${i.relay}`,
        `rseq     ${i.rseq}   pendientes ${i.pending}   entradas ${i.entries}`,
        `online   ${i.online}   jugadores ${i.players.length}   objetos ${i.entities}`,
        `yo       ${i.me}   fps ${i.fps}`,
        ...i.players.map((p) => `  · ${p}`),
        '── últimas entradas ──',
        ...i.tail,
      ].join('\n');
    },
    dispose: () => root.remove(),
  };
}
