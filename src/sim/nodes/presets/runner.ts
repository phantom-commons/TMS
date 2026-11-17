import type { Manifest } from '../manifest';

// «Salto» como datos: no hay motor propio, solo nodos con parámetros. Cambiar la gravedad, la altura del salto o lo
// que aparece es cambiar números aquí (o con los sliders de Reglas), no escribir código.

export const RUNNER_MANIFEST: Manifest = {
  v: 1,
  id: 'runner',
  name: 'Salto',
  world: [
    { type: 'world', params: { resolution: 16, cols: 30, rows: 17, groundHeight: 56, tickRate: '60' } },
    { type: 'gravity', params: { direction: 'down', strength: 2300 } },
    { type: 'scroll', params: { startSpeed: 250, maxSpeed: 620, accel: 6 } },
    { type: 'spawnTiming', params: { firstDelayMs: 1100, gapMinMs: 750, gapMaxMs: 1650, gapGrowthMs: 111 } },
    { type: 'spawn', params: { prefab: 'cactus', weight: 7, minScore: 0, edge: 'right' } },
    // los pájaros solo aparecen tras 450 puntos y con un 30 % de probabilidad (peso 3 de 10)
    { type: 'spawn', params: { prefab: 'bird', weight: 3, minScore: 450, edge: 'right' } },
    { type: 'score', params: { unitsPerPoint: 10 } },
  ],
  player: [
    { type: 'playerBody', params: { x: 64, width: 26, height: 40, forgiveness: 3 } },
    { type: 'playerJump', params: { height: 126 } },
    { type: 'playerDuck', params: { width: 34, height: 22, fastFall: 500 } },
    { type: 'playerHealth', params: { max: 1, invulnerableMs: 0 } },
  ],
  prefabs: {
    cactus: [
      { type: 'body', params: { widthMin: 16, widthMax: 36, heightMin: 28, heightMax: 53, y: 0 } },
      { type: 'mover', params: { direction: 'left', followScroll: true, speed: 0 } },
      { type: 'hazard', params: { damage: 1, trigger: 'touch', everyMs: 500 } },
      { type: 'despawn', params: { mode: 'offscreen', lifetimeMs: 5000, margin: 10 } },
    ],
    // vuela a la altura de la cabeza: hay que agacharse (o saltarlo con buen pulso)
    bird: [
      { type: 'body', params: { widthMin: 34, widthMax: 34, heightMin: 18, heightMax: 18, y: 26 } },
      { type: 'mover', params: { direction: 'left', followScroll: true, speed: 0 } },
      { type: 'hazard', params: { damage: 1, trigger: 'touch', everyMs: 500 } },
      { type: 'despawn', params: { mode: 'offscreen', lifetimeMs: 5000, margin: 10 } },
    ],
  },
};
