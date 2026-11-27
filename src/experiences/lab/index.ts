import * as THREE from 'three';
import type { ExperienceFactory } from '../../core/experience-registry';
import { exportGlb } from '../../render/export-glb';
import { buildShipMesh, disposeShipMesh } from '../../render/ship-mesh';
import { CHUNK } from '../../sim/space/chunk';
import { cellColor, LENSES, thingColor, type Lens } from '../../sim/space/lens';
import { hash2, seedOf } from '../../sim/space/noise';
import { MODULE_IDS, MODULES, newShip, type ModuleId } from '../../sim/space/ship';
import { cleanParams, DEFAULT_PARAMS, loadParams, PARAM_RANGES, paramsFromSeed, paramsFromText, paramsToText, saveParams, type ShipParams } from '../../sim/space/ship-params';
import { privateStarSeed } from '../../sim/space/spaces';
import { openSpace } from '../../sim/space/world';

// Lab: página dentro del juego para modelar (parámetros de la nave), probar (daño por módulo), ver datos
// (triángulos, nodos) y previsualizar la generación del mundo con una semilla y una lente. Todo son datos puros
// de src/sim/space; aquí solo hay controles y dibujo. La colisión no sale de nada de esto.

const SLIDERS: Array<[keyof typeof PARAM_RANGES, string]> = [
  ['radius', 'Grosor'],
  ['wingSpan', 'Alas'],
  ['cabin', 'Cabina'],
  ['finHeight', 'Aleta'],
  ['sides', 'Lados'],
];

