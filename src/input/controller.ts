export type Vec = { dx: number; dy: number };
export type InputSource = { read(): Vec; dispose(): void };

export const ZERO: Vec = { dx: 0, dy: 0 };

// Convierte un eje analógico (-1..1) en una de 8 direcciones.
export function toDir8(x: number, y: number, dead = 0.35): Vec {
  if (Math.hypot(x, y) < dead) return ZERO;
  const k = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return {
    dx: Math.round(Math.cos(k * (Math.PI / 4))) || 0,
    dy: Math.round(Math.sin(k * (Math.PI / 4))) || 0,
  };
}

export function createController(sources: InputSource[]) {
  return {
    read(): Vec {
      for (const s of sources) {
        const v = s.read();
        if (v.dx !== 0 || v.dy !== 0) return v;
      }
      return ZERO;
    },
    dispose() {
      sources.forEach((s) => s.dispose());
    },
  };
}