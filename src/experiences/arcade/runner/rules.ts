import type { KV } from '../../../core/kv';
import { manifestFingerprint, normalizeManifest, type Manifest } from '../../../sim/nodes/manifest';
import { RUNNER_MANIFEST } from '../../../sim/nodes/presets/runner';
import type { GameId } from '../scores';

// Las reglas de Salto que el jugador ha tocado se guardan como un manifiesto completo en este dispositivo.
// Al cargar se vuelve a acotar todo contra el esquema: un guardado viejo o manipulado nunca rompe el juego.

const KEY = 'rules.runner';
let defaultFp: string | null = null;
const defaultFingerprint = () => (defaultFp ??= manifestFingerprint(RUNNER_MANIFEST));

export const isDefaultRules = (m: Manifest): boolean => manifestFingerprint(m) === defaultFingerprint();

export function loadRules(kv: KV): Manifest {
  return normalizeManifest(kv.get<unknown>(KEY, null), RUNNER_MANIFEST);
}

export function saveRules(kv: KV, m: Manifest): void {
  if (isDefaultRules(m)) kv.remove(KEY);
  else kv.set(KEY, m);
}

export function resetRules(kv: KV): Manifest {
  kv.remove(KEY);
  return RUNNER_MANIFEST;
}

/** el récord depende de las reglas: con las de fábrica es «runner», con otras, uno por cada combinación */
export function scoreIdFor(m: Manifest): GameId {
  return isDefaultRules(m) ? 'runner' : `runner:${manifestFingerprint(m).slice(0, 10)}`;
}
