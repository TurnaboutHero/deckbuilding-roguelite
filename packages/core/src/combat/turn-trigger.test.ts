import { describe, expect, it } from 'vitest';

import type { CoinDefId, CoinUid, SkillId, SlotId } from '../ids';
import type { ContentDb } from '../content-types';
import type { Rng, RngSnapshot } from '../rng';
import { createCombat, step, zoneCoinCount } from './reducer';
import { legalCommands } from './commands';
import { previewFlip } from './preview';
import { applyDamage } from './resolve/flip';
import { statusStacks } from './state';
import type { CombatEvent } from './events';
import type { CombatState, TurnTriggerInstance } from './state';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const scriptedFlips = (faces: readonly ('heads' | 'tails')[]): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      const face = faces[index];
      if (face === undefined) throw new Error('scripted flip exhausted');
      index += 1;
      return face;
    },
    shuffle: <T>(xs: readonly T[]) => [...xs],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const burnOnDamage = {
  id: 'burn-on-damage',
  hook: 'onDamageDealt' as const,
  effects: [{ kind: 'applyStatus' as const, status: 'burn' as const, stacks: 1, to: 'target' as const }]
};

const burnOnAttack = {
  id: 'burn-on-attack',
  hook: 'onAttackSkillResolved' as const,
  effects: [{ kind: 'applyStatus' as const, status: 'burn' as const, stacks: 1, to: 'target' as const }]
};

