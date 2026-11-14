import { CHUNK_SIZE, getChunkKey, worldToChunkCoord, type Chunk } from './chunks';
import { loadChunkFromDB, saveChunkToDB } from '../identity/chunk-storage';

export class ChunkManager {
  private loadedChunks = new Map<string, Chunk>();
  private renderDistance: number;

  constructor(renderDistance = 2) {
    this.renderDistance = renderDistance;
  }

  public async updatePlayerPosition(
    playerX: number,
    playerZ: number,
    onChunkLoad: (chunk: Chunk) => void,
    onChunkUnload: (chunkKey: string) => void
  ) {
    const playerChunk = worldToChunkCoord(playerX, playerZ);
    const neededKeys = new Set<string>();

    // 1. Cargar chunks dentro del radio de visión
    for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
      for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
        const cx = playerChunk.cx + x;
        const cz = playerChunk.cz + z;
        const key = getChunkKey(cx, cz);
        neededKeys.add(key);

        if (!this.loadedChunks.has(key)) {
          // Intentar recuperar el chunk de la base de datos local
          let chunk = await loadChunkFromDB(cx, cz);

          if (!chunk) {
            // Si no ha sido modificado/visitado, se genera proceduralmente
            chunk = this.generateProceduralChunk(cx, cz);
          }

          this.loadedChunks.set(key, chunk);
          onChunkLoad(chunk);
        }
      }
    }

    // 2. Descargar chunks lejanos y asegurar guardar su estado actual en IndexedDB
    for (const [key, chunk] of this.loadedChunks.entries()) {
      if (!neededKeys.has(key)) {
        // Guardar cambios antes de descargar de la memoria RAM del navegador
        await saveChunkToDB(chunk);
        
        this.loadedChunks.delete(key);
        onChunkUnload(key);
      }
    }
  }

  private generateProceduralChunk(cx: number, cz: number): Chunk {
    const cells: Chunk['cells'] = {};
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const globalX = startX + x;
        const globalZ = startZ + z;
        
        // Generación base del espacio
        const isBorder = (globalX % CHUNK_SIZE === 0 || globalZ % CHUNK_SIZE === 0);
        cells[`${x},${z}`] = { kind: isBorder ? 'wall' : 'floor' };
      }
    }

    return { cx, cz, cells };
  }

  public getCell(globalX: number, globalZ: number) {
    const chunkCoord = worldToChunkCoord(globalX, globalZ);
    const chunk = this.loadedChunks.get(getChunkKey(chunkCoord.cx, chunkCoord.cz));
    if (!chunk) return null;

    // Calcular coordenadas locales dentro del chunk (manejo seguro de módulo negativo)
    const localX = ((globalX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = ((globalZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    return chunk.cells[`${localX},${localZ}`];
  }
}