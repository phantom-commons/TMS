import { hashCanonical } from '../sim/hash';

// Objeto voxel: datos puros, sin código. Es la «definición» de un objeto (forma, colores, si bloquea el paso).
// El mundo tiene un voxel fijo: 1 casilla = 8 voxeles por eje. Un objeto mide lo que quiera en voxeles (hasta 16),
// así que una espada puede ser fina y un armario grande sin que la room tenga que cambiar de escala.
// Se identifica por el hash de su contenido: el mismo objeto es el mismo en Tu Room, en el inventario y en el mundo 3D.
// Lo que se posee, se presta o se vende es una unidad concreta de esa definición.

/** voxeles por casilla y eje (constante del mundo) */
export const VPC = 8;
export const MAX_SIDE = 16;
export const MAX_PALETTE = 12;
/** con lados de hasta 16 el tope real lo pone la propia cuadrícula (16³) */
export const MAX_FILLED = MAX_SIDE ** 3;
export const MAX_NAME = 24;

/** Caja en unidades de casilla, relativa a la esquina de la huella del objeto. */
export type BoxPart = { dx: number; dy: number; dz: number; w: number; d: number; h: number; color: string };

export type VoxelObject = {
  v: 2;
  name: string;
  /** tamaño en voxeles (1–16) */
  sx: number;
  sy: number;
  sz: number;
  /** colores '#rrggbb' en minúscula */
  palette: string[];
  /** 0 = vacío, n = palette[n-1]. Orden: x + sx·(y + sy·z) */
  cells: number[];
  /** ¿impide caminar y apilar? */
  solid: boolean;
};

/** Formato anterior (casillas enteras + resolución). Se sigue aceptando: conserva su id y se lee como v2. */
export type VoxelObjectV1 = {
  v: 1;
  name: string;
  icon: string;
  w: 1 | 2;
  d: 1 | 2;
  h: 1 | 2;
  res: 4 | 8;
  palette: string[];
  cells: number[];
  solid: boolean;
};
export type AnyObject = VoxelObject | VoxelObjectV1;

export type ObjectKind = `obj:${string}`;
const KIND_RE = /^obj:[0-9a-f]{24}$/;
export const isObjectKind = (k: string): k is ObjectKind => KIND_RE.test(k);

type Dims = { sx: number; sy: number; sz: number };
export const gridOf = (o: Dims) => ({ nx: o.sx, ny: o.sy, nz: o.sz });
export const cellIndex = (o: Dims, x: number, y: number, z: number): number => x + o.sx * (y + o.sy * z);
/** casillas que ocupa (huella y altura) */
export const footprint = (o: Dims) => ({ w: Math.max(1, Math.ceil(o.sx / VPC)), d: Math.max(1, Math.ceil(o.sy / VPC)), h: Math.max(1, Math.ceil(o.sz / VPC)) });

export function emptyObject(sx = 8, sy = 8, sz = 8): VoxelObject {
  return {
    v: 2,
    name: 'Objeto',
    sx,
    sy,
    sz,
    palette: ['#c9ced9', '#e08a3c', '#6b7fd7', '#3fa66a', '#d9534f', '#f2c9a0', '#2b3040', '#ffd966'],
    cells: new Array<number>(sx * sy * sz).fill(0),
    solid: true,
  };
}

export const filledCount = (o: Pick<VoxelObject, 'cells'>): number => o.cells.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);

/** Lee cualquier versión como v2. En v1 cada voxel pasa a ocupar (8 / res)³ voxeles, así que el tamaño en la room no cambia. */
export function toV2(o: AnyObject): VoxelObject {
  if (o.v === 2) return o;
  const k = VPC / o.res;
  const sx = o.w * o.res * k;
  const sy = o.d * o.res * k;
  const sz = o.h * o.res * k;
  const nx = o.w * o.res;
  const ny = o.d * o.res;
  const cells = new Array<number>(sx * sy * sz).fill(0);
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        cells[x + sx * (y + sy * z)] = o.cells[Math.floor(x / k) + nx * (Math.floor(y / k) + ny * Math.floor(z / k))] ?? 0;
      }
    }
  }
  return { v: 2, name: o.name, sx, sy, sz, palette: o.palette, cells, solid: o.solid };
}

function validateCommon(name: unknown, palette: unknown, cells: unknown, solid: unknown, expected: number): string | null {
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME) return `nombre de 1 a ${MAX_NAME} letras`;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_PALETTE) return `paleta de 1 a ${MAX_PALETTE} colores`;
  if (!palette.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c))) return 'color inválido';
  if (!Array.isArray(cells) || cells.length !== expected) return 'cuadrícula de tamaño incorrecto';
  let filled = 0;
  for (const c of cells) {
    if (!Number.isInteger(c) || c < 0 || c > palette.length) return 'celda fuera de la paleta';
    if (c > 0) filled++;
  }
  if (filled === 0) return 'el objeto está vacío';
  if (typeof solid !== 'boolean') return 'solid inválido';
  return null;
}

