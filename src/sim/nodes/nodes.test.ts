import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from './catalog';
import { FP, compile, createSim, jumpImpulse, playerBox, replay, scoreOf, simHash, stepSim, type SimInput, type SimObject } from './engine';
import { manifestFingerprint, normalizeManifest, validateManifest, type Manifest } from './manifest';
import { defaultsOf, normalizeParams, validateParams } from './params';
import { RUNNER_MANIFEST } from './presets/runner';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const IDLE: SimInput = { jump: false, duck: false };
const run = (sim: ReturnType<typeof createSim>, ticks: number, input: SimInput = IDLE) => {
  for (let i = 0; i < ticks && sim.state.alive; i++) stepSim(sim, input);
};
/** edita un parámetro de un nodo del preset (devuelve una copia) */
function tweak(edit: (m: Manifest) => void): Manifest {
  const m = clone(RUNNER_MANIFEST);
  edit(m);
  return m;
}
const nodeP = (list: Manifest['world'], type: string) => list.find((n) => n.type === type)!.params;
const obj = (over: Partial<SimObject>): SimObject => ({ id: 99, prefab: 'cactus', x: 0, y: 0, w: 20, h: 40, age: 0, seen: true, hit: false, nextHit: 0, ...over });

describe('parámetros con esquema', () => {
  const schema = NODE_TYPES.gravity.schema;
  it('los valores por defecto son válidos', () => {
    for (const t of Object.values(NODE_TYPES)) expect(validateParams(t.schema, defaultsOf(t.schema))).toBeNull();
  });
  it('rechaza fuera de rango, decimales, enums desconocidos y parámetros ajenos', () => {
    expect(validateParams(schema, { direction: 'down', strength: 9000 })).toMatch(/entre/);
    expect(validateParams(schema, { direction: 'down', strength: 10.5 })).toMatch(/entero/);
    expect(validateParams(schema, { direction: 'sideways', strength: 10 })).toMatch(/no admite/);
    expect(validateParams(schema, { direction: 'down', strength: 10, extra: 1 })).toMatch(/desconocido/);
    expect(validateParams(schema, { direction: 'down' })).toMatch(/falta/);
  });
  it('normalizar acota, redondea y rellena sin lanzar', () => {
    expect(normalizeParams(schema, { strength: 99999, direction: 'x' })).toEqual({ direction: 'down', strength: 8000 });
    expect(normalizeParams(schema, { strength: -5.4 })).toEqual({ direction: 'down', strength: 0 });
    expect(normalizeParams(schema, { strength: NaN })).toEqual({ direction: 'down', strength: 2300 });
    expect(validateParams(schema, normalizeParams(schema, { strength: 'abc' as unknown as number }))).toBeNull();
  });
});

describe('manifiesto', () => {
  it('el preset de Salto es válido', () => expect(validateManifest(RUNNER_MANIFEST)).toBeNull());
  it('rechaza tipos desconocidos, nodos en el sitio equivocado y repetidos', () => {
    expect(validateManifest(tweak((m) => m.world.push({ type: 'teleport', params: {} })))).toMatch(/desconocido/);
    expect(validateManifest(tweak((m) => m.player.push({ type: 'gravity', params: { direction: 'down', strength: 1 } })))).toMatch(/no puede ir aquí/);
    expect(validateManifest(tweak((m) => m.world.push({ type: 'gravity', params: { direction: 'down', strength: 1 } })))).toMatch(/una vez/);
  });
  it('rechaza referencias rotas y mínimos mayores que máximos', () => {
    expect(validateManifest(tweak((m) => { nodeP(m.world, 'spawn').prefab = 'dragon'; }))).toMatch(/no existe/);
    expect(validateManifest(tweak((m) => { nodeP(m.prefabs.cactus!, 'body').widthMin = 40; }))).toMatch(/mínimo supera/);
    expect(validateManifest(tweak((m) => { nodeP(m.world, 'spawnTiming').gapMinMs = 5000; }))).toMatch(/hueco/);
  });
  it('un valor fuera de rango no entra como manifiesto válido', () => {
    expect(validateManifest(tweak((m) => { nodeP(m.world, 'gravity').strength = 1e9; }))).toMatch(/entre/);
  });
  it('normalizar repara lo reparable y usa el de respaldo con basura', () => {
    const bad = tweak((m) => { nodeP(m.world, 'gravity').strength = 1e9; nodeP(m.prefabs.cactus!, 'body').widthMin = 400; });
    const fixed = normalizeManifest(bad, RUNNER_MANIFEST);
    expect(validateManifest(fixed)).toBeNull();
    expect(nodeP(fixed.world, 'gravity').strength).toBe(8000);
    expect(nodeP(fixed.prefabs.cactus!, 'body').widthMax).toBeGreaterThanOrEqual(400);
    expect(normalizeManifest({ nope: true }, RUNNER_MANIFEST)).toBe(RUNNER_MANIFEST);
    expect(normalizeManifest(null, RUNNER_MANIFEST)).toBe(RUNNER_MANIFEST);
    expect(normalizeManifest(tweak((m) => m.world.push({ type: 'virus', params: {} })), RUNNER_MANIFEST)).toBe(RUNNER_MANIFEST);
  });
  it('la huella es estable y cambia con cualquier parámetro', () => {
    expect(manifestFingerprint(RUNNER_MANIFEST)).toBe(manifestFingerprint(clone(RUNNER_MANIFEST)));
    expect(manifestFingerprint(tweak((m) => { nodeP(m.player, 'playerJump').height = 127; }))).not.toBe(manifestFingerprint(RUNNER_MANIFEST));
  });
  it('compile lanza con un manifiesto inválido', () => {
    expect(() => compile(tweak((m) => { nodeP(m.world, 'gravity').strength = -1; }))).toThrow(/inválido/);
  });
});

