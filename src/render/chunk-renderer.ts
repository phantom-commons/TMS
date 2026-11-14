import * as THREE from 'three';
import type { Chunk } from '../sim/chunks';
import { CHUNK_SIZE } from '../sim/chunks';

const TILE_SIZE = 1;

export class ChunkRenderer {
  private scene: THREE.Scene;
  // Almacena los grupos de objetos en la escena 3D indexados por la clave del chunk
  private chunkMeshes = new Map<string, THREE.Group>();

  private matFloor = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
  private matWall = new THREE.MeshLambertMaterial({ color: 0x4a5060 });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // Construye la malla 3D de un chunk y la añade a la escena
  public loadChunkMesh(chunk: Chunk) {
    const key = `${chunk.cx},${chunk.cz}`;
    if (this.chunkMeshes.has(key)) return;

    const group = new THREE.Group();
    const worldOffsetX = chunk.cx * CHUNK_SIZE;
    const worldOffsetZ = chunk.cz * CHUNK_SIZE;

    const geoFloor = new THREE.BoxGeometry(TILE_SIZE * 0.98, 0.05, TILE_SIZE * 0.98);
    const geoWall = new THREE.BoxGeometry(TILE_SIZE, 1, TILE_SIZE);

    for (const [posKey, cell] of Object.entries(chunk.cells)) {
      const [xs, zs] = posKey.split(',');
      const localX = Number(xs);
      const localZ = Number(zs);

      const globalX = worldOffsetX + localX;
      const globalZ = worldOffsetZ + localZ;

      let mesh: THREE.Mesh;
      if (cell.kind === 'wall') {
        mesh = new THREE.Mesh(geoWall, this.matWall);
        mesh.position.set(globalX + 0.5, 0.5, globalZ + 0.5);
      } else {
        mesh = new THREE.Mesh(geoFloor, this.matFloor);
        mesh.position.set(globalX + 0.5, 0, globalZ + 0.5);
      }
      group.add(mesh);
    }

    this.scene.add(group);
    this.chunkMeshes.set(key, group);
  }

  // Elimina la malla de la escena y libera memoria de la GPU
  public unloadChunkMesh(chunkKey: string) {
    const group = this.chunkMeshes.get(chunkKey);
    if (!group) return;

    // Liberar geometrías y materiales hijos de Three.js para evitar fugas de memoria
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });

    this.scene.remove(group);
    this.chunkMeshes.delete(chunkKey);
  }
}