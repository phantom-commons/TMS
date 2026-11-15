import { ROOM_H, ROOM_W } from './world';

// Plantillas de sala. Son datos puros y deterministas: el INIT firmado solo dice `layout: 'atrium'`
// y cualquier cliente o relay recalcula exactamente las mismas celdas. Nada aquí lee reloj ni azar.

export type Layout = 'atrium';
export type Cell2 = { x: number; y: number };

export const isLayout = (v: unknown): v is Layout => v === 'atrium';

/** `atrium` y `atrium-loquesea` usan la plantilla; el resto de salas, no. */
export function layoutFor(roomId: string): Layout | null {
  return /^atrium(-|$)/.test(roomId) ? 'atrium' : null;
}

/** Dónde nace quien crea una sala con esta plantilla. */
export const layoutSpawn = (layout: Layout): Cell2 => (layout === 'atrium' ? { x: 2, y: 7 } : { x: 3, y: 3 });

/**
 * Atrium: una nave con dos filas de columnas y un altar bajo en el centro (la sigilo del suelo
 * queda justo debajo). La puerta sigue en el muro este, así que la nave siempre lleva a ella.
 */
export function layoutWalls(layout: Layout): Cell2[] {
  if (layout !== 'atrium') return [];
  const out: Cell2[] = [];
  const cols = [4, 7, 13, 16];
  for (const x of cols) {
    out.push({ x, y: 4 }, { x, y: 10 });
  }
  // altar: dos celdas en el centro de la sala
  out.push({ x: Math.floor(ROOM_W / 2) - 1, y: Math.floor(ROOM_H / 2) }, { x: Math.floor(ROOM_W / 2), y: Math.floor(ROOM_H / 2) });
  return out;
}
