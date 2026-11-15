import type { KV } from '../../core/kv';

// Los récords son estado local de cada experiencia: NO son eventos firmados ni se replican por el relay.
// (Cada movimiento de Snake como evento firmado saturaría el relay y no aporta nada.)

export type GameId = 'snake' | 'runner';

export const getBest = (kv: KV, game: GameId): number => {
  const v = kv.get<number>(`best.${game}`, 0);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

export function submitScore(kv: KV, game: GameId, score: number): { best: number; isRecord: boolean } {
  const best = getBest(kv, game);
  const s = Math.max(0, Math.floor(score));
  if (s > best) {
    kv.set(`best.${game}`, s);
    return { best: s, isRecord: true };
  }
  return { best, isRecord: false };
}
