import type { LogEntryType } from '../sim/log';

// Decisiones puras del arranque de sincronización con el relay (ver docs/RELAY-SYNC.md).
// Viven aparte de boot.ts para poder probarlas sin navegador ni red.

/** Acciones del jugador que NO se firman mientras el relay aún nos está poniendo al día. */
export const GATED: ReadonlySet<LogEntryType> = new Set<LogEntryType>(['MOVE', 'INTERACT']);

/** Cuántas veces se vuelve a pedir lo que falta antes de reconstruir desde cero. */
export const MAX_RESYNCS = 5;
/** Si en este tiempo no se completa la puesta al día, se avisa y se libera el movimiento (modo local). */
export const SYNC_TIMEOUT_MS = 8000;

export type SyncAction = 'ready' | 'resync' | 'rebuild' | 'fail';

/**
 * Qué hacer tras aplicar un SYNC.
 *  - error: lo que había en la caché local no encaja con el relay (cadena rota, acción inválida…).
 *  - gap: faltan entradas intermedias; behind: seguimos por detrás de la cabeza del relay.
 *  - rebuilt: ya se descartó la caché una vez en esta conexión.
 *  - resyncs: peticiones de «lo que falta» ya hechas en esta conexión.
 */
export function nextSyncAction(i: { error: boolean; gap: boolean; behind: boolean; rebuilt: boolean; resyncs: number }): SyncAction {
  if (i.error) return i.rebuilt ? 'fail' : 'rebuild';
  if (i.gap || i.behind) {
    if (i.resyncs < MAX_RESYNCS) return 'resync';
    return i.rebuilt ? 'fail' : 'rebuild';
  }
  return 'ready';
}

/** ¿Hay que retener esta acción? Solo mientras estamos conectados al relay y todavía sincronizando. */
export const holdsAction = (type: LogEntryType, o: { online: boolean; connected: boolean; ready: boolean; failed: boolean }): boolean =>
  o.online && o.connected && !o.ready && !o.failed && GATED.has(type);