describe('salto: altura como parámetro', () => {
  it('el impulso alcanza al menos la altura pedida y no se pasa de un paso', () => {
    const g = compile(RUNNER_MANIFEST).gFp;
    for (const h of [20, 64, 126, 300]) {
      const v0 = jumpImpulse(g, h * FP);
      const apex = (v: number) => { let y = 0; for (; v > 0; v -= g) y += v; return y; };
      expect(apex(v0)).toBeGreaterThanOrEqual(h * FP);
      expect(apex(v0 - 1)).toBeLessThan(h * FP);
    }
  });
  it('simulado: sube hasta la altura configurada, vuelve al suelo y no hay doble salto', () => {
    const sim = createSim(tweak((m) => { nodeP(m.world, 'spawnTiming').firstDelayMs = 10000; }), 1);
    stepSim(sim, { jump: true, duck: false });
    let apex = sim.state.py;
    let airImpulses = 0;
    let landed = 0;
    for (let i = 0; i < 120; i++) {
      const vyBefore = sim.state.vy;
      const wasAir = sim.state.py > 0;
      stepSim(sim, { jump: true, duck: false }); // mantener pulsado: solo puede saltar de nuevo al aterrizar
      if (wasAir && sim.state.py > 0 && sim.state.vy > vyBefore) airImpulses++; // la velocidad sube en el aire = doble salto
      if (wasAir && sim.state.py === 0) landed++;
      apex = Math.max(apex, sim.state.py);
    }
    expect(apex / FP).toBeGreaterThanOrEqual(126);
    expect(apex / FP).toBeLessThan(126 + 12);
    expect(airImpulses).toBe(0);
    expect(landed).toBeGreaterThan(0); // vuelve al suelo
  });
  it('más gravedad = salto más corto en el tiempo, misma altura', () => {
    const air = (strength: number) => {
      const sim = createSim(tweak((m) => { nodeP(m.world, 'gravity').strength = strength; nodeP(m.world, 'spawnTiming').firstDelayMs = 10000; }), 1);
      stepSim(sim, { jump: true, duck: false });
      let ticks = 1;
      let apex = 0;
      while (sim.state.py > 0) { stepSim(sim, IDLE); apex = Math.max(apex, sim.state.py); ticks++; }
      return { ticks, apex: apex / FP };
    };
    const low = air(1500);
    const high = air(4000);
    expect(high.ticks).toBeLessThan(low.ticks);
    expect(high.apex).toBeGreaterThanOrEqual(126);
    expect(low.apex).toBeGreaterThanOrEqual(126);
  });
  it('sin gravedad no se cae ni se salta', () => {
    const sim = createSim(tweak((m) => { nodeP(m.world, 'gravity').direction = 'none'; }), 1);
    stepSim(sim, { jump: true, duck: false });
    expect(sim.state.py).toBe(0);
  });
});

