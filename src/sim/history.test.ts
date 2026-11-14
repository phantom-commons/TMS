import { describe, expect, it } from 'vitest';
import { replay } from './replay';
import { getCellHistory, getCellStats, getEntityHistory, getEntityStats, getAuthorHistory } from './history';
import { makeActor, emit } from './test-util';

describe('entity and cell histories', () => {
  it('indexes one event for entity, cell and author without duplicating the event', () => {
    const actor = makeActor();
    const entries = [
      emit(actor, 'INIT', { spawn: { x: 3, y: 3 } }),
      emit(actor, 'PLACE', { entityId: 'cube-1', x: 5, y: 5, blocksMovement: true }),
      emit(actor, 'INTERACT', { entityId: 'cube-1', kind: 'click' }),
      emit(actor, 'MOVE', { x: 4, y: 4 }),
      emit(actor, 'PICK_UP', { entityId: 'cube-1' }),
      emit(actor, 'DROP', { entityId: 'cube-1', x: 6, y: 5 }),
    ];
    const world = replay(entries);

    expect(world.eventRefs).toHaveLength(6);
    expect(getEntityHistory(world, entries, 'cube-1').map((e) => e.type)).toEqual([
      'PLACE', 'INTERACT', 'PICK_UP', 'DROP',
    ]);
    expect(getAuthorHistory(world, entries, actor.id)).toHaveLength(6);
    expect(getCellHistory(world, entries, 5, 5).map((e) => e.type)).toContain('PLACE');
    expect(getEntityStats(world, 'cube-1')).toMatchObject({
      clickCount: 1,
      pickupCount: 1,
      dropCount: 1,
      clicksSinceLastMove: 0,
    });
    expect(getCellStats(world, 4, 4).playerVisits).toBe(1);
    expect(world.entities['cube-1'].location).toEqual({ kind: 'room', roomId: 'r', x: 6, y: 5 });
  });

  it('prevents a player from picking up an object from far away', () => {
    const actor = makeActor();
    const entries = [
      emit(actor, 'INIT', { spawn: { x: 3, y: 3 } }),
      emit(actor, 'PLACE', { entityId: 'cube-2', x: 8, y: 8 }),
      emit(actor, 'PICK_UP', { entityId: 'cube-2' }),
    ];
    const world = replay(entries);
    expect(world.entities['cube-2'].location).toEqual({ kind: 'room', roomId: 'r', x: 8, y: 8 });
    expect(getEntityHistory(world, entries, 'cube-2').map((e) => e.type)).toEqual(['PLACE']);
  });
});
