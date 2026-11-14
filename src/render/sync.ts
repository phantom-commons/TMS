import * as THREE from 'three';
import type { World } from '../sim/world';

const TILE = 1;
const WALL_H = 1;
const COLORS = {
  floor: 0x2b2f3a,
  wall: 0x4a5060,
  object: 0xd4a04a,
  door: 0x5ac4ff,
} as const;

export type Syncer = {
  update: (world: World, dt: number) => void;
  entityMeshes: () => ReadonlyMap<string, THREE.Mesh>;
};

export function createSyncer(scene: THREE.Scene, world: World, localId: string): Syncer {
  const cellGroup = new THREE.Group();
  const entityGroup = new THREE.Group();
  scene.add(cellGroup, entityGroup);

  const geoFloor = new THREE.BoxGeometry(TILE * 0.98, 0.05, TILE * 0.98);
  const geoWall = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const geoLegacyObject = new THREE.BoxGeometry(TILE * 0.6, TILE * 0.6, TILE * 0.6);
  const geoEntity = new THREE.BoxGeometry(TILE * 0.62, TILE * 0.62, TILE * 0.62);
  const geoDoor = new THREE.BoxGeometry(TILE, WALL_H, TILE * 0.4);
  const matFloor = new THREE.MeshLambertMaterial({ color: COLORS.floor });
  const baseFloorColor = new THREE.Color(COLORS.floor);
  const wornPathColor = new THREE.Color(0x786b4d);
  const floorMaterials = new Map<string, THREE.MeshLambertMaterial>();
  const matWall = new THREE.MeshLambertMaterial({ color: COLORS.wall });
  const matObject = new THREE.MeshLambertMaterial({ color: COLORS.object });
  const matDoor = new THREE.MeshLambertMaterial({ color: COLORS.door });

  for (const [cellKey, cell] of Object.entries(world.cells)) {
    const [xs, ys] = cellKey.split(',');
    const x = Number(xs);
    const y = Number(ys);
    let mesh: THREE.Mesh;
    if (cell.kind === 'wall') {
      mesh = new THREE.Mesh(geoWall, matWall);
      mesh.position.set(x + 0.5, WALL_H / 2, y + 0.5);
    } else if (cell.kind === 'object') {
      mesh = new THREE.Mesh(geoLegacyObject, matObject);
      mesh.position.set(x + 0.5, TILE * 0.3, y + 0.5);
    } else if (cell.kind === 'door') {
      mesh = new THREE.Mesh(geoDoor, matDoor);
      mesh.position.set(x + 0.5, WALL_H / 2, y + 0.5);
    } else {
      const floorMaterial = matFloor.clone();
      floorMaterials.set(cellKey, floorMaterial);
      mesh = new THREE.Mesh(geoFloor, floorMaterial);
      mesh.position.set(x + 0.5, 0, y + 0.5);
    }
    mesh.userData.cell = { x, y };
    mesh.userData.legacyObject = cell.kind === 'object';
    cellGroup.add(mesh);
  }

  const avatarGeo = new THREE.CapsuleGeometry(0.25, 0.4, 6, 12);
  const avatars = new Map<string, { mesh: THREE.Mesh; target: THREE.Vector3 }>();
  const entities = new Map<string, THREE.Mesh>();
  const selectable = new Map<string, THREE.Mesh>();

  const colorFor = (id: string) => id === localId
    ? new THREE.Color(0x9b7bff)
    : new THREE.Color().setHSL((parseInt(id.slice(0, 6), 16) % 360) / 360, 0.6, 0.6);

  const update = (w: World, dt: number) => {
    for (const [cellKey, material] of floorMaterials) {
      const visits = w.cellActivity[cellKey]?.playerVisits ?? 0;
      const intensity = Math.min(0.78, Math.log1p(visits) / Math.log1p(80) * 0.78);
      material.color.copy(baseFloorColor).lerp(wornPathColor, intensity);
    }
    for (const [id, pl] of Object.entries(w.players)) {
      let a = avatars.get(id);
      if (!a) {
        const mesh = new THREE.Mesh(avatarGeo, new THREE.MeshLambertMaterial({ color: colorFor(id) }));
        mesh.position.set(pl.x + 0.5, 0.55, pl.y + 0.5);
        scene.add(mesh);
        mesh.userData.targetId = `player:${id}`;
        selectable.set(`player:${id}`, mesh);
        a = { mesh, target: mesh.position.clone() };
        avatars.set(id, a);
      }
      a.target.set(pl.x + 0.5, 0.55, pl.y + 0.5);
      a.mesh.position.lerp(a.target, Math.min(1, dt * 14));
    }
    for (const [id, avatar] of avatars) {
      if (!(id in w.players)) {
        scene.remove(avatar.mesh);
        selectable.delete(`player:${id}`);
        (avatar.mesh.material as THREE.Material).dispose();
        avatars.delete(id);
      }
    }

    for (const entity of Object.values(w.entities)) {
      if (entity.location.kind !== 'room' || entity.location.roomId !== w.roomId) {
        const old = entities.get(entity.id);
        if (old) {
          entityGroup.remove(old);
          entities.delete(entity.id);
          selectable.delete(entity.id);
          (old.material as THREE.Material).dispose();
        }
        continue;
      }
      let mesh = entities.get(entity.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geoEntity, matObject.clone());
        mesh.userData.entityId = entity.id;
        entityGroup.add(mesh);
        entities.set(entity.id, mesh);
        selectable.set(entity.id, mesh);
      }
      mesh.position.set(entity.location.x + 0.5, 0.36, entity.location.y + 0.5);
      mesh.rotation.y = entity.lockedBy ? Math.PI / 4 : 0;
      mesh.userData.entityId = entity.id;
    }
    for (const [id, mesh] of entities) {
      if (!w.entities[id]) {
        entityGroup.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        entities.delete(id);
        selectable.delete(id);
      }
    }
  };

  update(world, 0);
  return { update, entityMeshes: () => selectable };
}
