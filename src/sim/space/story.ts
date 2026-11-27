import { crash, readyToFly, type Ship } from './ship';

// Estado de la historia: tutorial → salir → meteoritos → caída → reparar → lista.
// Cada paso se cierra con un HECHO de la sim (te moviste, usaste algo, saliste, reparaste), nunca con un temporizador:
// así recargar a mitad no repite ni pierde nada, y el render solo enseña lo que ya pasó. Puro, sin render.

export const STEPS = ['tutorial', 'salir', 'meteoritos', 'caida', 'reparar', 'lista'] as const;
export type Step = (typeof STEPS)[number];

export const TUTORIAL_GOALS = ['mover', 'mirar', 'usar', 'escotilla'] as const;
export type Goal = (typeof TUTORIAL_GOALS)[number];

export type Story = { v: 1; step: Step; done: Goal[] };

export type Fact =
  | { t: 'moved' }
  | { t: 'looked' }
  | { t: 'used' }
  | { t: 'atHatch' }
  | { t: 'skipTutorial' }
  | { t: 'exited' } // saliste de la nave en vuelo
  | { t: 'meteorsDone' } // la lluvia terminó (o se saltó)
  | { t: 'landed' } // el render confirma que caíste y ves el planeta
  | { t: 'repaired' }; // se reparó un módulo

/** Lo que el llamador debe hacer en el mundo: la historia no toca la nave, la pide. */
export type Effect = { t: 'crash' };

export const initialStory = (): Story => ({ v: 1, step: 'tutorial', done: [] });

const GOAL_OF: Partial<Record<Fact['t'], Goal>> = { moved: 'mover', looked: 'mirar', used: 'usar', atHatch: 'escotilla' };

export type Advance = { story: Story; effects: Effect[]; changed: boolean };

/** Aplica un hecho. Los que no corresponden al paso actual se ignoran. `ship` solo se usa para saber si ya está todo reparado. */
export function advance(story: Story, fact: Fact, ship?: Ship): Advance {
  const same: Advance = { story, effects: [], changed: false };
  const go = (step: Step, effects: Effect[] = [], done = story.done): Advance => ({ story: { v: 1, step, done }, effects, changed: true });
  switch (story.step) {
    case 'tutorial': {
      if (fact.t === 'skipTutorial') return go('salir', [], [...TUTORIAL_GOALS]);
      const g = GOAL_OF[fact.t];
      if (!g || story.done.includes(g)) return same;
      const done = TUTORIAL_GOALS.filter((x) => x === g || story.done.includes(x));
      return done.length === TUTORIAL_GOALS.length ? go('salir', [], done) : { story: { ...story, done }, effects: [], changed: true };
    }
    case 'salir':
      return fact.t === 'exited' ? go('meteoritos') : same;
    case 'meteoritos':
      return fact.t === 'meteorsDone' ? go('caida', [{ t: 'crash' }]) : same;
    case 'caida':
      return fact.t === 'landed' ? go('reparar') : same;
    case 'reparar':
      return fact.t === 'repaired' && ship && readyToFly(ship) ? go('lista') : same;
    default:
      return same;
  }
}

/** Guardado leído de fuera: si no sirve, se empieza de cero (nunca se confía en él). */
export function validateStory(raw: unknown): Story {
  const r = raw as Partial<Story> | null;
  if (!r || r.v !== 1 || !STEPS.includes(r.step as Step) || !Array.isArray(r.done)) return initialStory();
  const done = TUTORIAL_GOALS.filter((g) => (r.done as unknown[]).includes(g));
  // pasado el tutorial, los objetivos están todos hechos por definición
  return { v: 1, step: r.step as Step, done: STEPS.indexOf(r.step as Step) > 0 ? [...TUTORIAL_GOALS] : done };
}

/** La nave tiene que coincidir con el paso: desde la caída en adelante está en el suelo. Devuelve la nave coherente. */
export function reconcileShip(story: Story, ship: Ship): Ship {
  const needsCrash = STEPS.indexOf(story.step) >= STEPS.indexOf('caida') && ship.status === 'flying';
  return needsCrash ? crash(ship) : ship;
}

/** ¿Se puede estar en el planeta ahora? Antes de la caída, no. */
export const planetOpen = (story: Story): boolean => STEPS.indexOf(story.step) >= STEPS.indexOf('caida');

export type Controls = 'touch' | 'keys';
export type Objective = { id: string; text: string; done: boolean };

const TEXT: Record<Goal, Record<Controls, string>> = {
  mover: { touch: 'Muévete con el pad', keys: 'Muévete con W A S D' },
  mirar: { touch: 'Arrastra para mirar alrededor', keys: 'Mira alrededor con el ratón' },
  usar: { touch: 'Toca «Usar» junto a un objeto', keys: 'Pulsa F junto a un objeto' },
  escotilla: { touch: 'Acércate a la escotilla', keys: 'Acércate a la escotilla' },
};

/** Lo que se muestra en pantalla ahora. */
export function objectives(story: Story, controls: Controls = 'touch'): Objective[] {
  switch (story.step) {
    case 'tutorial':
      return TUTORIAL_GOALS.map((g) => ({ id: g, text: TEXT[g][controls], done: story.done.includes(g) }));
    case 'salir':
      return [{ id: 'salir', text: 'Sal por la escotilla a revisar el exterior', done: false }];
    case 'meteoritos':
      return [{ id: 'meteoritos', text: 'Algo se acerca…', done: false }];
    case 'caida':
      return [{ id: 'caida', text: 'Has caído en el planeta', done: false }];
    case 'reparar':
      return [{ id: 'reparar', text: 'Busca piezas y repara la nave', done: false }];
    default:
      return [{ id: 'lista', text: 'La nave está lista', done: true }];
  }
}

const KEY = 'story.v1';
type Store = { get: <T>(k: string, f: T) => T; set: (k: string, v: unknown) => void };
export const loadStory = (kv: Store): Story => validateStory(kv.get<unknown>(KEY, null));
export const saveStory = (kv: Store, s: Story): void => kv.set(KEY, s);
