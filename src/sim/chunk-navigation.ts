import { CHUNK_SIZE, worldToChunkCoord, getChunkKey } from './chunks';
import type { ChunkManager } from './chunk-manager';

/**
 * Comprueba si un personaje puede caminar a una coordenada global (x, y)
 * evaluando el chunk correspondiente en el ChunkManager.
 */
export function canWalkGlobal(
  chunkManager: ChunkManager,
  globalX: number,
  globalY: number
): boolean {
  // 1. Encontrar a qué chunk pertenece la coordenada global
  const { cx, cz } = worldToChunkCoord(globalX, globalY);

  // 2. Obtener el chunk desde la memoria del administrador
  const chunk = chunkManager.getChunk(cx, cz);
  if (!chunk) {
    // Si el chunk no está cargado en memoria (muy lejos o descargado), bloqueamos el paso
    return false;
  }

  // 3. Calcular las coordenadas locales dentro del chunk (con manejo seguro de negativos)
  const localX = ((globalX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localZ = ((globalY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

  // 4. Buscar la celda y validar su tipo
  const cell = chunk.cells[`${localX},${localZ}`];
  if (!cell) return false;

  // Una celda es transitable si es suelo o puerta
  return cell.kind === 'floor' || cell.kind === 'door';
}