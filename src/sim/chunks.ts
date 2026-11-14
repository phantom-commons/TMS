export const CHUNK_SIZE = 16; // Cada chunk mide 16x16 celdas

export type ChunkCoord = { cx: number; cz: number };

export type Chunk = {
  cx: number;
  cz: number;
  cells: Record<string, { kind: 'floor' | 'wall' | 'object' | 'door' }>;
};

// Genera una clave única para el mapa de chunks cargados (ej: "2,-1")
export const getChunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

// Convierte una posición global (x, z) a coordenadas de chunk
export function worldToChunkCoord(x: number, z: number): ChunkCoord {
  return {
    cx: Math.floor(x / CHUNK_SIZE),
    cz: Math.floor(z / CHUNK_SIZE),
  };
}