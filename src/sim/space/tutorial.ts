// Hechos del tutorial deducidos de la posición, sin render: dónde está la escotilla de Tu Room y cuándo estás cerca.
// Tu Room es el interior de la nave; su escotilla está en el centro de la pared sur.

export const hatchSpot = (w: number, d: number): { x: number; y: number } => ({ x: Math.floor(w / 2), y: d - 1 });

const cheb = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** ¿Está el jugador (celda) a una celda de la escotilla? */
export const nearHatch = (px: number, py: number, w: number, d: number): boolean => {
  const h = hatchSpot(w, d);
  return cheb(px, py, h.x, h.y) <= 1;
};

/** ¿Hay algún objeto colocado a 2 celdas o menos del jugador? Las posiciones se dan en CELDAS (los objetos de la casa están en voxels: dividir entre VPC). Sirve para el objetivo «usa un objeto». */
export const nearObject = (px: number, py: number, objects: ReadonlyArray<{ x: number; y: number }>): boolean => objects.some((o) => cheb(px, py, o.x, o.y) <= 2);
