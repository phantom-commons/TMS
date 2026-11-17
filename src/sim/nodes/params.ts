// Parámetros con esquema: cada nodo declara qué acepta (tipo, mínimo, máximo, valor por defecto).
// El esquema sirve para tres cosas a la vez: validar (la sim rechaza lo imposible), normalizar (rellena y acota)
// y generar la interfaz de sliders sin escribir una pantalla por nodo.

export type IntParam = { type: 'int'; min: number; max: number; default: number; label: string; unit?: string; step?: number };
export type BoolParam = { type: 'bool'; default: boolean; label: string };
export type EnumParam = { type: 'enum'; options: readonly string[]; default: string; label: string };
/** referencia a un prefab del manifiesto (se comprueba al validar el manifiesto, no aquí) */
export type RefParam = { type: 'ref'; default: string; label: string };

export type ParamDef = IntParam | BoolParam | EnumParam | RefParam;
export type ParamSchema = Record<string, ParamDef>;
export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

export const defaultsOf = (schema: ParamSchema): ParamValues =>
  Object.fromEntries(Object.entries(schema).map(([k, d]) => [k, d.default]));

/** Devuelve el primer problema, o null si los valores son válidos. No acota: rechaza. */
export function validateParams(schema: ParamSchema, values: ParamValues): string | null {
  for (const key of Object.keys(values)) {
    if (!(key in schema)) return `parámetro desconocido «${key}»`;
  }
  for (const [key, def] of Object.entries(schema)) {
    const v = values[key];
    if (v === undefined) return `falta «${key}»`;
    switch (def.type) {
      case 'int':
        if (typeof v !== 'number' || !Number.isInteger(v)) return `«${def.label}» debe ser un entero`;
        if (v < def.min || v > def.max) return `«${def.label}» debe estar entre ${def.min} y ${def.max}`;
        break;
      case 'bool':
        if (typeof v !== 'boolean') return `«${def.label}» debe ser sí/no`;
        break;
      case 'enum':
        if (typeof v !== 'string' || !def.options.includes(v)) return `«${def.label}» no admite «${String(v)}»`;
        break;
      case 'ref':
        if (typeof v !== 'string' || v === '') return `«${def.label}» debe apuntar a un prefab`;
        break;
    }
  }
  return null;
}

/**
 * Para datos que vienen de fuera (guardados, edición con sliders): completa lo que falta con el valor por defecto,
 * acota los enteros al rango y descarta lo desconocido. Siempre devuelve valores que pasan validateParams.
 */
export function normalizeParams(schema: ParamSchema, values: Record<string, unknown> = {}): ParamValues {
  const out: ParamValues = {};
  for (const [key, def] of Object.entries(schema)) {
    const v = values[key];
    switch (def.type) {
      case 'int':
        out[key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(def.max, Math.max(def.min, Math.round(v))) : def.default;
        break;
      case 'bool':
        out[key] = typeof v === 'boolean' ? v : def.default;
        break;
      case 'enum':
        out[key] = typeof v === 'string' && def.options.includes(v) ? v : def.default;
        break;
      case 'ref':
        out[key] = typeof v === 'string' && v !== '' ? v : def.default;
        break;
    }
  }
  return out;
}
