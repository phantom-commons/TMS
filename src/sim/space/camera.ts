import type { Space } from './world';

// Cámara que no se deja tapar: desde el jugador hacia el punto deseado se muestrean puntos del segmento y, si alguno
// queda dentro de algo sólido más bajo que su altura, la cámara se acerca hasta justo antes. Pura: el render solo pinta.

export const WALL_HEIGHT = 1.8;

export function clearDistance(space: Pick<Space, 'solidAt'>, px: number, py: number, yaw: number, dist: number, height: number, eye = 0.9, min = 1.6): number {
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const d = dist * t;
    const y = eye + (height - eye) * t;
    if (y >= WALL_HEIGHT) return dist; // ya por encima de lo que puede tapar
    const x = px + Math.sin(yaw) * d;
    const z = py + Math.cos(yaw) * d;
    if (space.solidAt(Math.floor(x), Math.floor(z))) return Math.max(min, dist * ((i - 1) / steps));
  }
  return dist;
}
