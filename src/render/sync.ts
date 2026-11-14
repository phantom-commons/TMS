import * as THREE from 'three';
import type { World } from '../sim/world';
import { paletteHue } from '../sim/worldgen';
import { presenceState } from '../sim/presence';

const TILE = 1;
const WALL_H = 1;

export type Presence = {
  selfId: string;
  online: ReadonlySet<string>;
  /** Date.now() puesto por quien dibuja (la sim no lee el reloj) */
  now: number;
  showGhosts: boolean;
};

export type Syncer = {
  update: (world: World, dt: number, presence: Presence) => void;
  entityMeshes: () => ReadonlyMap<string, THREE.Mesh>;
  setHover: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setHideSelf: (hide: boolean) => void;
  /** posición suavizada del avatar propio */
  selfPosition: () => THREE.Vector3 | null;
  dispose: () => void;
};

function ghostGeometry(): THREE.BufferGeometry {
  // cuerpo de fantasma: cúpula + falda ancha (revolución)
  const pts = [
    [0.0, 0.0], [0.27, 0.0], [0.31, 0.08], [0.29, 0.45], [0.24, 0.68], [0.14, 0.82], [0.0, 0.86],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 16);
  g.translate(0, -0.43, 0);
  return g;
}

export function createSyncer(scene: THREE.Scene, initial: World, localId: string): Syncer {
  const staticGroup = new THREE.Group();
  const entityGroup = new THREE.Group();
  scene.add(staticGroup, entityGroup);

  const geoEntity = new THREE.BoxGeometry(TILE * 0.62, TILE * 0.62, TILE * 0.62);
  const geoEdges = new THREE.EdgesGeometry(geoEntity);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
  const matObject = new THREE.MeshLambertMaterial({ color: 0xd4a04a });
  const avatarGeo = new THREE.CapsuleGeometry(0.25, 0.4, 6, 12);
  const ghostGeo = ghostGeometry();

  // ---------- suelo, muros y puerta (InstancedMesh: 1 draw call por tipo) ----------
  let signature = '';
  let floorMesh: THREE.InstancedMesh | null = null;
  let floorKeys: string[] = [];
  let legacyMeshes: Array<{ mesh: THREE.Mesh; cellKey: string }> = [];
  let baseFloor = new THREE.Color(0x2b2f3a);
  let wornFloor = new THREE.Color(0x786b4d);
  const disposables: Array<{ dispose: () => void }> = [];
  const tmp = new THREE.Matrix4();
  const tmpColor = new THREE.Color();

  const clearStatic = () => {
    staticGroup.clear();
    disposables.splice(0).forEach((d) => d.dispose());
    floorMesh = null;
    floorKeys = [];
    legacyMeshes = [];
  };

  const sigOf = (w: World) => {
    const door = Object.entries(w.cells).find(([, c]) => c.kind === 'door');
    return `${w.roomId}|${w.seed ?? ''}|${door?.[1].targetRoomId ?? ''}|${w.size.w}x${w.size.h}`;
  };

  const buildStatic = (w: World) => {
    clearStatic();
    signature = sigOf(w);
    const hue = w.seed ? paletteHue(w.seed) : null;
    baseFloor = hue === null ? new THREE.Color(0x2b2f3a) : new THREE.Color().setHSL(hue / 360, 0.14, 0.19);
    wornFloor = hue === null ? new THREE.Color(0x786b4d) : new THREE.Color().setHSL(((hue + 40) % 360) / 360, 0.35, 0.42);
    const wallColor = hue === null ? new THREE.Color(0x4a5060) : new THREE.Color().setHSL(hue / 360, 0.12, 0.34);

    const floors: Array<[number, number, string]> = [];
    const walls: Array<[number, number]> = [];
    const objects: Array<[number, number, string]> = [];
    const doors: Array<[number, number]> = [];
    for (const [cellKey, cell] of Object.entries(w.cells)) {
      const [xs, ys] = cellKey.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (cell.kind === 'wall') walls.push([x, y]);
      else if (cell.kind === 'door') doors.push([x, y]);
      else {
        floors.push([x, y, cellKey]);
        if (cell.kind === 'object') objects.push([x, y, cellKey]); // cubo v1 incrustado en el mapa
      }
    }

    const geoFloor = new THREE.BoxGeometry(TILE * 0.98, 0.05, TILE * 0.98);
    const matFloor = new THREE.MeshLambertMaterial({ color: 0xffffff });
    floorMesh = new THREE.InstancedMesh(geoFloor, matFloor, floors.length);
    floorMesh.receiveShadow = true;
    floors.forEach(([x, y, k], i) => {
      tmp.makeTranslation(x + 0.5, 0, y + 0.5);
      floorMesh?.setMatrixAt(i, tmp);
      floorMesh?.setColorAt(i, baseFloor);
      floorKeys[i] = k;
    });
    staticGroup.add(floorMesh);

    const geoWall = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const matWall = new THREE.MeshLambertMaterial({ color: wallColor });
    const wallMesh = new THREE.InstancedMesh(geoWall, matWall, walls.length);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    walls.forEach(([x, y], i) => {
      tmp.makeTranslation(x + 0.5, WALL_H / 2, y + 0.5);
      wallMesh.setMatrixAt(i, tmp);
    });
    staticGroup.add(wallMesh);

    const geoDoor = new THREE.BoxGeometry(TILE, WALL_H, TILE * 0.4);
    const matDoor = new THREE.MeshLambertMaterial({ color: 0x5ac4ff, emissive: 0x1b5a7a });
    for (const [x, y] of doors) {
      const m = new THREE.Mesh(geoDoor, matDoor);
      m.position.set(x + 0.5, WALL_H / 2, y + 0.5);
      m.castShadow = true;
      staticGroup.add(m);
    }

    const geoLegacy = new THREE.BoxGeometry(TILE * 0.6, TILE * 0.6, TILE * 0.6);
    for (const [x, y, k] of objects) {
      const m = new THREE.Mesh(geoLegacy, matObject);
      m.position.set(x + 0.5, TILE * 0.3, y + 0.5);
      m.castShadow = true;
      staticGroup.add(m);
      legacyMeshes.push({ mesh: m, cellKey: k });
    }
    disposables.push(geoFloor, matFloor, geoWall, matWall, geoDoor, matDoor, geoLegacy, floorMesh, wallMesh);
  };

  // ---------- avatares y objetos ----------
  type Avatar = { mesh: THREE.Mesh; target: THREE.Vector3; ghost: boolean; phase: number };
  const avatars = new Map<string, Avatar>();
  const entities = new Map<string, THREE.Mesh>();
  const selectable = new Map<string, THREE.Mesh>();
  let hover: string | null = null;
  let selected: string | null = null;
  let hideSelf = false;
  let time = 0;
  let floorTick = 0;

  const colorFor = (id: string) => id === localId
    ? new THREE.Color(0x9b7bff)
    : new THREE.Color().setHSL((parseInt(id.slice(0, 6), 16) % 360) / 360, 0.6, 0.6);

  const update = (w: World, dt: number, pres: Presence) => {
    time += dt;
    if (sigOf(w) !== signature) buildStatic(w);

    // desgaste del suelo por visitas (≈4 veces por segundo)
    floorTick += dt;
    if (floorMesh && floorTick > 0.25) {
      floorTick = 0;
      floorKeys.forEach((k, i) => {
        const visits = w.cellActivity[k]?.playerVisits ?? 0;
        const t = Math.min(0.78, (Math.log1p(visits) / Math.log1p(80)) * 0.78);
        floorMesh?.setColorAt(i, tmpColor.copy(baseFloor).lerp(wornFloor, t));
      });
      if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
    }
    for (const l of legacyMeshes) l.mesh.visible = w.cells[l.cellKey]?.kind === 'object';

    for (const [id, pl] of Object.entries(w.players)) {
      const state = presenceState(id, pres.selfId, pres.online, pl.hlc.t, pres.now);
      let a = avatars.get(id);
      if (!a) {
        const mesh = new THREE.Mesh(avatarGeo, new THREE.MeshLambertMaterial({ color: colorFor(id) }));
        mesh.position.set(pl.x + 0.5, 0.55, pl.y + 0.5);
        mesh.castShadow = true;
        mesh.userData.targetId = `player:${id}`;
        scene.add(mesh);
        selectable.set(`player:${id}`, mesh);
        a = { mesh, target: mesh.position.clone(), ghost: false, phase: Math.random() * 6 };
        avatars.set(id, a);
      }
      const ghost = state === 'ghost';
      if (ghost !== a.ghost) {
        a.ghost = ghost;
        a.mesh.geometry = ghost ? ghostGeo : avatarGeo;
        const mat = a.mesh.material as THREE.MeshLambertMaterial;
        mat.transparent = ghost;
        mat.opacity = ghost ? 0.42 : 1;
        mat.needsUpdate = true;
      }
      a.mesh.visible = state !== 'hidden' && (state !== 'ghost' || pres.showGhosts) && !(hideSelf && id === localId);
      const bob = a.ghost ? Math.sin(time * 1.6 + a.phase) * 0.06 : 0;
      a.target.set(pl.x + 0.5, 0.55 + bob, pl.y + 0.5);
      a.mesh.position.lerp(a.target, Math.min(1, dt * 14));
      const target = `player:${id}`;
      const lit = hover === target || selected === target;
      (a.mesh.material as THREE.MeshLambertMaterial).emissive.setHex(lit ? 0x443366 : 0x000000);
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
        mesh.add(new THREE.LineSegments(geoEdges, edgeMat));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.entityId = entity.id;
        entityGroup.add(mesh);
        entities.set(entity.id, mesh);
        selectable.set(entity.id, mesh);
        mesh.position.set(entity.location.x + 0.5, 0.36, entity.location.y + 0.5);
      }
      const goal = new THREE.Vector3(entity.location.x + 0.5, 0.36, entity.location.y + 0.5);
      mesh.position.lerp(goal, Math.min(1, dt * 16));
      mesh.rotation.y = entity.lockedBy ? Math.PI / 4 : 0;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      mat.color.setHex(entity.lockedBy ? 0x9aa0b4 : 0xd4a04a);
      mat.emissive.setHex(hover === entity.id || selected === entity.id ? 0x6a4a10 : 0x000000);
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

  buildStatic(initial);
  return {
    update,
    entityMeshes: () => selectable,
    setHover: (id) => void (hover = id),
    setSelected: (id) => void (selected = id),
    setHideSelf: (hide) => void (hideSelf = hide),
    selfPosition: () => avatars.get(localId)?.mesh.position ?? null,
    dispose() {
      clearStatic();
      scene.remove(staticGroup, entityGroup);
    },
  };
}
