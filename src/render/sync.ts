import * as THREE from 'three';
import type { EventPointer, World } from '../sim/world';
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
  const trailGroup = new THREE.Group();
  scene.add(staticGroup, entityGroup, trailGroup);

  const geoEntity = new THREE.BoxGeometry(TILE * 0.62, TILE * 0.62, TILE * 0.62);
  const geoEdges = new THREE.EdgesGeometry(geoEntity);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
  const matObject = new THREE.MeshLambertMaterial({ color: 0xd4a04a });
  const avatarGeo = new THREE.CapsuleGeometry(0.25, 0.4, 6, 12);
  const ghostGeo = ghostGeometry();

  let signature = '';
  let floorMesh: THREE.InstancedMesh | null = null;
  let floorKeys: string[] = [];
  let legacyMeshes: Array<{ mesh: THREE.Mesh; cellKey: string }> = [];
  let doorMeshes: Array<{ id: string; mesh: THREE.Mesh }> = [];
  let baseFloor = new THREE.Color(0x2b2f3a);
  let wornFloor = new THREE.Color(0x786b4d);
  const disposables: Array<{ dispose: () => void }> = [];
  const tmp = new THREE.Matrix4();
  const tmpColor = new THREE.Color();

  const selectable = new Map<string, THREE.Mesh>();
  let hover: string | null = null;
  let selected: string | null = null;

  const clearStatic = () => {
    for (const d of doorMeshes) selectable.delete(d.id);
    doorMeshes = [];
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
    const doors: Array<[number, number, string | undefined]> = [];

    for (const [cellKey, cell] of Object.entries(w.cells)) {
      const [xs, ys] = cellKey.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (cell.kind === 'wall') walls.push([x, y]);
      else if (cell.kind === 'door') doors.push([x, y, cell.targetRoomId]);
      else {
        floors.push([x, y, cellKey]);
        if (cell.kind === 'object') objects.push([x, y, cellKey]);
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

    const geoDoor = new THREE.BoxGeometry(TILE, WALL_H, TILE * 0.45);
    for (const [x, y, targetRoomId] of doors) {
      const matDoor = new THREE.MeshLambertMaterial({ color: 0x5ac4ff, emissive: 0x1b5a7a });
      const m = new THREE.Mesh(geoDoor, matDoor);
      m.position.set(x + 0.5, WALL_H / 2, y + 0.5);
      m.castShadow = true;
      const doorId = `door:${targetRoomId ?? 'lobby'}`;
      m.userData.targetId = doorId;
      m.userData.doorTarget = targetRoomId ?? 'lobby';
      m.userData.doorPos = { x, y };
      staticGroup.add(m);
      selectable.set(doorId, m);
      doorMeshes.push({ id: doorId, mesh: m });
      disposables.push(matDoor);
    }

    const geoLegacy = new THREE.BoxGeometry(TILE * 0.6, TILE * 0.6, TILE * 0.6);
    for (const [x, y, k] of objects) {
      const m = new THREE.Mesh(geoLegacy, matObject);
      m.position.set(x + 0.5, TILE * 0.3, y + 0.5);
      m.castShadow = true;
      staticGroup.add(m);
      legacyMeshes.push({ mesh: m, cellKey: k });
    }
    disposables.push(geoFloor, matFloor, geoWall, matWall, geoDoor, geoLegacy, floorMesh, wallMesh);
  };

  type Avatar = { mesh: THREE.Mesh; target: THREE.Vector3; ghost: boolean; phase: number };
  const avatars = new Map<string, Avatar>();
  const entities = new Map<string, THREE.Mesh>();
  let hideSelf = false;
  let time = 0;
  let floorTick = 0;

  // ───────────── trails de movimiento (huellas digitales) ─────────────
  const TRAIL_MAX = 12;
  const TRAIL_Y = 0.03;
  type TrailState = { mesh: THREE.InstancedMesh; color: THREE.Color };
  const trails = new Map<string, TrailState>();
  const trailGeo = new THREE.BoxGeometry(0.42, 0.03, 0.42);
  const tmpTrail = new THREE.Vector3();
  const tmpTrailMatrix = new THREE.Matrix4();
  const tmpTrailColor = new THREE.Color();

  const trailColor = (authorId: string) => {
    tmpTrailColor.set(authorId === localId ? 0x9b7bff : 0x6fc3ff);
    return tmpTrailColor;
  };

  /** Puntos de la huella (células transitadas) de un autor, de más reciente a más lejana. */
  const trailPointsFor = (w: World, authorId: string): THREE.Vector3[] => {
    const moves: EventPointer[] = [];
    for (const idx of w.entityHistory[`player:${authorId}`] ?? []) {
      const pointer = w.eventRefs[idx];
      if (pointer && pointer.type === 'MOVE' && pointer.toCell) moves.push(pointer);
    }
    const last = moves.slice(-TRAIL_MAX);
    const out: THREE.Vector3[] = [];
    for (const pointer of last) {
      const sep = pointer.toCell.indexOf(',');
      const x = Number(pointer.toCell.slice(0, sep));
      const y = Number(pointer.toCell.slice(sep + 1));
      const p = tmpTrail.set(x + 0.5, TRAIL_Y, y + 0.5);
      const prev = out[out.length - 1];
      if (!prev || prev.distanceToSquared(p) > 1e-6) out.push(p);
    }
    return out;
  };

  const removeTrail = (authorId: string) => {
    const t = trails.get(authorId);
    if (!t) return;
    trailGroup.remove(t.mesh);
    t.mesh.geometry.dispose();
    (t.mesh.material as THREE.Material).dispose();
    trails.delete(authorId);
  };

  const updateTrail = (authorId: string, points: THREE.Vector3[]) => {
    if (points.length < 2) {
      removeTrail(authorId);
      return;
    }
    let t = trails.get(authorId);
    if (!t) {
      const color = trailColor(authorId);
      const mesh = new THREE.InstancedMesh(trailGeo, new THREE.MeshLambertMaterial({ color: color.clone(), transparent: true, opacity: 0.55 }), TRAIL_MAX);
      mesh.visible = true;
      mesh.instanceColor = new THREE.Color();
      for (let i = 0; i < TRAIL_MAX; i += 1) mesh.setColorAt(i, color);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      trailGroup.add(mesh);
      t = { mesh, color };
      trails.set(authorId, t);
    }
    const count = Math.min(points.length, TRAIL_MAX);
    for (let i = 0; i < TRAIL_MAX; i += 1) {
      if (i < count) {
        tmpTrailMatrix.makeTranslation(points[i].x, points[i].y, points[i].z);
      } else {
        tmpTrailMatrix.makeTranslation(1e4, -1e3, 1e4);
      }
      t.mesh.setMatrixAt(i, tmpTrailMatrix);
    }
    t.mesh.instanceMatrix.needsUpdate = true;
    if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true;
  };

  const colorFor = (id: string) =>
    id === localId
      ? new THREE.Color(0x9b7bff)
      : new THREE.Color().setHSL((parseInt(id.slice(0, 6), 16) % 360) / 360, 0.6, 0.6);

  const update = (w: World, dt: number, pres: Presence) => {
    time += dt;
    if (sigOf(w) !== signature) buildStatic(w);

    for (const d of doorMeshes) {
      const mat = d.mesh.material as THREE.MeshLambertMaterial;
      mat.emissive.setHex(hover === d.id ? 0x3898c8 : 0x1b5a7a);
    }

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

    const liveIds = new Set<string>();
    for (const [id, pl] of Object.entries(w.players)) {
      liveIds.add(id);
      const state = presenceState(id, pres.selfId, pres.online, pl.hlc.t, pres.now);
      let a = avatars.get(id);
      if (!a) {
        const mesh = new THREE.Mesh(avatarGeo, new THREE.MeshLambertMaterial({ color: colorFor(id) }));
        mesh.position.set(pl.x + 0.5, 0.55, pl.y + 0.5);
        mesh.castShadow = true;
        mesh.userData.targetId = `player:${id}`;
        scene.add(mesh);
        selectable.set(`player:${id}`, mesh);
        a = { mesh, target: mesh.position.clone(), ghost: false, phase: (parseInt(id.slice(0, 4), 16) % 60) / 10 };
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
      updateTrail(id, trailPointsFor(w, id));
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
    for (const id of [...trails.keys()]) {
      if (!liveIds.has(id)) removeTrail(id);
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
      for (const t of trails.values()) {
        trailGroup.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
      }
      trails.clear();
      trailGeo.dispose();
      scene.remove(staticGroup, entityGroup, trailGroup);
    },
  };
}