describe('daño, vida y agacharse', () => {
  const placeBird = (sim: ReturnType<typeof createSim>) => {
    sim.state.nextSpawn = 1e9;
    sim.state.objects.push(obj({ prefab: 'bird', x: sim.cfg.player.xFp + 8 * FP, y: 26 * FP, w: 34, h: 18 }));
  };
  it('de pie, el pájaro choca; agachado, pasa por debajo', () => {
    const standing = createSim(RUNNER_MANIFEST, 1);
    placeBird(standing);
    stepSim(standing, IDLE);
    expect(standing.state.alive).toBe(false);
    const ducking = createSim(RUNNER_MANIFEST, 1);
    placeBird(ducking);
    stepSim(ducking, { jump: false, duck: true });
    expect(ducking.state.alive).toBe(true);
  });
  it('un cactus de frente mata y la puntuación se congela', () => {
    const sim = createSim(RUNNER_MANIFEST, 1);
    sim.state.nextSpawn = 1e9;
    sim.state.objects.push(obj({ x: sim.cfg.player.xFp + 10 * FP }));
    stepSim(sim, IDLE);
    expect(sim.state.alive).toBe(false);
    const s = scoreOf(sim);
    stepSim(sim, IDLE);
    expect(scoreOf(sim)).toBe(s);
  });
  it('con 3 de vida e invulnerabilidad, cada toque cuesta 1 y no se encadena', () => {
    const sim = createSim(tweak((m) => { Object.assign(nodeP(m.player, 'playerHealth'), { max: 3, invulnerableMs: 1000 }); }), 1);
    sim.state.nextSpawn = 1e9;
    sim.state.objects.push(obj({ x: sim.cfg.player.xFp + 4 * FP, w: 60 }));
    stepSim(sim, IDLE);
    expect(sim.state.hp).toBe(2);
    for (let i = 0; i < 20; i++) stepSim(sim, IDLE); // sigue tocando pero el objeto ya hizo su daño
    expect(sim.state.hp).toBe(2);
    expect(sim.state.alive).toBe(true);
  });
  it('daño por intervalo: se repite mientras se toca, respetando la invulnerabilidad', () => {
    const sim = createSim(tweak((m) => {
      Object.assign(nodeP(m.player, 'playerHealth'), { max: 5, invulnerableMs: 100 });
      Object.assign(nodeP(m.prefabs.cactus!, 'hazard'), { trigger: 'interval', everyMs: 500 });
      Object.assign(nodeP(m.prefabs.cactus!, 'mover'), { followScroll: false, speed: 0 });
    }), 1);
    sim.state.nextSpawn = 1e9;
    sim.state.scroll = 0;
    sim.cfg.scrollAccelFp = 0;
    sim.state.objects.push(obj({ x: sim.cfg.player.xFp, w: 60 }));
    run(sim, 60); // 1 s de contacto continuo
    expect(sim.state.hp).toBeLessThan(5);
    expect(sim.state.hp).toBeGreaterThanOrEqual(2);
  });
  it('el perdón de los bordes recorta la caja del jugador', () => {
    const a = playerBox(createSim(RUNNER_MANIFEST, 1));
    const b = playerBox(createSim(tweak((m) => { nodeP(m.player, 'playerBody').forgiveness = 0; }), 1));
    expect(b.w - a.w).toBe(6 * FP);
    expect(b.h - a.h).toBe(6 * FP);
  });
});

