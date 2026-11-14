import * as THREE from 'three';
import type { World, Cell } from '../sim/world';

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
  previewDrop: (cell: { x: number; y: number } | null) => void;
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
  const matWall = new THREE.MeshLambertMaterial({ color: COLORS.wall });
  const matObject = new THREE.MeshLambertMaterial({ color: COLORS.object });
  const matDoor = new THREE.MeshLambertMaterial({ color: COLORS.door });
  const cellMeshes = new Map<string, THREE.Mesh>();
  const floorMaterials = new Map<string, THREE.MeshLambertMaterial>();

  const buildCell = (cellKey: string, cell: Cell): THREE.Mesh => {
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
      const material = matFloor.clone();
      floorMaterials.set(cellKey, material);
      mesh = new THREE.Mesh(geoFloor, material);
      mesh.position.set(x + 0.5, 0, y + 0.5);
    }
    mesh.castShadow = cell.kind === 'wall' || cell.kind === 'object' || cell.kind === 'door';
    mesh.receiveShadow = true;
    mesh.userData.cell = { x, y };
    mesh.userData.kind = cell.kind;
    cellGroup.add(mesh);
    cellMeshes.set(cellKey, mesh);
    return mesh;
  };

  for (const [cellKey, cell] of Object.entries(world.cells)) buildCell(cellKey, cell);

  const avatarGeo = new THREE.CapsuleGeometry(0.25, 0.4, 6, 12);
  const avatars = new Map<string, { mesh: THREE.Mesh; target: THREE.Vector3 }>();
  const entities = new Map<string, THREE.Mesh>();
  // This map includes avatars for inspection. Only meshes with entityId can be picked up.
  const selectable = new Map<string, THREE.Mesh>();

  const colorFor = (id: string) => id === localId
    ? new THREE.Color(0x9b7bff)
    : new THREE.Color().setHSL((parseInt(id.slice(0, 6), 16) % 360) / 360, 0.6, 0.6);

  const previewGeometry = new THREE.PlaneGeometry(0.9, 0.9);
  const previewMaterial = new THREE.MeshBasicMaterial({
    color: 0x9b7bff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const previewMesh = new THREE.Mesh(previewGeometry, previewMaterial);
  previewMesh.rotation.x = -Math.PI / 2;
  previewMesh.position.y = 0.075;
  previewMesh.visible = false;
  scene.add(previewMesh);

  const previewDrop = (cell: { x: number; y: number } | null) => {
    previewMesh.visible = !!cell;
    if (cell) previewMesh.position.set(cell.x + 0.5, 0.075, cell.y + 0.5);
  };

  const update = (w: World, dt: number) => {
    // Replace cell geometry when replay changes a legacy object tile into floor.
    for (const [cellKey, cell] of Object.entries(w.cells)) {
      const existing = cellMeshes.get(cellKey);
      if (!existing || existing.userData.kind !== cell.kind) {
        if (existing) {
          cellGroup.remove(existing);
          const oldMaterial = existing.material;
          if (oldMaterial instanceof THREE.Material && oldMaterial !== matFloor &&
              oldMaterial !== matWall && oldMaterial !== matObject && oldMaterial !== matDoor) {
            oldMaterial.dispose();
          }
          floorMaterials.delete(cellKey);
          cellMeshes.delete(cellKey);
        }
        buildCell(cellKey, cell);
      }
    }

    for (const [cellKey, material] of floorMaterials) {
      const visits = w.cellActivity[cellKey]?.playerVisits ?? 0;
      const intensity = Math.min(0.78, Math.log1p(visits) / Math.log1p(80) * 0.78);
      material.color.copy(baseFloorColor).lerp(wornPathColor, intensity);
    }

    for (const [id, player] of Object.entries(w.players)) {
      let avatar = avatars.get(id);
      if (!avatar) {
        const mesh = new THREE.Mesh(avatarGeo, new THREE.MeshLambertMaterial({ color: colorFor(id) }));
        mesh.position.set(player.x + 0.5, 0.55, player.y + 0.5);
        scene.add(mesh);
        mesh.castShadow = true;
        mesh.userData.targetId = `player:${id}`;
        selectable.set(`player:${id}`, mesh);
        avatar = { mesh, target: mesh.position.clone() };
        avatars.set(id, avatar);
      }
      avatar.target.set(player.x + 0.5, 0.55, player.y + 0.5);
      avatar.mesh.position.lerp(avatar.target, Math.min(1, dt * 14));
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
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
  return { update, entityMeshes: () => selectable, previewDrop };
}
