import type { ParamSchema } from './params';

// Catálogo de tipos de nodo. UN TIPO es código auditado: su esquema vive aquí y su comportamiento dentro de la sim
// (engine.ts). UNA INSTANCIA es solo datos: valores de parámetros dentro de un manifiesto. Un manifiesto no puede
// traer comportamiento nuevo, solo ajustar los tipos que ya existen. Cada tipo lleva versión: si cambia su
// comportamiento, sube, y el huella del manifiesto cambia con ella.

export type NodeScope = 'world' | 'player' | 'prefab';

export type NodeType = {
  id: string;
  version: number;
  scope: NodeScope;
  label: string;
  help: string;
  /** ¿puede haber varias instancias en el mismo sitio? (p. ej. varias entradas de aparición) */
  multiple?: boolean;
  schema: ParamSchema;
};

const def = <T extends NodeType>(t: T): T => t;

export const NODE_TYPES = {
  // ───────── mundo ─────────
  world: def({
    id: 'world', version: 1, scope: 'world', label: 'Mundo', help: 'Tamaño, resolución y ritmo de la simulación.',
    schema: {
      resolution: { type: 'int', min: 1, max: 64, default: 16, label: 'Resolución (unidades por casilla)', step: 1 },
      cols: { type: 'int', min: 4, max: 128, default: 30, label: 'Ancho (casillas)', unit: 'casillas' },
      rows: { type: 'int', min: 4, max: 128, default: 17, label: 'Alto (casillas)', unit: 'casillas' },
      groundHeight: { type: 'int', min: 0, max: 2048, default: 56, label: 'Altura del suelo', unit: 'u' },
      tickRate: { type: 'enum', options: ['30', '60'], default: '60', label: 'Ticks por segundo' },
    },
  }),
  gravity: def({
    id: 'gravity', version: 1, scope: 'world', label: 'Gravedad', help: 'Hacia dónde y con qué fuerza cae todo.',
    schema: {
      direction: { type: 'enum', options: ['down', 'none'], default: 'down', label: 'Dirección' },
      strength: { type: 'int', min: 0, max: 8000, default: 2300, label: 'Fuerza', unit: 'u/s²', step: 50 },
    },
  }),
  scroll: def({
    id: 'scroll', version: 1, scope: 'world', label: 'Avance', help: 'Velocidad a la que pasa el mundo hacia el jugador, y cuánto acelera.',
    schema: {
      startSpeed: { type: 'int', min: 0, max: 2000, default: 250, label: 'Velocidad inicial', unit: 'u/s', step: 10 },
      maxSpeed: { type: 'int', min: 0, max: 3000, default: 620, label: 'Velocidad máxima', unit: 'u/s', step: 10 },
      accel: { type: 'int', min: 0, max: 200, default: 6, label: 'Aceleración', unit: 'u/s²' },
    },
  }),
  spawnTiming: def({
    id: 'spawnTiming', version: 1, scope: 'world', label: 'Ritmo de aparición', help: 'Cada cuánto aparece algo nuevo.',
    schema: {
      firstDelayMs: { type: 'int', min: 0, max: 10000, default: 1100, label: 'Primera espera', unit: 'ms', step: 50 },
      gapMinMs: { type: 'int', min: 100, max: 10000, default: 750, label: 'Hueco mínimo', unit: 'ms', step: 50 },
      gapMaxMs: { type: 'int', min: 100, max: 20000, default: 1650, label: 'Hueco máximo', unit: 'ms', step: 50 },
      gapGrowthMs: { type: 'int', min: 0, max: 1000, default: 111, label: 'Hueco extra por cada 100 u/s ganadas', unit: 'ms' },
    },
  }),
  spawn: def({
    id: 'spawn', version: 1, scope: 'world', label: 'Qué aparece', help: 'Una entrada de aparición: qué objeto, con qué peso y desde dónde.',
    multiple: true,
    schema: {
      prefab: { type: 'ref', default: 'cactus', label: 'Objeto' },
      weight: { type: 'int', min: 1, max: 100, default: 7, label: 'Peso' },
      minScore: { type: 'int', min: 0, max: 100000, default: 0, label: 'Aparece desde los', unit: 'puntos', step: 50 },
      edge: { type: 'enum', options: ['right', 'left'], default: 'right', label: 'Desde' },
    },
  }),
  score: def({
    id: 'score', version: 1, scope: 'world', label: 'Puntuación', help: 'Cómo se convierte la distancia en puntos.',
    schema: {
      unitsPerPoint: { type: 'int', min: 1, max: 1000, default: 10, label: 'Unidades por punto', unit: 'u' },
    },
  }),

  // ───────── jugador ─────────
  playerBody: def({
    id: 'playerBody', version: 1, scope: 'player', label: 'Cuerpo', help: 'Tamaño, posición y margen de perdón en los bordes.',
    schema: {
      x: { type: 'int', min: 0, max: 4096, default: 64, label: 'Posición horizontal', unit: 'u' },
      width: { type: 'int', min: 4, max: 256, default: 26, label: 'Ancho', unit: 'u' },
      height: { type: 'int', min: 4, max: 256, default: 40, label: 'Alto', unit: 'u' },
      forgiveness: { type: 'int', min: 0, max: 16, default: 3, label: 'Perdón en los bordes', unit: 'u' },
    },
  }),
  playerJump: def({
    id: 'playerJump', version: 1, scope: 'player', label: 'Salto', help: 'Altura que alcanza el salto (el motor calcula el impulso según la gravedad).',
    schema: {
      height: { type: 'int', min: 0, max: 1024, default: 126, label: 'Altura', unit: 'u', step: 2 },
    },
  }),
  playerDuck: def({
    id: 'playerDuck', version: 1, scope: 'player', label: 'Agacharse', help: 'Cuerpo agachado y caída rápida si te agachas en el aire.',
    schema: {
      width: { type: 'int', min: 4, max: 256, default: 34, label: 'Ancho agachado', unit: 'u' },
      height: { type: 'int', min: 4, max: 256, default: 22, label: 'Alto agachado', unit: 'u' },
      fastFall: { type: 'int', min: 0, max: 4000, default: 500, label: 'Caída rápida', unit: 'u/s', step: 50 },
    },
  }),
  playerHealth: def({
    id: 'playerHealth', version: 1, scope: 'player', label: 'Vida', help: 'Vida máxima y tiempo de invulnerabilidad tras recibir daño.',
    schema: {
      max: { type: 'int', min: 1, max: 20, default: 1, label: 'Vida máxima' },
      invulnerableMs: { type: 'int', min: 0, max: 5000, default: 0, label: 'Invulnerable tras daño', unit: 'ms', step: 100 },
    },
  }),

  // ───────── objetos (prefabs) ─────────
  body: def({
    id: 'body', version: 1, scope: 'prefab', label: 'Cuerpo', help: 'Tamaño (con rango al azar) y altura sobre el suelo.',
    schema: {
      widthMin: { type: 'int', min: 1, max: 512, default: 16, label: 'Ancho mínimo', unit: 'u' },
      widthMax: { type: 'int', min: 1, max: 512, default: 16, label: 'Ancho máximo', unit: 'u' },
      heightMin: { type: 'int', min: 1, max: 512, default: 28, label: 'Alto mínimo', unit: 'u' },
      heightMax: { type: 'int', min: 1, max: 512, default: 28, label: 'Alto máximo', unit: 'u' },
      y: { type: 'int', min: 0, max: 2048, default: 0, label: 'Altura sobre el suelo', unit: 'u' },
    },
  }),
  mover: def({
    id: 'mover', version: 1, scope: 'prefab', label: 'Movimiento', help: 'Hacia dónde se mueve y a qué velocidad.',
    schema: {
      direction: { type: 'enum', options: ['left', 'right', 'up', 'down'], default: 'left', label: 'Dirección' },
      followScroll: { type: 'bool', default: true, label: 'Sigue el avance del mundo' },
      speed: { type: 'int', min: 0, max: 3000, default: 0, label: 'Velocidad propia', unit: 'u/s', step: 10 },
    },
  }),
  hazard: def({
    id: 'hazard', version: 1, scope: 'prefab', label: 'Daño', help: 'Cuánto daño hace y cuándo: al tocar o cada cierto tiempo.',
    schema: {
      damage: { type: 'int', min: 0, max: 20, default: 1, label: 'Daño' },
      trigger: { type: 'enum', options: ['touch', 'interval'], default: 'touch', label: 'Cuándo' },
      everyMs: { type: 'int', min: 50, max: 10000, default: 500, label: 'Cada (si es por intervalo)', unit: 'ms', step: 50 },
    },
  }),
  despawn: def({
    id: 'despawn', version: 1, scope: 'prefab', label: 'Desaparición', help: 'Cuándo se retira: al salir de la pantalla o tras un tiempo.',
    schema: {
      mode: { type: 'enum', options: ['offscreen', 'lifetime'], default: 'offscreen', label: 'Cuándo' },
      lifetimeMs: { type: 'int', min: 100, max: 60000, default: 5000, label: 'Duración (si es por tiempo)', unit: 'ms', step: 100 },
      margin: { type: 'int', min: 0, max: 512, default: 10, label: 'Margen fuera de pantalla', unit: 'u' },
    },
  }),
} as const satisfies Record<string, NodeType>;

export type NodeTypeId = keyof typeof NODE_TYPES;

export const nodeType = (id: string): NodeType | undefined => (NODE_TYPES as Record<string, NodeType>)[id];
