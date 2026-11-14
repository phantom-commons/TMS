// src/ui/room-dev-panel.ts
import type { LogEntryType } from '../sim/log';
import type { RoomConstants, RoomManifest, RoomPolicy } from '../sim/manifest';
import { MATERIALS, type MaterialId } from '../sim/materials';

export type RoomDevInfo = {
  manifest: RoomManifest;
  policy: RoomPolicy;
  constants: RoomConstants;
  allowedEvents: readonly LogEntryType[];
  relayVerbCount: number;      // cuántos verbos acepta el relay
  replayVerbCount: number;     // cuántos aplica el replay
};

export type RoomDevPanel = {
  setVisible: (v: boolean) => void;
  update: (info: RoomDevInfo) => void;
  dispose: () => void;
};

const section = (title: string) => {
  const h = document.createElement('h3');
  h.textContent = title;
  h.className = 'rdev-section';
  return h;
};

const kv = (k: string, v: string) => {
  const row = document.createElement('div');
  row.className = 'rdev-row';
  const key = document.createElement('span');
  key.textContent = k;
  const val = document.createElement('code');
  val.textContent = v;
  row.append(key, val);
  return row;
};

const table = (title: string, rows: Array<[string, string]>) => {
  const wrap = document.createElement('div');
  wrap.append(section(title));
  const t = document.createElement('table');
  t.className = 'rdev-table';
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = k;
    const td2 = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = v;
    td2.append(code);
    tr.append(td1, td2);
    t.append(tr);
  }
  wrap.append(t);
  return wrap;
};

export function createRoomDevPanel(): RoomDevPanel {
  const root = document.createElement('aside');
  root.className = 'room-dev-panel';
  root.hidden = true;
  document.body.append(root);

  return {
    setVisible: (v) => {
      root.hidden = !v;
      root.classList.toggle('open', v);
    },
    update(info) {
      root.replaceChildren();

      const head = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = `Room · ${info.manifest.roomId}`;
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.onclick = () => { root.hidden = true; root.classList.remove('open'); };
      head.append(title, close);
      root.append(head);

      root.append(table('Manifiesto (INIT, inmutable)', [
        ['roomId', info.manifest.roomId],
        ['isHome', String(info.manifest.isHome)],
        ['owner', info.manifest.owner || '(sin INIT aún)'],
        ['spawn', `(${info.manifest.spawn.x}, ${info.manifest.spawn.y})`],
        ['size', `${info.manifest.size.w}×${info.manifest.size.h}`],
        ['seed', info.manifest.seed ?? '(legacy, sin seed)'],
        ['pillars', String(info.manifest.pillars?.length ?? 0)],
        ['doorTo', info.manifest.doorTo ?? '—'],
      ]));

      root.append(table('Política (mutable)', [
        ['interactionPolicy', info.policy.interactionPolicy],
        ['visibility', info.policy.visibility],
      ]));

      root.append(table('Constantes de simulación', [
        ['tickMs', String(info.constants.tickMs)],
        ['contaminateMlPerStep', String(info.constants.contaminateMlPerStep)],
        ['vomitThreshold', String(info.constants.vomitThreshold)],
        ['stunBucketsAfterVomit', String(info.constants.stunBucketsAfterVomit)],
        ['hangoverDecayPerBucket', String(info.constants.hangoverDecayPerBucket)],
        ['maxEffectsPerEntity', String(info.constants.maxEffectsPerEntity)],
        ['ghostTtlMs', String(info.constants.ghostTtlMs)],
        ['chunkSize', String(info.constants.chunkSize)],
        ['renderDistance', String(info.constants.renderDistance)],
        ['moveCooldownCardinalMs', String(info.constants.moveCooldownCardinalMs)],
        ['moveCooldownDiagonalMs', String(info.constants.moveCooldownDiagonalMs)],
      ]));

      const verbsWrap = document.createElement('div');
      verbsWrap.append(section(`Verbos (${info.allowedEvents.length} allowlist / ${info.replayVerbCount} replay / ${info.relayVerbCount} relay)`));
      const verbs = document.createElement('div');
      verbs.className = 'rdev-verbs';
      for (const v of info.allowedEvents) {
        const chip = document.createElement('span');
        chip.className = 'rdev-chip';
        chip.textContent = v;
        verbs.append(chip);
      }
      verbsWrap.append(verbs);
      root.append(verbsWrap);

      const matWrap = document.createElement('div');
      matWrap.append(section('Materiales (tabla estática)'));
      const matTable = document.createElement('table');
      matTable.className = 'rdev-table';
      const headerRow = document.createElement('tr');
      for (const h of ['material', 'intox', 'flamm', 'nutr', 'poison']) {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.append(th);
      }
      matTable.append(headerRow);
      for (const id of Object.keys(MATERIALS) as MaterialId[]) {
        const m = MATERIALS[id];
        const tr = document.createElement('tr');
        for (const val of [id, m.intoxicating, m.flammable, m.nutritious, m.poisonous]) {
          const td = document.createElement('td');
          td.textContent = String(val);
          tr.append(td);
        }
        matTable.append(tr);
      }
      matWrap.append(matTable);
      root.append(matWrap);
    },
    dispose: () => root.remove(),
  };
}