import { knownObject } from '../core/object-registry';
import { drawObjectPreview } from '../experiences/social/render';

// Miniaturas de objetos: se dibujan una vez desde sus propios voxeles (nada de emojis) y se guardan como imagen.

const cache = new Map<string, string>();

export function objectThumb(kind: string, px = 56): string | null {
  const key = `${kind}@${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const k = knownObject(kind);
  if (!k) return null;
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = px * dpr;
  c.height = px * dpr;
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(dpr, dpr);
  drawObjectPreview(g, px, px, { w: k.compiled.size.x, d: k.compiled.size.y, h: k.compiled.size.z, parts: k.compiled.parts }, 0, null, { plain: true });
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** Tras cambiar los ajustes gráficos (contornos) hay que dibujarlas de nuevo. */
export const clearThumbs = (): void => cache.clear();
