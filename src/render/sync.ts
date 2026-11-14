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
};

export function createSyncer(scene: THREE.Scene, world: World, localId: string): Syncer {
  const group = new THREE.Group();
  scene.add(group);

  const geoFloor = new THREE.BoxGeometry(TILE * 0.98, 0.05, TILE * 0.98);
  const geoWall = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const geoObject = new THREE.BoxGeometry(TILE * 0.6, TILE * 0.6, TILE * 0.6);
  const geoDoor = new THREE.BoxGeometry(TILE, WALL_H, TILE * 0.4);

  const matFloor = new THREE.MeshLambertMaterial({ color: COLORS.floor });
  const matWall = new THREE.MeshLambertMaterial({ color: COLORS.wall });
  const matObject = new THREE.MeshLambertMaterial({ color: COLORS.object });
  const matDoor = new THREE.MeshLambertMaterial({ color: COLORS.door });

  for (const [k, cell] of Object.entries(world.cells)) {
    const [xs, ys] = k.split(',');
    const x = Number(xs);
    const y = Number(ys);

    let mesh: THREE.Mesh;
    if (cell.kind === 'wall') {
      mesh = new THREE.Mesh(geoWall, matWall);
      mesh.position.set(x + 0.5, WALL_H / 2, y + 0.5);
    } else if (cell.kind === 'object') {
      mesh = new THREE.Mesh(geoObject, matObject);
      mesh.position.set(x + 0.5, TILE * 0.3, y + 0.5);
    } else if (cell.kind === 'door') {
      mesh = new THREE.Mesh(geoDoor, matDoor);
      mesh.position.set(x + 0.5, WALL_H / 2, y + 0.5);
    } else {
      mesh = new THREE.Mesh(geoFloor, matFloor);
      mesh.position.set(x + 0.5, 0, y + 0.5);
    }
    mesh.userData.cell = { x, y, ...cell };
    group.add(mesh);
  }

    const avatarGeo = new THREE.CapsuleGeometry(0.25, 0.4, 6, 12);
  const avatars = new Map<string, { mesh: THREE.Mesh; target: THREE.Vector3 }>();

  // Tú: violeta. Los demás: un color estable derivado de su pubkey.
  const colorFor = (id: string) =>
    id === localId
      ? new THREE.Color(0x9b7bff)
      : new THREE.Color().setHSL((parseInt(id.slice(0, 6), 16) % 360) / 360, 0.6, 0.6);

  const update = (w: World, dt: number) => {
    for (const [id, pl] of Object.entries(w.players)) {
      let a = avatars.get(id);
      if (!a) {
        const mesh = new THREE.Mesh(
          avatarGeo,
          new THREE.MeshLambertMaterial({ color: colorFor(id) }),
        );
        mesh.position.set(pl.x + 0.5, 0.55, pl.y + 0.5);
        scene.add(mesh);
        a = { mesh, target: mesh.position.clone() };
        avatars.set(id, a);
      }
      a.target.set(pl.x + 0.5, 0.55, pl.y + 0.5);
      a.mesh.position.lerp(a.target, Math.min(1, dt * 14));
    }

    for (const [id, a] of avatars) {
      if (!(id in w.players)) {
        scene.remove(a.mesh);
        (a.mesh.material as THREE.Material).dispose();
        avatars.delete(id);
      }
    }
  };

  return { update };
}