import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import { legalCommands } from './commands';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

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

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' },
    mana: { id: id<CoinDefId>('mana'), element: 'mana' }
  },
  skills: {
    furnace: {
      id: id<SkillId>('furnace'),
      name: '용광로',
      type: 'flip',
      rarity: 'advanced',
      tags: ['attack', 'utility'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'grantElement', element: 'fire', scope: 'chooseBasicInHand' }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
    },
    'flame-rampage': {
      id: id<SkillId>('flame-rampage'),
      name: '화염 폭주',
      type: 'flip',
      rarity: 'rare',
      tags: ['utility'],
      targetType: 'self',
      oncePerCombat: true,
      cost: 1,
      base: [{ kind: 'grantElement', element: 'fire', scope: 'allBasicInHand' }]
    }
  },
  enemies: {
    raider: {
      id: id<EnemyDefId>('raider'),
      name: '약탈자',
      maxHp: 75,
      intents: [{ id: 'slam', actions: [{ kind: 'attack', damage: 11 }] }]
    }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: '전사',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [id<SkillId>('furnace'), id<SkillId>('flame-rampage')],
      trait: { id: 'none', name: '없음', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const withFaces = (state: CombatState, faces: readonly ('heads' | 'tails')[]): CombatState => ({
  ...state,
  rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
});

const combat = (): CombatState => createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('raider')] }, testDb(), 'furnace');

const withHandDefs = (state: CombatState, defs: readonly string[]): CombatState => {
  const suppliedCount = Math.max(0, defs.length - state.zones.hand.length);
  const supplied = state.zones.draw.slice(0, suppliedCount);
  const hand = [...state.zones.hand, ...supplied];
  const updates = Object.fromEntries(
    defs.map((defId, index) => {
      const coin = hand[index];
      if (coin === undefined) throw new Error('missing hand coin');
      return [Number(coin), { ...state.coins[Number(coin)]!, defId: id<CoinDefId>(defId) }];
    })
  );
  return {
    ...state,
    zones: { ...state.zones, hand, draw: state.zones.draw.slice(suppliedCount) },
    coins: { ...state.coins, ...updates }
  };
};

const placeFirst = (state: CombatState, slotIndex = 0): CombatState => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing cost coin');
  const placed = step(state, { type: 'placeCoin', coin, slot: slot(slotIndex) }, testDb());
  if (!placed.ok) throw new Error(placed.error);
  return placed.state;
};

describe('furnace chooseBasicInHand', () => {
  it('grants fire only to the chosen basic coin in hand', () => {
    const state = placeFirst(withHandDefs(withFaces(combat(), ['heads']), ['basic', 'basic', 'basic', 'fire', 'mana']));
    const chosen = state.zones.hand[1];
    if (chosen === undefined) throw new Error('missing chosen coin');

    const result = step(state, { type: 'useFlipSkill', slot: slot(0), target: 0, chosen: [chosen] }, testDb());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.enemies[0]?.hp).toBe(71);
    expect(result.events).toContainEqual({ type: 'elementGranted', coins: [chosen], element: 'fire' });
    expect(result.state.coins[Number(chosen)]?.grants).toEqual(['fire']);
    expect(result.state.zones.hand.filter((coin) => result.state.coins[Number(coin)]?.grants.includes('fire'))).toEqual([chosen]);
  });

  it.each([
    ['elemental coin', (state: CombatState) => [state.zones.hand[2]!]],
    ['coin outside hand', (state: CombatState) => [state.zones.draw[0]!]],
    ['two coins', (state: CombatState) => [state.zones.hand[0]!, state.zones.hand[1]!]],
    ['empty chosen', () => []],
    ['omitted chosen', () => undefined]
  ])('rejects %s chosen input when a basic coin exists', (_label, choose) => {
    const state = placeFirst(withHandDefs(combat(), ['basic', 'basic', 'basic', 'fire', 'mana']));

    const result = step(state, { type: 'useFlipSkill', slot: slot(0), target: 0, chosen: choose(state) }, testDb());

    expect(result.ok).toBe(false);
  });

  it('allows omitted chosen when no basic coin is in hand and still resolves damage', () => {
    const state = placeFirst(withHandDefs(withFaces(combat(), ['heads']), ['fire', 'fire', 'mana', 'fire', 'mana']));

    const result = step(state, { type: 'useFlipSkill', slot: slot(0), target: 0 }, testDb());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.enemies[0]?.hp).toBe(71);
    expect(result.events.some((event) => event.type === 'elementGranted')).toBe(false);
  });

  it('auto-suggests the first basic coin in hand deterministically', () => {
    const state = placeFirst(withHandDefs(combat(), ['basic', 'fire', 'basic', 'basic', 'mana']));
    const expected = state.zones.hand[1];
    if (expected === undefined) throw new Error('missing expected chosen coin');

    const first = legalCommands(state, testDb()).filter((command) => command.type === 'useFlipSkill');
    const second = legalCommands(state, testDb()).filter((command) => command.type === 'useFlipSkill');

    expect(first).toEqual([{ type: 'useFlipSkill', slot: slot(0), target: 0, chosen: [expected] }]);
    expect(second).toEqual(first);
  });

  it('keeps allBasicInHand flame-rampage behavior unchanged', () => {
    const state = placeFirst(withHandDefs(combat(), ['basic', 'basic', 'basic', 'fire', 'mana']), 1);
    const [basicOne, basicTwo, fire, mana] = state.zones.hand;
    if (basicOne === undefined || basicTwo === undefined || fire === undefined || mana === undefined) {
      throw new Error('missing rampage hand');
    }

    const result = step(state, { type: 'useFlipSkill', slot: slot(1) }, testDb());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.events).toContainEqual({ type: 'elementGranted', coins: [basicOne, basicTwo], element: 'fire' });
    expect(result.state.coins[Number(basicOne)]?.grants).toEqual(['fire']);
    expect(result.state.coins[Number(basicTwo)]?.grants).toEqual(['fire']);
    expect(result.state.coins[Number(fire)]?.grants).toEqual([]);
    expect(result.state.coins[Number(mana)]?.grants).toEqual([]);
  });
});
