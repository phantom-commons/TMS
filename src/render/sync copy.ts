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

const LIQUID_COLORS: Record<string, THREE.Color> = {
  water: new THREE.Color(0x2b6ca3),
  beer: new THREE.Color(0xb08a3a),
  wine: new THREE.Color(0x6b1f3a),
  blood: new THREE.Color(0x7a1010),
  oil: new THREE.Color(0x1a1a1a),
  acid: new THREE.Color(0x6fdc4f),
  vomit: new THREE.Color(0x8a9e3a),
  mud: new THREE.Color(0x4a3a2a),
};

const DRUNK_TINT = new THREE.Color(0x6a8a3a);

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
  const geoCreature = new THREE.CapsuleGeometry(0.22, 0.32, 6, 12);
  const geoDoor = new THREE.BoxGeometry(TILE, WALL_H, TILE * 0.4);

  const matFloor = new THREE.MeshLambertMaterial({ color: COLORS.floor });
  const matWall = new THREE.MeshLambertMaterial({ color: COLORS.wall });
  const matObject = new THREE.MeshLambertMaterial({ color: COLORS.object });
  const matDoor = new THREE.MeshLambertMaterial({ color: COLORS.door });
  const baseFloorColor = new THREE.Color(COLORS.floor);
  const baseObjectColor = new THREE.Color(COLORS.object);
  const wornPathColor = new THREE.Color(0x786b4d);

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
  const selectable = new Map<string, THREE.Mesh>();

  const colorFor = (id: string) =>
    id === localId
      ? new THREE.Color(0x9b7bff)
      : new THREE.Color().setHSL((parseInt(id.slice(0, 6), 16) % 360) / 360, 0.6, 0.6);

  const previewGeometry = new THREE.PlaneGeometry(0.9, 0.9);
  const previewMaterial = new THREE.MeshBasicMaterial({
    color: 0x9b7bff,
    transparent: true,
    opacity: 0