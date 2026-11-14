export type PresenceState = 'online' | 'ghost' | 'hidden';

/** Cuánto tiempo se ve el fantasma de alguien que ya no está conectado. */
export const GHOST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Conectado → sólido. Desconectado con actividad reciente → fantasma. Más viejo que `ttl` → oculto.
 * `nowMs` lo pone quien llama (la sim no lee el reloj).
 */
export function presenceState(
  id: string,
  selfId: string,
  online: ReadonlySet<string>,
  lastActivityMs: number,
  nowMs: number,
  ttl: number = GHOST_TTL_MS,
): PresenceState {
  if (id === selfId || online.has(id)) return 'online';
  return nowMs - lastActivityMs <= ttl ? 'ghost' : 'hidden';
}
