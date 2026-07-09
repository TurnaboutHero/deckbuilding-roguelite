import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, SkillId, SlotId } from '../ids';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';
import { previewFlip } from './preview';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null }
  },
  skills: {
    slash: {
      id: id<SkillId>('slash'),
      name: '베기',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'damage', amount: 6 }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
    },
    guard: {
      id: id<SkillId>('guard'),
      name: '방어',
      type: 'flip',
      rarity: 'common',
      tags: ['defense'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'block', amount: 5 }],
      tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
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
      startingSkills: [id<SkillId>('slash'), id<SkillId>('guard')],
      trait: {
        id: 'ember-pouch',
        name: '불씨 주머니',
        hook: 'combatStart',
        effects: []
      }
    }
  },
  validate: () => []
});

const combatWithPlacedCoin = (slotIndex: number): CombatState => {
  const db = testDb();
  const state = createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('raider')] }, db, 'preview');
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing hand coin');
  const placed = step(state, { type: 'placeCoin', coin, slot: slot(slotIndex) }, db);
  if (!placed.ok) throw new Error(placed.error);
  return placed.state;
};

describe('previewFlip', () => {
  it('enumerates slash branches and expected damage', () => {
    const preview = previewFlip(combatWithPlacedCoin(0), slot(0), testDb());

    expect(preview.branches).toHaveLength(2);
    expect(preview.branches.map((branch) => ({ damage: branch.damage, probability: branch.probability }))).toEqual([
      { damage: 10, probability: 0.5 },
      { damage: 6, probability: 0.5 }
    ]);
    expect(preview.expected.damage).toBe(8);
  });

  it('reports guard block range by axis', () => {
    const preview = previewFlip(combatWithPlacedCoin(1), slot(1), testDb());

    expect(preview.byAxis.block).toEqual({ min: 5, max: 8 });
  });

  it('does not mutate the original state or rng snapshot', () => {
    const state = combatWithPlacedCoin(0);
    const before = structuredClone(state);

    previewFlip(state, slot(0), testDb());

    expect(state).toEqual(before);
  });
});