export const mountLab: ExperienceFactory = (ctx) => {
  const root = ctx.root;
  root.classList.add('lab-root');
  let params: ShipParams = loadParams(ctx.kv);
  let seed = privateStarSeed(ctx.author);
  const mods: Record<ModuleId, boolean> = { casco: true, energia: true, motor: true, comunicaciones: true };
  let lens: Lens = 'normal';
  let yaw = -0.6;
  let pitch = 0.35;
  let dist = 15;

  root.innerHTML = `
    <header class="lab-top"><button class="gf-icon lab-back" type="button" aria-label="Volver al menú">←</button><b>Lab</b><span class="lab-sp"></span><button type="button" class="lab-glb">Exportar .glb</button></header>
    <div class="lab-view"><canvas class="lab-3d"></canvas><span class="lab-stats"></span></div>
    <div class="lab-panel">
      <h2>Forma</h2><div class="lab-sliders"></div>
      <div class="lab-row"><label>Tono <input type="range" class="lab-hue" min="0" max="359" step="1" /></label><button type="button" class="lab-hueauto">Auto</button></div>
      <div class="lab-row"><button type="button" class="lab-var">Variante de la semilla</button><button type="button" class="lab-reset">Restablecer</button><button type="button" class="lab-save">Guardar</button></div>
      <h2>Daño (prueba)</h2><div class="lab-mods"></div>
      <h2>Receta</h2><textarea class="lab-recipe" rows="3" spellcheck="false"></textarea>
      <div class="lab-row"><button type="button" class="lab-copy">Copiar</button><button type="button" class="lab-apply">Aplicar texto</button></div>
      <h2>Mundo</h2>
      <div class="lab-row"><input class="lab-seed" spellcheck="false" autocomplete="off" /><button type="button" class="lab-myseed">Mía</button></div>
      <div class="lab-row lab-lenses"></div>
      <canvas class="lab-map" width="192" height="192"></canvas>
      <p class="hint lab-msg"></p>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  // --- 3D ---
  const canvas = $<HTMLCanvasElement>('.lab-3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#12151c');
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3326', 1.4));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(6, 12, 8);
  scene.add(sun);
  const grid = new THREE.GridHelper(20, 20, '#2b3140', '#1f2430');
  scene.add(grid);
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  let mesh: THREE.Group | null = null;
  const center = new THREE.Vector3(4.5, 1.4, 2.5);

  const rebuild = () => {
    if (mesh) {
      scene.remove(mesh);
      disposeShipMesh(mesh);
    }
    const ship = { ...newShip(seed), modules: { ...mods } };
    mesh = buildShipMesh(ship, params);
    scene.add(mesh);
    let tris = 0;
    const names: string[] = [];
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
        names.push(m.name);
      }
    });
    $('.lab-stats').textContent = `${Math.round(tris)} triángulos · ${names.length} nodos: ${names.join(', ')}`;
    $<HTMLTextAreaElement>('.lab-recipe').value = paramsToText(params);
  };

  const place = () => {
    cam.position.set(center.x + Math.cos(yaw) * Math.cos(pitch) * dist, center.y + Math.sin(pitch) * dist, center.z + Math.sin(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(center);
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(r.width, r.height, false);
    cam.aspect = r.width / Math.max(1, r.height);
    cam.updateProjectionMatrix();
  };
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    place();
    renderer.render(scene, cam);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.01;
    pitch = Math.max(-0.2, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dist = Math.max(8, Math.min(50, dist + e.deltaY * 0.02));
  }, { passive: false });

  // --- controles ---
  const sliders = $('.lab-sliders');
  const inputs = new Map<string, HTMLInputElement>();
  for (const [k, label] of SLIDERS) {
    const r = PARAM_RANGES[k];
    const row = document.createElement('label');
    row.className = 'lab-sl';
    const t = document.createElement('span');
    t.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(r.min);
    inp.max = String(r.max);
    inp.step = String(r.step);
    inp.addEventListener('input', () => {
      params = cleanParams({ ...params, [k]: Number(inp.value) });
      rebuild();
    });
    inputs.set(k, inp);
    row.append(t, inp);
    sliders.append(row);
  }
  const syncInputs = () => {
    for (const [k] of SLIDERS) inputs.get(k)!.value = String(params[k]);
    $<HTMLInputElement>('.lab-hue').value = String(params.hue ?? hash2(seedOf(seed, 'mesh'), 1, 1) % 360);
  };
  const apply = (p: ShipParams) => {
    params = p;
    syncInputs();
    rebuild();
  };
  $<HTMLInputElement>('.lab-hue').addEventListener('input', (e) => {
    params = cleanParams({ ...params, hue: Number((e.target as HTMLInputElement).value) });
    rebuild();
  });
  $('.lab-hueauto').onclick = () => apply(cleanParams({ ...params, hue: null }));
  $('.lab-reset').onclick = () => apply(DEFAULT_PARAMS);
  $('.lab-var').onclick = () => apply(paramsFromSeed((a) => hash2(seedOf(seed, 'params'), a, 7)));
  $('.lab-save').onclick = () => {
    saveParams(ctx.kv, params);
    ctx.toast('Forma guardada: se ve en Tu estrella');
  };
  for (const m of MODULE_IDS) {
    const l = document.createElement('label');
    l.className = 'lab-chk';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = true;
    c.onchange = () => {
      mods[m] = c.checked;
      rebuild();
    };
    l.append(c, ` ${MODULES[m].name}`);
    $('.lab-mods').append(l);
  }
  $('.lab-copy').onclick = () => void navigator.clipboard?.writeText(paramsToText(params)).then(() => ctx.toast('Receta copiada'), () => ctx.toast('No se pudo copiar'));
  $('.lab-apply').onclick = () => {
    const p = paramsFromText($<HTMLTextAreaElement>('.lab-recipe').value);
    if (!p) return void ($('.lab-msg').textContent = 'Receta no válida.');
    $('.lab-msg').textContent = '';
    apply(p);
  };
  $('.lab-glb').onclick = async () => {
    if (!mesh) return;
    const buf = await exportGlb(mesh);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    a.download = 'nave-lab.glb';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('.lab-back').onclick = () => ctx.exit();

  // --- mapa de chunks 3×3 con lente ---
  const map = $<HTMLCanvasElement>('.lab-map');
  const drawMap = () => {
    const g = map.getContext('2d')!;
    const sp = openSpace(seed);
    const n = CHUNK * 3;
    const px = map.width / n;
    for (let cy = -1; cy <= 1; cy++)
      for (let cx = -1; cx <= 1; cx++) {
        const c = sp.chunk(cx, cy);
        for (let ly = 0; ly < CHUNK; ly++)
          for (let lx = 0; lx < CHUNK; lx++) {
            g.fillStyle = cellColor(lens, c, lx, ly);
            g.fillRect(((cx + 1) * CHUNK + lx) * px, ((cy + 1) * CHUNK + ly) * px, px + 0.5, px + 0.5);
          }
        if (lens !== 'puntos')
          for (const t of c.things) {
            g.fillStyle = thingColor(t.kind);
            g.fillRect(((cx + 1) * CHUNK + (t.x - cx * CHUNK)) * px, ((cy + 1) * CHUNK + (t.y - cy * CHUNK)) * px, px + 1, px + 1);
          }
      }
  };
  for (const l of LENSES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l;
    b.onclick = () => {
      lens = l;
      drawMap();
    };
    $('.lab-lenses').append(b);
  }
  const seedIn = $<HTMLInputElement>('.lab-seed');
  seedIn.value = seed;
  const setSeed = (s: string) => {
    seed = s.trim() || seed;
    seedIn.value = seed;
    syncInputs();
    rebuild();
    drawMap();
  };
  seedIn.addEventListener('change', () => setSeed(seedIn.value));
  $('.lab-myseed').onclick = () => setSeed(privateStarSeed(ctx.author));

  syncInputs();
  rebuild();
  drawMap();
  resize();
  loop();
  (window as unknown as { __lab?: unknown }).__lab = { get params() { return params; }, apply, setSeed, mods, rebuild };

  return {
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (mesh) disposeShipMesh(mesh);
      renderer.dispose();
      root.classList.remove('lab-root');
      root.innerHTML = '';
    },
  };
};
