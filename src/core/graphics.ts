// Ajustes gráficos: los decide cada cliente y no afectan a la simulación (lo visual no entra en ningún hash).
// Un nivel de calidad (auto/baja/media/alta) fija valores por defecto; escala de render y contornos se pueden forzar aparte.

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Tier = Exclude<Quality, 'auto'>;
/** 0 = según la calidad; si no, porcentaje de la resolución nativa */
export type RenderScale = 0 | 100 | 85 | 70;
export type Toggle3 = 'preset' | 'on' | 'off';

export type GraphicsPrefs = { quality: Quality; renderScale: RenderScale; outlines: Toggle3 };
export const DEFAULT_PREFS: GraphicsPrefs = { quality: 'auto', renderScale: 0, outlines: 'preset' };

export type Env = { dpr: number; cores: number; memoryGb: number; coarse: boolean; width: number };
export type Resolved = { tier: Tier; scale: number; pixelRatio: number; outlines: boolean };

const PRESETS: Record<Tier, { scale: number; dprCap: number; outlines: boolean }> = {
  low: { scale: 70, dprCap: 1.5, outlines: false },
  medium: { scale: 85, dprCap: 2, outlines: false },
  high: { scale: 100, dprCap: 2, outlines: true },
};

/** Calidad sugerida según el dispositivo. Sin datos fiables, un móvil empieza en media. */
export function detectTier(env: Env): Tier {
  const small = env.coarse && env.width <= 900;
  if (env.memoryGb > 0 && env.memoryGb <= 2) return 'low';
  if (env.cores > 0 && env.cores <= 4 && small) return 'low';
  if (!small && env.cores >= 8 && (env.memoryGb === 0 || env.memoryGb >= 8)) return 'high';
  if (small) return 'medium';
  return env.cores >= 6 ? 'high' : 'medium';
}

export function resolveGraphics(p: GraphicsPrefs, env: Env): Resolved {
  const tier: Tier = p.quality === 'auto' ? detectTier(env) : p.quality;
  const preset = PRESETS[tier];
  const scale = p.renderScale === 0 ? preset.scale : p.renderScale;
  const outlines = p.outlines === 'preset' ? preset.outlines : p.outlines === 'on';
  const pixelRatio = Math.max(0.5, Math.min(env.dpr, preset.dprCap) * (scale / 100));
  return { tier, scale, pixelRatio, outlines };
}

// ───────────── estado del cliente (navegador) ─────────────

const KEY = 'tms.settings'; // el mismo almacén que usa la sala 3D

export function readEnv(): Env {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let coarse = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    /* sin matchMedia */
  }
  return {
    dpr: window.devicePixelRatio || 1,
    cores: nav.hardwareConcurrency || 0,
    memoryGb: nav.deviceMemory ?? 0,
    coarse,
    width: window.innerWidth,
  };
}

export function readPrefs(): GraphicsPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<GraphicsPrefs>;
    const q = raw.quality;
    const s = raw.renderScale;
    const o = raw.outlines;
    return {
      quality: q === 'low' || q === 'medium' || q === 'high' ? q : 'auto',
      renderScale: s === 100 || s === 85 || s === 70 ? s : 0,
      outlines: o === 'on' || o === 'off' ? o : 'preset',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let cache: Resolved | null = null;
/** Valores efectivos para este cliente (se calculan una vez y se renuevan con refreshGraphics). */
export const getGraphics = (): Resolved => (cache ??= resolveGraphics(readPrefs(), readEnv()));

/** Llamar tras cambiar los ajustes: recalcula y avisa a los lienzos para que se redimensionen. */
export function refreshGraphics(): Resolved {
  cache = resolveGraphics(readPrefs(), readEnv());
  window.dispatchEvent(new Event('tms:graphics'));
  return cache;
}

export const GRAPHICS_EVENT = 'tms:graphics';
