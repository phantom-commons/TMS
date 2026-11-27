import * as THREE from 'three';
import { hash2, seedOf } from '../sim/space/noise';
import type { Ship } from '../sim/space/ship';
import { DEFAULT_PARAMS, type ShipParams } from '../sim/space/ship-params';

// Nave como malla de pocos polígonos (sombreado plano), generada en código desde la semilla y el estado de los módulos.
// Mismo tamaño que la huella de colisión (9×5 celdas; morro hacia -x): la colisión sigue saliendo de HULL_MASK, nunca de la malla.
// Cada pieza es un nodo con nombre (Casco, Ala_N, Cabina…): al exportar a GLB esos nombres sirven para cambiar piezas o
// materiales en tiempo de ejecución según el estado de la nave.

const flat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

const named = <T extends THREE.Object3D>(o: T, name: string): T => {
  o.name = name;
  return o;
};

function wingShape(span: number, rootBack: number): THREE.Shape {
  const sh = new THREE.Shape();
  sh.moveTo(3.0, 0.8);
  sh.lineTo(rootBack, 0.8);
  sh.lineTo(rootBack + 0.9, 0.8 + span);
  sh.lineTo(rootBack - 0.2, 0.8 + span);
  sh.lineTo(3.7, 1.5);
  sh.closePath();
  return sh;
}

export function buildShipMesh(ship: Ship, params: ShipParams = DEFAULT_PARAMS): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Nave';
  const m = ship.modules;
  const s = seedOf(ship.seed, 'mesh');
  const accent = new THREE.Color().setHSL((params.hue ?? hash2(s, 1, 1) % 360) / 360, 0.62, 0.5).getStyle();
  const hullCol = m.casco ? '#cfd5de' : '#8d9099';
  const hullMat = flat(hullCol);
  const accentMat = flat(accent);

  // fuselaje: sólido de revolución con morro afilado y cola recta
  const profile = [[0, 0], [0.38, 0.55], [0.9, 1.5], [1.2, 2.9], [1.26, 5.6], [1.12, 7.5], [0.92, 8.5], [0.0, 8.6]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(profile, params.sides);
  body.rotateZ(-Math.PI / 2);
  const fus = named(new THREE.Mesh(body, hullMat), 'Casco');
  fus.scale.set(1.04, 0.82 * params.radius, 1.05 * params.radius);
  fus.position.set(0, 1.35, 2.5);
  g.add(fus);
  // franja de color
  const band = new THREE.LatheGeometry([new THREE.Vector2(1.22, 3.1), new THREE.Vector2(1.24, 3.55)], params.sides);
  band.rotateZ(-Math.PI / 2);
  const bm = named(new THREE.Mesh(band, accentMat), 'Franja');
  bm.scale.copy(fus.scale);
  bm.position.copy(fus.position);
  g.add(bm);

  // alas planas; con el casco roto la del sur está más corta y caída
  for (const side of [1, -1] as const) {
    const broken = !m.casco && side === -1;
    const geo = new THREE.ExtrudeGeometry(wingShape(broken ? params.wingSpan * 0.6 : params.wingSpan, 6.0), { depth: 0.16, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const w = named(new THREE.Mesh(geo, side === 1 ? hullMat : flat(hullCol)), side === 1 ? 'Ala_N' : 'Ala_S');
    w.position.set(0, 1.0 + (broken ? -0.15 : 0), 2.5);
    w.scale.z = side;
    if (broken) w.rotation.x = side * 0.14;
    g.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.18), accentMat);
    tip.name = side === 1 ? 'PuntaAla_N' : 'PuntaAla_S';
    tip.position.set(6.45, 1.0, 2.5 + side * ((broken ? params.wingSpan * 0.6 : params.wingSpan) + 0.75));
    g.add(tip);
  }

  // cabina de cristal: se apaga sin energía
  const cabin = named(
    new THREE.Mesh(new THREE.SphereGeometry(0.75, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), m.energia ? flat('#7fe3ee', { emissive: new THREE.Color('#2a8fa0') }) : flat('#2a2d33')),
    'Cabina',
  );
  cabin.scale.set(1.5 * params.cabin, 0.95 * params.cabin, 0.95 * params.cabin);
  cabin.position.set(2.5, 1.75, 2.5);
  g.add(cabin);

  // aleta de cola y antena
  const fin = named(new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 0.16), accentMat), 'Aleta');
  fin.position.set(7.3, 2.35, 2.5);
  fin.rotation.z = 0.35;
  g.add(fin);
  const ant = named(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, m.comunicaciones ? 1.2 : 0.4, 5), flat('#d9dde4')), 'Antena');
  ant.position.set(7.7, m.comunicaciones ? 3.55 : 3.0, 2.5);
  if (!m.comunicaciones) ant.rotation.z = 0.9;
  g.add(ant);

  // toberas: encendidas con llama si hay motor; apagadas y a medias si no
  for (const z of [1.8, 3.2]) {
    const n = named(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.95, 8), m.motor ? flat('#e0a23a', { emissive: new THREE.Color('#8a4a10') }) : flat('#33323a')), z < 2.5 ? 'Tobera_N' : 'Tobera_S');
    n.rotation.z = Math.PI / 2;
    n.position.set(9.0, 1.25, z);
    g.add(n);
    if (m.motor) {
      const f = named(new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 6), new THREE.MeshBasicMaterial({ color: '#ffb347' })), z < 2.5 ? 'Llama_N' : 'Llama_S');
      f.rotation.z = -Math.PI / 2;
      f.position.set(9.95, 1.25, z);
      g.add(f);
    }
  }

  // casco roto: manchas de quemadura sobre el fuselaje
  if (!m.casco) {
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8 + (hash2(s, i, 2) % 5) / 10, 0.06, 0.6), flat('#2d2c33'));
      p.name = `Quemadura_${i}`;
      p.position.set(3.6 + i * 1.2, 2.2 - (i % 2) * 0.05, 2.5 + ((hash2(s, i, 3) % 7) - 3) / 6);
      p.rotation.y = (hash2(s, i, 4) % 10) / 10;
      g.add(p);
    }
  }
  return g;
}

export const disposeShipMesh = (g: THREE.Object3D): void => {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
};
