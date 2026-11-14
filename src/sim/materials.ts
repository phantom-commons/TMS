export type MaterialId = 'water' | 'beer' | 'wine' | 'blood' | 'oil' | 'acid' | 'vomit' | 'mud';

export type MaterialProps = {
  name: string;
  /** 0..1: contribución a la intoxicación por litro absorbido. */
  intoxicating: number;
  /** 0..1: inflamabilidad. */
  flammable: number;
  /** 0..1: valor nutritivo por litro. */
  nutritious: number;
  /** 0..1: toxicidad por litro. */
  poisonous: number;
};

export const MATERIALS: Record<MaterialId, MaterialProps> = {
  water: { name: 'agua',    intoxicating: 0,   flammable: 0,   nutritious: 0,   poisonous: 0 },
  beer:  { name: 'cerveza', intoxicating: 0.8, flammable: 0,   nutritious: 0.3, poisonous: 0 },
  wine:  { name: 'vino',    intoxicating: 0.9, flammable: 0,   nutritious: 0.2, poisonous: 0 },
  blood: { name: 'sangre',  intoxicating: 0,   flammable: 0,   nutritious: 0.1, poisonous: 0 },
  oil:   { name: 'aceite',  intoxicating: 0,   flammable: 0.9, nutritious: 0,   poisonous: 0 },
  acid:  { name: 'ácido',   intoxicating: 0,   flammable: 0,   nutritious: 0,   poisonous: 0.9 },
  vomit: { name: 'vómito',  intoxicating: 0.1, flammable: 0,   nutritious: 0,   poisonous: 0.05 },
  mud:   { name: 'lodo',    intoxicating: 0,   flammable: 0,   nutritious: 0,   poisonous: 0 },
};

const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === 'string' && (MATERIAL_IDS as string[]).includes(value);
}