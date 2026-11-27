// Ficha de objeto: todo lo que el juego sabe de un tipo de cosa. La sim lee las etiquetas (colisión, empujar, coger…);
// el render lee `visual` (forma y tono). Cambiar un cubo por un GLB solo cambia `visual`, nunca las etiquetas.
// Las etiquetas salen de un catálogo cerrado para que se puedan validar y firmar.

export const TAGS = ['solido', 'empujable', 'recogible', 'abre', 'botin', 'estructura', 'vegetal', 'mineral', 'metal', 'decorativo', 'pieza'] as const;
export type Tag = (typeof TAGS)[number];

export const MATERIALS = ['roca', 'madera', 'metal', 'tierra', 'hoja', 'cristal', 'tela'] as const;
export type Material = (typeof MATERIALS)[number];

export const SHAPES = ['cubo', 'plano-cruzado', 'cono', 'cilindro', 'caja'] as const;
export type Shape = (typeof SHAPES)[number];

export type Sheet = {
  kind: string;
  name: string;
  material: Material;
  tags: readonly Tag[];
  /** 0–9: cuánto cuesta romperlo */
  hardness: number;
  /** puntos de durabilidad al aparecer */
  durability: number;
  visual: { shape: Shape; tone: 'suelo' | 'roca' | 'hoja' | 'madera' | 'metal' | 'acento' | 'cristal'; size: number };
};

const S = (kind: string, name: string, material: Material, tags: Tag[], hardness: number, durability: number, shape: Shape, tone: Sheet['visual']['tone'], size = 1): Sheet => ({
  kind,
  name,
  material,
  tags,
  hardness,
  durability,
  visual: { shape, tone, size },
});

export const SHEETS: readonly Sheet[] = [
  // sin colisión: solo se mueven (props)
  S('arbusto', 'Arbusto', 'hoja', ['vegetal', 'decorativo'], 0, 5, 'plano-cruzado', 'hoja', 0.8),
  S('pino', 'Pino', 'madera', ['vegetal', 'decorativo'], 1, 20, 'cono', 'hoja', 3),
  S('roca-suelta', 'Roca suelta', 'roca', ['mineral', 'decorativo'], 3, 30, 'cubo', 'roca', 0.5),
  // con estado: se empujan, se cogen, se abren
  S('cubo-empujable', 'Cubo empujable', 'metal', ['solido', 'empujable'], 2, 40, 'cubo', 'acento'),
  S('cubo-fijo', 'Cubo fijo', 'roca', ['solido', 'mineral'], 6, 90, 'cubo', 'roca'),
  S('cubo-recogible', 'Cubo recogible', 'cristal', ['recogible'], 1, 10, 'cubo', 'cristal', 0.6),
  S('cofre', 'Cofre', 'madera', ['solido', 'abre', 'botin'], 4, 60, 'caja', 'madera', 0.8),
  S('hierro', 'Mineral de hierro', 'metal', ['solido', 'mineral', 'metal', 'recogible'], 5, 70, 'cubo', 'metal'),
  // piezas para reparar la nave
  S('cable', 'Cable', 'metal', ['recogible', 'pieza'], 0, 5, 'cilindro', 'acento', 0.4),
  S('placa', 'Placa de casco', 'metal', ['recogible', 'pieza', 'metal'], 1, 15, 'caja', 'metal', 0.6),
  S('nucleo', 'Núcleo de energía', 'cristal', ['recogible', 'pieza'], 1, 10, 'cubo', 'cristal', 0.5),
  S('traje', 'Traje espacial', 'tela', ['recogible', 'pieza'], 0, 10, 'caja', 'acento', 0.6),
  // estructuras (celdas estáticas)
  S('muro', 'Muro', 'roca', ['solido', 'estructura'], 7, 100, 'cubo', 'roca'),
  S('suelo-estructura', 'Suelo', 'roca', ['estructura', 'decorativo'], 0, 0, 'caja', 'suelo', 0.1),
  S('casco', 'Casco de nave', 'metal', ['solido', 'estructura', 'metal'], 8, 100, 'cubo', 'metal'),
];

const BY_KIND = new Map(SHEETS.map((s) => [s.kind, s]));

export const sheetOf = (kind: string): Sheet | undefined => BY_KIND.get(kind);
export const hasTag = (kind: string, tag: Tag): boolean => sheetOf(kind)?.tags.includes(tag) ?? false;
export const isSolidKind = (kind: string): boolean => hasTag(kind, 'solido');

export function validateSheet(s: Sheet): string | null {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(s.kind)) return 'kind inválido';
  if (!(MATERIALS as readonly string[]).includes(s.material)) return 'material desconocido';
  if (!SHAPES.includes(s.visual.shape)) return 'forma desconocida';
  if (new Set(s.tags).size !== s.tags.length) return 'etiquetas repetidas';
  if (s.tags.some((t) => !(TAGS as readonly string[]).includes(t))) return 'etiqueta fuera del catálogo';
  if (!Number.isInteger(s.hardness) || s.hardness < 0 || s.hardness > 9) return 'dureza fuera de 0–9';
  if (!Number.isInteger(s.durability) || s.durability < 0) return 'durabilidad inválida';
  if (s.tags.includes('empujable') && !s.tags.includes('solido')) return 'empujable sin solido';
  if (s.tags.includes('abre') && s.tags.includes('recogible')) return 'un contenedor no se recoge';
  return null;
}
