import { VPC } from '../../core/objects';
import { DIRS, footprintOf, type Dir, type HouseState, type ObjectDefs, type Rot } from './state';

// Ayudas puras para colocar objetos: de «el punto que toqué / la casilla de enfrente» a una posición válida en voxeles.

/** Encaje al colocar: 'voxel' deja moverlo de voxel en voxel; 'cell' lo alinea a las casillas. */
export type Snap = 'voxel' | 'cell';
export const snapStep = (s: Snap): number => (s === 'cell' ? VPC : 1);

/**
 * Esquina mínima para que la huella del objeto quede centrada en el punto (en voxeles), con el encaje pedido y
 * sin salirse de la habitación. null si el objeto es desconocido.
 */
export function placementOrigin(
  s: HouseState,
  defs: ObjectDefs,
  kind: string,
  rot: Rot,
  anchorX: number,
  anchorY: number,
  snap: Snap,
): { x: number; y: number } | null {
  const f = footprintOf(defs, { kind, x: 0, y: 0, rot });
  if (!f) return null;
  const step = snapStep(snap);
  const w = f.x1;
  const d = f.y1;
  const align = (v: number) => Math.round(v / step) * step;
  const fit = (v: number, size: number, max: number) => Math.max(0, Math.min(max - size, v));
  let x = align(anchorX - w / 2);
  let y = align(anchorY - d / 2);
  // con encaje de casilla, un objeto que no ocupa casillas enteras se centra dentro de ellas
  if (snap === 'cell') {
    x += Math.floor((Math.ceil(w / VPC) * VPC - w) / 2);
    y += Math.floor((Math.ceil(d / VPC) * VPC - d) / 2);
  }
  return { x: fit(x, w, s.w * VPC), y: fit(y, d, s.d * VPC) };
}

/** Casilla situada delante del jugador en un rumbo (puede salirse de la casa: quien llama decide). */
export const cellAhead = (s: HouseState, dir: Dir): { cx: number; cy: number } => {
  const [dx, dy] = DIRS[dir] as readonly [number, number];
  return { cx: s.player.cx + dx, cy: s.player.cy + dy };
};

/** Rumbo cardinal más cercano a un ángulo de vista (0 norte, π/2 este, en sentido horario visto desde arriba). */
export const dirOfYaw = (yaw: number): Dir => ((((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4) as Dir);