const damageOnDamage = {
  id: 'damage-on-damage',
  hook: 'onDamageDealt' as const,
  effects: [{ kind: 'damage' as const, amount: 1 }]
};

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' }
  },
  skills: {
    setup: {
      id: id<SkillId>('setup'),
      name: 'Setup',
      type: 'flip',
      rarity: 'advanced',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'addTurnTrigger', trigger: burnOnDamage }]
    },
    'setup-attack': {
      id: id<SkillId>('setup-attack'),
      name: 'Setup Attack',
      type: 'flip',
      rarity: 'advanced',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'addTurnTrigger', trigger: burnOnAttack }]
    },
    'setup-damage': {
      id: id<SkillId>('setup-damage'),
      name: 'Setup Damage',
      type: 'flip',
      rarity: 'advanced',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'addTurnTrigger', trigger: damageOnDamage }]
    },
    strike: {
      id: id<SkillId>('strike'),
      name: 'Strike',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'damage', amount: 4 }]
    },
    'double-strike': {
      id: id<SkillId>('double-strike'),
      name: 'Double Strike',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 2,
      base: [],
      heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] }
    },
    guard: {
      id: id<SkillId>('guard'),
      name: 'Guard',
      type: 'flip',
      rarity: 'common',
      tags: ['defense'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'block', amount: 4 }]
    },
    'attack-consume': {
      id: id<SkillId>('attack-consume'),
      name: 'Attack Consume',
      type: 'consume',
      rarity: 'advanced',
      tags: ['attack'],
      targetType: 'single-enemy',
      consume: { element: 'fire', count: 1 },
      effects: []
    },
    'utility-consume': {
      id: id<SkillId>('utility-consume'),
      name: 'Utility Consume',
      type: 'consume',
      rarity: 'advanced',
      tags: ['utility'],
      targetType: 'single-enemy',
      consume: { element: 'fire', count: 1 },
      effects: []
    }
  },
  enemies: {
    dummy: {
      id: id('dummy'),
      name: 'Dummy',
      maxHp: 100,
      intents: [{ id: 'wait', actions: [{ kind: 'block', amount: 0 }] }]
    }
  },
  characters: {
    tester: {
      id: id('tester'),
      name: 'Tester',
      maxHp: 80,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [
        id<SkillId>('setup'),
        id<SkillId>('strike'),
        id<SkillId>('double-strike'),
        id<SkillId>('setup-attack'),
        id<SkillId>('attack-consume'),
        id<SkillId>('utility-consume')
      ],
      trait: { id: 'none', name: 'None', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (seed = 'turn-trigger'): CombatState => createCombat({ character: id('tester'), enemies: [id('dummy')] }, testDb(), seed);

const withFlips = (state: CombatState, faces: readonly ('heads' | 'tails')[]): CombatState => ({
  ...state,
  rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
});

const withFireHand = (state: CombatState): CombatState => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing hand coin');
  return { ...state, coins: { ...state.coins, [Number(coin)]: { ...state.coins[Number(coin)]!, defId: id<CoinDefId>('fire') } } };
};

const withTrigger = (state: CombatState, instance: TurnTriggerInstance): CombatState => ({
  ...state,
  turnTriggers: [...state.turnTriggers, instance],
  nextTurnTriggerUid: Math.max(state.nextTurnTriggerUid, instance.uid + 1)
});

const place = (state: CombatState, slotIndex: number, coin: CoinUid = state.zones.hand[0]!, db = testDb()): CombatState => {
  const result = step(state, { type: 'placeCoin', coin, slot: slot(slotIndex) }, db);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

const useFlip = (state: CombatState, slotIndex: number, db = testDb()) => {
  const result = step(state, { type: 'useFlipSkill', slot: slot(slotIndex), target: 0 }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const useConsume = (state: CombatState, slotIndex: number, coin: CoinUid, db = testDb()) => {
  const result = step(state, { type: 'useConsumeSkill', slot: slot(slotIndex), coins: [coin], target: 0 }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const burn = (state: CombatState): number => statusStacks(state.enemies[0]?.statuses ?? {}, 'burn');

describe('turn triggers', () => {
  it('fires onDamageDealt once for a player skill damage packet', () => {
    const state = place(withFlips(combat(), ['heads', 'heads']), 0);
    const added = useFlip(state, 0);
    const attack = useFlip(place(added.state, 1), 1);

    expect(added.events).toContainEqual({ type: 'turnTriggerAdded', trigger: 'burn-on-damage' });
    expect(attack.events).toContainEqual({ type: 'turnTriggerFired', trigger: 'burn-on-damage', hook: 'onDamageDealt' });
    expect(burn(attack.state)).toBe(1);
  });

  it('fires on a fully blocked zero-damage packet but not burn ticks or self damage', () => {
    const db = testDb();
    let state = withTrigger(combat(), { uid: 1, trigger: burnOnDamage });
    state = { ...state, enemies: state.enemies.map((enemy) => ({ ...enemy, block: 99 })) };
    const blocked = useFlip(place(state, 1, state.zones.hand[0]!, db), 1, db);
    expect(blocked.events).toContainEqual({ type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 0, blocked: 4, source: 'skill' });
    expect(burn(blocked.state)).toBe(1);

    const events: CombatEvent[] = [];
    const burned = applyDamage(blocked.state, { type: 'enemy', index: 0 }, 3, 'burn', events);
    expect(burn(burned)).toBe(1);
    expect(events.some((event) => event.type === 'turnTriggerFired')).toBe(false);

    const selfEvents: CombatEvent[] = [];
    const hurt = applyDamage(burned, { type: 'player' }, 3, 'self', selfEvents);
    expect(burn(hurt)).toBe(1);
    expect(selfEvents.some((event) => event.type === 'turnTriggerFired')).toBe(false);
  });

  it('treats a two-coin per-mode attack as one combined damage packet', () => {
    const state = withTrigger(withFlips(combat('per'), ['heads', 'heads']), { uid: 1, trigger: burnOnDamage });
    const placed = place(place(state, 2, state.zones.hand[0]!), 2, state.zones.hand[1]!);
    const result = useFlip(placed, 2);

    expect(result.events.filter((event) => event.type === 'damageDealt' && event.source === 'skill')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'turnTriggerFired')).toHaveLength(1);
    expect(burn(result.state)).toBe(1);
  });

  it('fires onAttackSkillResolved for attack consume skills with zero damage and not utility tags', () => {
    const attackState = withTrigger(withFireHand(combat('attack-consume')), { uid: 1, trigger: burnOnAttack });
    const attack = useConsume(attackState, 4, attackState.zones.hand[0]!);
    expect(attack.events).toContainEqual({ type: 'turnTriggerFired', trigger: 'burn-on-attack', hook: 'onAttackSkillResolved' });
    expect(burn(attack.state)).toBe(1);

    const utilityState = withTrigger(withFireHand(combat('utility-consume')), { uid: 1, trigger: burnOnAttack });
    const utility = useConsume(utilityState, 5, utilityState.zones.hand[0]!);
    expect(utility.events.some((event) => event.type === 'turnTriggerFired')).toBe(false);
    expect(burn(utility.state)).toBe(0);
  });

  it('does not recursively fire onDamageDealt for damage created by a trigger effect', () => {
    const state = withTrigger(combat('loop'), { uid: 1, trigger: damageOnDamage });
    const result = useFlip(place(state, 1), 1);

    expect(result.events.filter((event) => event.type === 'turnTriggerFired')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'damageDealt' && event.source === 'skill')).toHaveLength(2);
    expect(result.state.enemies[0]?.hp).toBe(95);
  });

  it('expires all turn triggers at turn end and allows duplicate triggers to fire independently', () => {
    let state = withTrigger(combat('duplicates'), { uid: 1, trigger: burnOnDamage });
    state = withTrigger(state, { uid: 2, trigger: burnOnDamage });
    const attack = useFlip(place(state, 1), 1);
    expect(attack.events.filter((event) => event.type === 'turnTriggerFired')).toHaveLength(2);
    expect(burn(attack.state)).toBe(2);

    const ended = step(attack.state, { type: 'endTurn' }, testDb());
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.events).toContainEqual({ type: 'turnTriggersExpired', count: 2 });
    expect(ended.state.turnTriggers).toHaveLength(0);
  });

  it('previews addTurnTrigger without adding a new axis or mutating state', () => {
    const state = place(combat('preview'), 0);
    const before = JSON.stringify(state);
    const preview = previewFlip(state, slot(0), testDb());

    expect(Object.keys(preview.byAxis)).toEqual(['damage', 'block', 'selfDamage', 'burn', 'coinsCreated']);
    expect(preview.expected).toEqual({ damage: 0, block: 0, selfDamage: 0, burn: 0, coinsCreated: 0 });
    expect(JSON.stringify(state)).toBe(before);
    expect(state.turnTriggers).toHaveLength(0);
  });

  // P3.3 감사 결정: 종료 판정이 훅보다 우선한다 (P5 미시 규칙 > §12 "피해 여부 무관" 자구 —
  // 후자는 0피해 취지). 치명 해결은 onAttackSkillResolved를 발동시키지 않는다.
  it('does not fire onAttackSkillResolved when the resolution is lethal (terminal-first)', () => {
    const armed = useFlip(place(withFlips(combat(), ['heads', 'heads']), 0), 0);
    let state = armed.state;
    // 적 HP를 4로 낮춰 strike(피해 4)가 치명이 되게 한다
    state = {
      ...state,
      enemies: state.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, hp: 4 } : enemy
      )
    };
    const lethal = useFlip(place(withFlips(state, ['tails']), 1), 1);

    expect(lethal.state.phase).toBe('victory');
    expect(
      lethal.events.filter((event) => event.type === 'turnTriggerFired')
    ).toHaveLength(0);
  });

  // 트리거 효과의 피해가 마지막 적을 죽이면 그 뒤 원자는 적용되지 않는다 (미시 종료 규칙 골든)
  it('stops remaining trigger atoms once a trigger damage atom is lethal', () => {
    const db = testDb();
    let state = combat('trigger-lethal-mid');
    // 상태 주입: [피해 1 → 화상 5] 순서의 onDamageDealt 트리거 — 피해 원자가 치명이 되게 구성
    state = {
      ...state,
      turnTriggers: [
        {
          uid: 999,
          trigger: {
            id: 'kill-then-burn',
            hook: 'onDamageDealt' as const,
            effects: [
              { kind: 'damage' as const, amount: 1 },
              { kind: 'applyStatus' as const, status: 'burn' as const, stacks: 5, to: 'target' as const }
            ]
          }
        }
      ] as CombatState['turnTriggers'],
      enemies: state.enemies.map((enemy, index) =>
        // strike 피해 4 + 트리거 피해 1 = 정확히 치명
        index === 0 ? { ...enemy, hp: 5 } : enemy
      )
    };
    const kill = useFlip(place(withFlips(state, ['tails']), 1), 1, db);

    expect(kill.state.phase).toBe('victory');
    // 트리거의 후속 화상 원자가 죽은 적에게 적용되지 않았다
    expect(statusStacks(kill.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(0);
  });

  it('replays byte-identical events for the same seed and command sequence', () => {
    const run = () => {
      let state = withFlips(combat('deterministic'), ['heads', 'heads']);
      const events = [];
      const first = step(place(state, 0), { type: 'useFlipSkill', slot: slot(0), target: 0 }, testDb());
      if (!first.ok) throw new Error(first.error);
      events.push(...first.events);
      state = first.state;
      const second = useFlip(place(state, 1), 1);
      events.push(...second.events);
      return JSON.stringify({ state: second.state, events });
    };

    expect(run()).toBe(run());
  });

  it('keeps zone ledger invariants across 200 seeds with trigger fixtures', () => {
    const db = testDb();
    for (let seed = 0; seed < 200; seed += 1) {
      let state = combat(`fuzz-${seed}`);
      let expectedCoins = Object.keys(state.coins).length;
      for (let stepIndex = 0; stepIndex < 60 && state.phase === 'player'; stepIndex += 1) {
        const command = legalCommands(state, db)[stepIndex % legalCommands(state, db).length];
        if (command === undefined) break;
        const result = step(state, command, db);
        if (!result.ok) throw new Error(`${seed}:${stepIndex}:${result.error}`);
        state = result.state;
        expectedCoins += result.events.filter((event) => event.type === 'coinCreated').length;
        expect(zoneCoinCount(state.zones)).toBe(Object.keys(state.coins).length);
        expect(Object.keys(state.coins)).toHaveLength(expectedCoins);
        expect(state.player.hp).toBeGreaterThanOrEqual(0);
        expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
        expect(state.player.block).toBeGreaterThanOrEqual(0);
        for (const enemy of state.enemies) {
          expect(enemy.hp).toBeGreaterThanOrEqual(0);
          expect(enemy.hp).toBeLessThanOrEqual(enemy.maxHp);
          expect(enemy.block).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
