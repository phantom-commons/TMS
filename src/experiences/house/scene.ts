import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { knownObject } from '../../core/object-registry';
import { VPC } from '../../core/objects';
import type { HousePalette } from '../../sim/house/procedural';
import type { HouseState, Rot } from '../../sim/house/state';
import { WALL_CELLS } from '../../sim/house/state';

// Renderer 3D de la casa: lee la sim (HouseState) y la dibuja. No decide nada de juego: solo geometría, luces y cámara.
// Unidades de Three: 1 = una casilla (≈1 m). x este, z sur (= y de la sim), y arriba.

export type CamKind = 'fps' | 'third' | 'iso' | 'top';
export const EYE_HEIGHT = 1.6;
export const AVATAR_HEIGHT = 1.75;

export type HouseScene = {
  /** reconcilia los objetos dibujados con la sim (solo toca lo que cambió) */
  syncObjects: (s: HouseState) => void;
  setPlayer: (x: number, z: number, yaw: number, visible: boolean) => void;
  /** marca la escotilla de la nave en la celda (x, z) de la pared sur */
  setHatch: (x: number, z: number) => void;
  setCamera: (kind: CamKind, yaw: number, pitch: number, px: number, pz: number) => void;
  /** cambia los colores de la habitación (paredes, suelo, fondo) sin recrear nada */
  setPalette: (p: HousePalette) => void;
  setSelected: (id: number | null) => void;
  /** qué hay bajo un punto de la pantalla: un objeto de la casa y/o un punto del suelo (en casillas) */
  pick: (clientX: number, clientY: number) => { objectId: number | null; floor: { x: number; z: number } | null };
  resize: () => void;
  render: () => void;
  dispose: () => void;
};

const colorCache = new Map<string, THREE.Color>();
const colorOf = (hex: string) => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
};

