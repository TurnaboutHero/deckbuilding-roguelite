import { describe, expect, it } from 'vitest';

import type { CoinDefId, EnemyDefId, SkillId } from '../ids';
import type { ContentDb } from '../content-types';
import { createCombat, step } from './reducer';
import { applyDamage, applyEffectAtom } from './resolve/flip';
import { statusStacks, statusTurns } from './state';
import type { CombatState } from './state';
import type { CombatEvent } from './events';

const id = <T extends string>(value: string) => value as T;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null }
  },
  skills: {
    wait: {
      id: id<SkillId>('wait'),
      name: '대기',
      type: 'flip',
      rarity: 'common',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: []
    }
  },
  enemies: {
    dummy: {
      id: id<EnemyDefId>('dummy'),
      name: '허수아비',
      maxHp: 75,
      intents: [{ id: 'idle', actions: [] }]
    }
  },
  characters: {
    warrior: {
      id: id('warrior'),
      name: '전사',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: Array.from({ length: 6 }, () => id<SkillId>('wait')),
      trait: { id: 'none', name: '없음', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (): CombatState => createCombat({ character: id('warrior'), enemies: [id('dummy')] }, testDb(), 'status-duration');

const damageEvent = (events: readonly CombatEvent[]): Extract<CombatEvent, { type: 'damageDealt' }> => {
  const event = events.find((candidate) => candidate.type === 'damageDealt');
  if (event === undefined || event.type !== 'damageDealt') throw new Error('missing damage event');
  return event;
};

describe('duration status container', () => {
  it('reduces outgoing attack damage by frostbite for one turn with floor rounding', () => {
    const state = {
      ...combat(),
      player: { ...combat().player, statuses: { frostbite: { kind: 'duration' as const, turns: 1 } } }
    };
    const events: CombatEvent[] = [];
    applyDamage(state, { type: 'enemy', index: 0 }, 12, 'skill', events, { type: 'player' });
    expect(damageEvent(events).amount).toBe(9);
  });

  it('increases incoming damage against a shocked receiver', () => {
    const state = combat();
    state.enemies[0] = { ...state.enemies[0]!, statuses: { shock: { kind: 'duration', turns: 1 } } };
    const events: CombatEvent[] = [];
    applyDamage(state, { type: 'enemy', index: 0 }, 10, 'skill', events, { type: 'player' });
    expect(damageEvent(events).amount).toBe(15);
  });

  it('combines frostbite and shock multiplicatively before flooring', () => {
    const state = combat();
    state.player = { ...state.player, statuses: { frostbite: { kind: 'duration', turns: 1 } } };
    state.enemies[0] = { ...state.enemies[0]!, statuses: { shock: { kind: 'duration', turns: 1 } } };
    const events: CombatEvent[] = [];
    applyDamage(state, { type: 'enemy', index: 0 }, 12, 'skill', events, { type: 'player' });
    expect(damageEvent(events).amount).toBe(13);
  });

  it('keeps burn ticks as fixed damage that ignores frostbite and shock', () => {
    const db = testDb();
    const state = createCombat({ character: id('warrior'), enemies: [id('dummy')] }, db, 'burn-fixed');
    state.player = { ...state.player, statuses: { frostbite: { kind: 'duration', turns: 1 } } };
    state.enemies[0] = {
      ...state.enemies[0]!,
      statuses: { burn: { kind: 'stack', stacks: 4 }, shock: { kind: 'duration', turns: 1 } }
    };
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.enemies[0]?.hp).toBe(71);
    expect(statusStacks(ended.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(3);
  });

  it('expires a one-turn duration at the holder turn end', () => {
    const db = testDb();
    const state = createCombat({ character: id('warrior'), enemies: [id('dummy')] }, db, 'duration-expire');
    state.player = { ...state.player, statuses: { frostbite: { kind: 'duration', turns: 1 } } };
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(statusTurns(ended.state.player.statuses, 'frostbite')).toBe(0);
  });

  it('adds duration turns on reapplication while keeping applyStatus stacks wording', () => {
    const state = combat();
    state.player = { ...state.player, statuses: { frostbite: { kind: 'duration', turns: 1 } } };
    const events: CombatEvent[] = [];
    const next = applyEffectAtom(
      state,
      { kind: 'applyStatus', status: 'frostbite', stacks: 2, to: 'self' },
      { type: 'enemy', index: 0 },
      testDb(),
      events
    );
    expect(statusTurns(next.player.statuses, 'frostbite')).toBe(3);
    expect(events).toContainEqual({
      type: 'statusApplied',
      target: { type: 'player' },
      status: 'frostbite',
      stacks: 2,
      turns: 2
    });
  });
});
