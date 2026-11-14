import type { ChunkManager } from './chunk-manager';

/**
 * Comprueba si una coordenada global es transitable usando la API pública
 * de ChunkManager. getCell resuelve internamente el chunk y sus coordenadas
 * locales, incluidos los valores negativos.
 */
export function canWalkGlobal(
  chunkManager: ChunkManager,
  globalX: number,
  globalY: number
): boolean {
  const cell = chunkManager.getCell(globalX, globalY);
  return cell?.kind === 'floor' || cell?.kind === 'door';
}