/** Geometría de un objeto: sus cajas fusionadas con color por vértice, centrada en su huella (para girar sobre sí mismo). */
function buildObjectGeometry(kind: string): { geo: THREE.BufferGeometry; w: number; d: number } | null {
  const k = knownObject(kind);
  if (!k) return null;
  const w = k.obj.sx / VPC;
  const d = k.obj.sy / VPC;
  const pieces = k.compiled.parts.map((p) => {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    g.translate(p.dx + p.w / 2 - w / 2, p.dz + p.h / 2, p.dy + p.d / 2 - d / 2);
    const c = colorOf(p.color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  });
  if (pieces.length === 0) return null;
  const geo = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return geo ? { geo, w, d } : null;
}

export function createHouseScene(canvas: HTMLCanvasElement, state: HouseState, palette: HousePalette, pixelRatio: () => number): HouseScene {
  const W = state.w;
  const D = state.d;
  const scene = new THREE.Scene();
  scene.background = colorOf(palette.dark).clone().multiplyScalar(0.8);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(pixelRatio());

  // ───────────── luz ─────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const hemi = new THREE.HemisphereLight(colorOf(palette.light), colorOf(palette.floor), 0.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(W * 0.3, 8, D * 1.4);
  scene.add(sun);

  // ───────────── habitación ─────────────
  const mat = (hex: string) => new THREE.MeshLambertMaterial({ color: colorOf(hex), side: THREE.FrontSide });
  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => (disposables.push(x), x);

  // suelo en damero: una textura de 1 píxel por casilla, sin suavizado
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = W;
  floorCanvas.height = D;
  const paintFloor = (p: HousePalette) => {
    const g = floorCanvas.getContext('2d');
    if (!g) return;
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < W; x++) {
        g.fillStyle = (x + y) % 2 ? p.floorAlt : p.floor;
        g.fillRect(x, y, 1, 1);
      }
    }
  };
  paintFloor(palette);
  const tex = (() => {
    const t = new THREE.CanvasTexture(floorCanvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), keep(new THREE.MeshLambertMaterial({ map: tex })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, D / 2);
  scene.add(floor);

  // paredes y techo con una sola cara visible (la de dentro): vistas desde fuera no estorban en isométrica/cenital
  const wallMat = keep(mat(palette.wall));
  const trimMat = keep(mat(palette.wallTrim));
  const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry: number, rx = 0) => {
    const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    scene.add(mesh);
    return mesh;
  };
  const H = WALL_CELLS;
  plane(W, H, wallMat, W / 2, H / 2, 0, 0); // norte (mira al sur)
  plane(W, H, wallMat, W / 2, H / 2, D, Math.PI); // sur (mira al norte)
  plane(D, H, wallMat, 0, H / 2, D / 2, Math.PI / 2); // oeste (mira al este)
  plane(D, H, wallMat, W, H / 2, D / 2, -Math.PI / 2); // este (mira al oeste)
  const ceilMat = keep(new THREE.MeshBasicMaterial({ color: colorOf(palette.wallTrim) }));
  plane(W, D, ceilMat, W / 2, H, D / 2, 0, Math.PI / 2); // techo (mira abajo)
  // rodapié: una franja baja en cada pared
  const bt = 0.12;
  plane(W, bt, trimMat, W / 2, bt / 2, 0.005, 0);
  plane(W, bt, trimMat, W / 2, bt / 2, D - 0.005, Math.PI);
  plane(D, bt, trimMat, 0.005, bt / 2, D / 2, Math.PI / 2);
  plane(D, bt, trimMat, W - 0.005, bt / 2, D / 2, -Math.PI / 2);

  // ───────────── objetos ─────────────
  const objMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const geoCache = new Map<string, { geo: THREE.BufferGeometry; w: number; d: number } | null>();
  const geoFor = (kind: string) => {
    if (!geoCache.has(kind)) geoCache.set(kind, buildObjectGeometry(kind));
    return geoCache.get(kind) ?? null;
  };
  const meshes = new Map<number, { mesh: THREE.Mesh; sig: string }>();
  const group = new THREE.Group();
  scene.add(group);

  const place = (mesh: THREE.Mesh, x: number, y: number, rot: Rot, w: number, d: number) => {
    const swap = rot % 2 === 1;
    const fw = swap ? d : w;
    const fd = swap ? w : d;
    mesh.position.set(x / VPC + fw / 2, 0, y / VPC + fd / 2);
    mesh.rotation.y = (-rot * Math.PI) / 2;
  };

  const syncObjects = (s: HouseState) => {
    const alive = new Set<number>();
    for (const o of s.objects) {
      alive.add(o.id);
      const sig = `${o.kind}|${o.x}|${o.y}|${o.rot}`;
      const have = meshes.get(o.id);
      if (have && have.sig === sig) continue;
      const g = geoFor(o.kind);
      if (!g) continue;
      if (have) {
        place(have.mesh, o.x, o.y, o.rot, g.w, g.d);
        have.sig = sig;
        continue;
      }
      const mesh = new THREE.Mesh(g.geo, objMat);
      mesh.userData.id = o.id;
      place(mesh, o.x, o.y, o.rot, g.w, g.d);
      group.add(mesh);
      meshes.set(o.id, { mesh, sig });
    }
    for (const [id, m] of meshes) {
      if (!alive.has(id)) {
        group.remove(m.mesh);
        meshes.delete(id);
      }
    }
  };

  // selección: un contorno de caja alrededor del objeto
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffff }));
  outline.visible = false;
  scene.add(outline);
  keep(outline.geometry);
  let selected: number | null = null;
  const refreshOutline = () => {
    const m = selected == null ? null : meshes.get(selected)?.mesh;
    if (!m) {
      outline.visible = false;
      return;
    }
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3()).addScalar(0.04);
    outline.scale.copy(size);
    outline.position.copy(box.getCenter(new THREE.Vector3()));
    outline.visible = true;
  };

  // ───────────── jugador ─────────────
  const avatar = new THREE.Group();
  {
    const skin = keep(mat('#f2c9a0'));
    const shirt = keep(mat(palette.accent));
    const pants = keep(mat(palette.dark));
    const part = (w: number, h: number, d: number, m: THREE.Material, y: number, x = 0) => {
      const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m);
      mesh.position.set(x, y, 0);
      avatar.add(mesh);
    };
    part(0.16, 0.8, 0.2, pants, 0.4, -0.1);
    part(0.16, 0.8, 0.2, pants, 0.4, 0.1);
    part(0.46, 0.55, 0.26, shirt, 1.08);
    part(0.3, 0.3, 0.3, skin, 1.58);
  }
  avatar.visible = false;
  scene.add(avatar);

  // ───────────── cámaras ─────────────
  const persp = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  let cam: THREE.Camera = persp;
  let camKind: CamKind = 'fps';
  const cx = W / 2;
  const cz = D / 2;

  const layout = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    const span = Math.max(W, D) * (camKind === 'iso' ? 1.25 : 1.15);
    const vh = aspect < 1 ? span / aspect : span; // en vertical se ajusta al ancho
    ortho.left = (-vh * aspect) / 2;
    ortho.right = (vh * aspect) / 2;
    ortho.top = vh / 2;
    ortho.bottom = -vh / 2;
    ortho.updateProjectionMatrix();
  };

  const setCamera = (kind: CamKind, yaw: number, pitch: number, px: number, pz: number) => {
    if (kind !== camKind) {
      camKind = kind;
      layout();
    }
    const dx = Math.sin(yaw) * Math.cos(pitch);
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * Math.cos(pitch);
    if (kind === 'fps') {
      persp.position.set(px, EYE_HEIGHT, pz);
      persp.lookAt(px + dx, EYE_HEIGHT + dy, pz + dz);
      cam = persp;
    } else if (kind === 'third') {
      const back = 2.4;
      persp.position.set(px - Math.sin(yaw) * back, 2.0 + Math.max(0, -dy) * 1.2, pz + Math.cos(yaw) * back);
      persp.lookAt(px + Math.sin(yaw) * 1.5, 1.2 + dy * 2, pz - Math.cos(yaw) * 1.5);
      cam = persp;
    } else if (kind === 'iso') {
      ortho.position.set(cx + 16, 15, cz + 16);
      ortho.lookAt(cx, H * 0.3, cz);
      cam = ortho;
    } else {
      ortho.position.set(cx, 40, cz + 0.001);
      ortho.lookAt(cx, 0, cz);
      cam = ortho;
    }
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const pick = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const o = ray.intersectObjects(group.children, false)[0]?.object;
    const objectId = typeof o?.userData.id === 'number' ? (o.userData.id as number) : null;
    const onFloor = ray.ray.intersectPlane(floorPlane, hit) && hit.x >= 0 && hit.z >= 0 && hit.x <= W && hit.z <= D;
    return { objectId, floor: onFloor ? { x: hit.x, z: hit.z } : null };
  };

  layout();
  return {
    syncObjects(s) {
      syncObjects(s);
      refreshOutline();
    },
    setHatch(x, z) {
      const mark = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.9, 0.9)), keep(new THREE.MeshBasicMaterial({ color: '#e0a23a' })));
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(x + 0.5, 0.02, z + 0.5);
      const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(1.1, 2.1, 0.12)), keep(new THREE.MeshLambertMaterial({ color: '#b9bfc9' })));
      frame.position.set(x + 0.5, 1.05, z + 1 - 0.06);
      const glow = new THREE.Mesh(keep(new THREE.BoxGeometry(0.8, 1.8, 0.14)), keep(new THREE.MeshBasicMaterial({ color: '#6fd3e0' })));
      glow.position.set(x + 0.5, 0.95, z + 1 - 0.06);
      scene.add(mark, frame, glow);
    },
    setPlayer(x, z, yaw, visible) {
      avatar.visible = visible;
      avatar.position.set(x, 0, z);
      avatar.rotation.y = -yaw;
    },
    setCamera,
    setPalette(p) {
      scene.background = colorOf(p.dark).clone().multiplyScalar(0.8);
      hemi.color.copy(colorOf(p.light));
      hemi.groundColor.copy(colorOf(p.floor));
      wallMat.color.copy(colorOf(p.wall));
      trimMat.color.copy(colorOf(p.wallTrim));
      ceilMat.color.copy(colorOf(p.wallTrim));
      paintFloor(p);
      tex.needsUpdate = true;
    },
    setSelected(id) {
      selected = id;
      refreshOutline();
    },
    pick,
    resize: layout,
    render: () => renderer.render(scene, cam),
    dispose() {
      for (const g of geoCache.values()) g?.geo.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