/** Mensaje de error, o null si el objeto es válido. Es el único sitio que decide qué es un objeto aceptable. */
export function validateObject(o: AnyObject): string | null {
  if (!o || typeof o !== 'object') return 'objeto inválido';
  if (o.v === 1) {
    if (![1, 2].includes(o.w) || ![1, 2].includes(o.d) || ![1, 2].includes(o.h)) return 'tamaño de 1 a 2 casillas';
    if (o.res !== 4 && o.res !== 8) return 'resolución inválida';
    if (typeof o.icon !== 'string' || o.icon.length === 0 || o.icon.length > 8) return 'icono inválido';
    return validateCommon(o.name, o.palette, o.cells, o.solid, o.w * o.d * o.h * o.res ** 3);
  }
  if (o.v !== 2) return 'versión de objeto desconocida';
  for (const n of [o.sx, o.sy, o.sz]) if (!Number.isInteger(n) || n < 1 || n > MAX_SIDE) return `tamaño de 1 a ${MAX_SIDE} voxeles por lado`;
  return validateCommon(o.name, o.palette, o.cells, o.solid, o.sx * o.sy * o.sz);
}

/** Identidad por contenido: mismo contenido, mismo id, en cualquier dispositivo. */
export const objectId = (o: AnyObject): ObjectKind => `obj:${hashCanonical(o).slice(0, 24)}` as ObjectKind;

export type CompiledObject = {
  /** huella en casillas */
  w: number;
  d: number;
  /** altura en casillas */
  h: number;
  /** tamaño real en casillas (puede ser menor que la huella) */
  size: { x: number; y: number; z: number };
  blocks: boolean;
  parts: BoxPart[];
  /** color predominante (para fichas y miniaturas) */
  color: string;
  filled: number;
};

/**
 * Voxeles → cajas en unidades de casilla. Fusión voraz: se extiende cada voxel libre en x, luego en y y luego en z
 * mientras el color coincida. Las piezas no se solapan y su volumen total es exactamente el de los voxeles llenos.
 */
export function compileObject(src: AnyObject): CompiledObject {
  const o = toV2(src);
  const { nx, ny, nz } = gridOf(o);
  const used = new Uint8Array(o.cells.length);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const parts: BoxPart[] = [];
  const tally = new Map<string, number>();
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const c = o.cells[at(x, y, z)];
        if (c === 0 || used[at(x, y, z)]) continue;
        let lx = 1;
        while (x + lx < nx && o.cells[at(x + lx, y, z)] === c && !used[at(x + lx, y, z)]) lx++;
        const rowOk = (yy: number, zz: number) => {
          for (let i = 0; i < lx; i++) if (o.cells[at(x + i, yy, zz)] !== c || used[at(x + i, yy, zz)]) return false;
          return true;
        };
        let ly = 1;
        while (y + ly < ny && rowOk(y + ly, z)) ly++;
        let lz = 1;
        const layerOk = (zz: number) => {
          for (let j = 0; j < ly; j++) if (!rowOk(y + j, zz)) return false;
          return true;
        };
        while (z + lz < nz && layerOk(z + lz)) lz++;
        for (let k = 0; k < lz; k++) for (let j = 0; j < ly; j++) for (let i = 0; i < lx; i++) used[at(x + i, y + j, z + k)] = 1;
        const color = o.palette[c - 1] as string;
        parts.push({ dx: x / VPC, dy: y / VPC, dz: z / VPC, w: lx / VPC, d: ly / VPC, h: lz / VPC, color });
        tally.set(color, (tally.get(color) ?? 0) + lx * ly * lz);
      }
    }
  }
  // de atrás hacia delante para la vista isométrica; en empate, de abajo hacia arriba
  parts.sort((a, b) => a.dx + a.dy + a.dz - (b.dx + b.dy + b.dz) || a.dz - b.dz);
  let color = o.palette[0] as string;
  let best = -1;
  for (const [c, n] of tally) {
    if (n > best) {
      color = c;
      best = n;
    }
  }
  const fp = footprint(o);
  return { ...fp, size: { x: o.sx / VPC, y: o.sy / VPC, z: o.sz / VPC }, blocks: o.solid, parts, color, filled: filledCount(o) };
}

/** Plantilla para empezar sin lienzo en blanco: una espada de 3×1×9 voxeles (unos 40 cm de ancho y 1,1 m de largo si una casilla es 1 m). */
export function swordTemplate(): VoxelObject {
  const o = emptyObject(3, 1, 9);
  o.name = 'Espada';
  o.solid = false;
  o.palette = ['#c9ced9', '#8a5a2b', '#ffd966', '#e8ecf5', '#6b7fd7', '#2b3040', '#d9534f', '#3fa66a'];
  const set = (x: number, z: number, c: number) => (o.cells[cellIndex(o, x, 0, z)] = c);
  set(1, 0, 3); // pomo dorado
  set(1, 1, 2); // empuñadura
  for (let x = 0; x < 3; x++) set(x, 2, 3); // guarda dorada
  for (let z = 3; z <= 7; z++) set(1, z, z % 2 ? 4 : 1); // hoja
  set(1, 8, 4); // punta
  return o;
}