describe('aparición, avance y desaparición', () => {
  const harmless = tweak((m) => {
    nodeP(m.prefabs.cactus!, 'hazard').damage = 0;
    nodeP(m.prefabs.bird!, 'hazard').damage = 0;
  });
  it('genera objetos, acelera sin pasar del máximo y no acumula basura', () => {
    const sim = createSim(harmless, 7);
    let maxObjects = 0;
    let spawned = 0;
    for (let i = 0; i < 60 * 90; i++) {
      const before = sim.state.nextId;
      stepSim(sim, IDLE);
      spawned += sim.state.nextId - before;
      maxObjects = Math.max(maxObjects, sim.state.objects.length);
    }
    expect(spawned).toBeGreaterThan(30);
    expect(maxObjects).toBeLessThan(12); // se retiran al salir de pantalla
    expect(sim.state.scroll).toBeLessThanOrEqual(sim.cfg.scrollMaxFp);
    expect(sim.state.scroll).toBeGreaterThan(sim.cfg.scrollStartFp);
  });
  it('los pájaros no salen antes de los 450 puntos', () => {
    const sim = createSim(harmless, 3);
    while (scoreOf(sim) < 440) {
      stepSim(sim, IDLE);
      expect(sim.state.objects.some((o) => o.prefab === 'bird')).toBe(false);
    }
    let sawBird = false;
    for (let i = 0; i < 60 * 120 && !sawBird; i++) {
      stepSim(sim, IDLE);
      sawBird = sim.state.objects.some((o) => o.prefab === 'bird');
    }
    expect(sawBird).toBe(true);
  });
  it('el hueco entre objetos crece con la velocidad', () => {
    const gaps = (growth: number) => {
      const sim = createSim(tweak((m) => {
        nodeP(m.prefabs.cactus!, 'hazard').damage = 0;
        nodeP(m.world, 'spawnTiming').gapGrowthMs = growth;
        nodeP(m.world, 'spawnTiming').gapMinMs = 800;
        nodeP(m.world, 'spawnTiming').gapMaxMs = 800;
        nodeP(m.world, 'spawn').weight = 1;
        sim_noBirds(m);
      }), 1);
      sim.state.scroll = sim.cfg.scrollMaxFp;
      const ticks: number[] = [];
      let last = sim.state.nextId;
      for (let i = 0; i < 60 * 20; i++) { stepSim(sim, IDLE); if (sim.state.nextId !== last) { ticks.push(sim.state.tick); last = sim.state.nextId; } }
      return (ticks.at(-1)! - ticks[1]!) / (ticks.length - 2);
    };
    expect(gaps(500)).toBeGreaterThan(gaps(0));
  });
  it('un objeto con vida limitada desaparece solo', () => {
    const sim = createSim(tweak((m) => { Object.assign(nodeP(m.prefabs.cactus!, 'despawn'), { mode: 'lifetime', lifetimeMs: 500 }); nodeP(m.prefabs.cactus!, 'hazard').damage = 0; }), 1);
    sim.state.nextSpawn = 1e9;
    sim.state.objects.push(obj({ x: 100 * FP, w: 10, h: 10 }));
    run(sim, 29);
    expect(sim.state.objects.length).toBe(1);
    run(sim, 2);
    expect(sim.state.objects.length).toBe(0);
  });
  it('un objeto recién aparecido fuera de pantalla no se retira antes de entrar', () => {
    const sim = createSim(harmless, 1);
    run(sim, 60 * 3);
    expect(sim.state.nextId).toBeGreaterThan(1);
  });
});

function sim_noBirds(m: Manifest) {
  m.world = m.world.filter((n) => !(n.type === 'spawn' && n.params.prefab === 'bird'));
}

describe('determinismo', () => {
  const script = (n: number): SimInput[] => Array.from({ length: n }, (_, i) => ({ jump: i % 97 === 5 || i % 211 === 3, duck: i % 130 > 100 }));

  it('mismas entradas y semilla = mismo estado; otra semilla = otro estado', () => {
    const inputs = script(60 * 40);
    const a = replay(RUNNER_MANIFEST, 12345, inputs);
    const b = replay(RUNNER_MANIFEST, 12345, inputs);
    expect(simHash(a)).toBe(simHash(b));
    expect(simHash(replay(RUNNER_MANIFEST, 54321, inputs))).not.toBe(simHash(a));
  });
  it('avanzar de golpe o por tramos da lo mismo (se puede reanudar desde cualquier tick)', () => {
    const inputs = script(600);
    const whole = replay(RUNNER_MANIFEST, 9, inputs);
    const parts = createSim(RUNNER_MANIFEST, 9);
    for (const chunk of [inputs.slice(0, 100), inputs.slice(100, 450), inputs.slice(450)]) for (const i of chunk) stepSim(parts, i);
    expect(simHash(parts)).toBe(simHash(whole));
  });
  it('otro jugador distinto con las mismas entradas ve lo mismo aunque el manifiesto venga de JSON', () => {
    const inputs = script(900);
    const viaJson = JSON.parse(JSON.stringify(RUNNER_MANIFEST)) as Manifest;
    expect(simHash(replay(viaJson, 77, inputs))).toBe(simHash(replay(RUNNER_MANIFEST, 77, inputs)));
  });
  it('el estado solo contiene enteros', () => {
    const sim = replay(RUNNER_MANIFEST, 5, script(600));
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number' && !Number.isInteger(v)) bad.push(path);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
    };
    walk(sim.state, 'state');
    expect(bad).toEqual([]);
  });
});
