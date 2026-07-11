import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import { rngFrom, seedFromString } from '../rng';
import { legalCommands } from './commands';
import type { Command } from './commands';
import { createCombat, step, zoneCoinCount } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' }
  },
  skills: {
    slash: {
      id: id<SkillId>('slash'),
      name: 'Slash',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'damage', amount: 6 }]
    },
    guard: {
      id: id<SkillId>('guard'),
      name: 'Guard',
      type: 'flip',
      rarity: 'common',
      tags: ['defense'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'block', amount: 5 }]
    },
    spark: {
      id: id<SkillId>('spark'),
      name: 'Spark',
      type: 'consume',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      consume: { element: 'fire', count: 1 },
      effects: [{ kind: 'damage', amount: 7 }]
    },
    focus: {
      id: id<SkillId>('focus'),
      name: 'Focus',
      type: 'consume',
      rarity: 'common',
      tags: ['utility'],
      targetType: 'self',
      consume: { element: 'fire', count: 1 },
      effects: [{ kind: 'block', amount: 4 }]
    }
  },
  enemies: {
    left: {
      id: id<EnemyDefId>('left'),
      name: 'Left',
      maxHp: 20,
      intents: [{ id: 'left-attack', actions: [{ kind: 'attack', damage: 2 }] }]
    },
    center: {
      id: id<EnemyDefId>('center'),
      name: 'Center',
      maxHp: 24,
      intents: [{ id: 'center-attack', actions: [{ kind: 'attack', damage: 3 }] }]
    },
    right: {
      id: id<EnemyDefId>('right'),
      name: 'Right',
      maxHp: 28,
      intents: [{ id: 'right-attack', actions: [{ kind: 'attack', damage: 4 }] }]
    }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: 'Warrior',
      maxHp: 70,
      startingBag: [
        id<CoinDefId>('fire'),
        id<CoinDefId>('fire'),
        id<CoinDefId>('fire'),
        id<CoinDefId>('basic'),
        id<CoinDefId>('basic'),
        id<CoinDefId>('basic'),
        id<CoinDefId>('basic'),
        id<CoinDefId>('basic'),
        id<CoinDefId>('basic'),
        id<CoinDefId>('basic')
      ],
      startingSkills: [
        id<SkillId>('slash'),
        id<SkillId>('guard'),
        id<SkillId>('spark'),
        id<SkillId>('focus'),
        id<SkillId>('slash'),
        id<SkillId>('spark')
      ],
      trait: { id: 'none', name: 'None', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (
  db: ContentDb,
  seed: string,
  enemies: readonly EnemyDefId[] = [id('left'), id('center'), id('right')]
): CombatState => createCombat({ character: id<CharacterId>('warrior'), enemies: [...enemies] }, db, seed);

const firstHandCoin = (state: CombatState): CoinUid => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing hand coin');
  return coin;
};

const placeFirstCoin = (state: CombatState, slotIndex: number, db: ContentDb): CombatState => {
  const result = step(state, { type: 'placeCoin', coin: firstHandCoin(state), slot: slot(slotIndex) }, db);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

const useFlipTargets = (state: CombatState, slotIndex: number, db: ContentDb): Command[] =>
  legalCommands(state, db).filter((command) => command.type === 'useFlipSkill' && command.slot === slot(slotIndex));

const useConsumeTargets = (state: CombatState, slotIndex: number, db: ContentDb): Command[] =>
  legalCommands(state, db).filter((command) => command.type === 'useConsumeSkill' && command.slot === slot(slotIndex));

describe('multi-target legal commands', () => {
  it('lists all three living enemies for usable flip skills in ascending order', () => {
    const db = testDb();
    const state = placeFirstCoin(combat(db, 'flip-three-targets'), 0, db);

    expect(useFlipTargets(state, 0, db)).toEqual([
      { type: 'useFlipSkill', slot: slot(0), target: 0 },
      { type: 'useFlipSkill', slot: slot(0), target: 1 },
      { type: 'useFlipSkill', slot: slot(0), target: 2 }
    ]);
  });

  it('excludes dead enemies and keeps surviving target indexes', () => {
    const db = testDb();
    const base = combat(db, 'flip-dead-target');
    const state = {
      ...placeFirstCoin(base, 0, db),
      enemies: base.enemies.map((enemy, index) => (index === 1 ? { ...enemy, hp: 0 } : enemy))
    };

    expect(useFlipTargets(state, 0, db)).toEqual([
      { type: 'useFlipSkill', slot: slot(0), target: 0 },
      { type: 'useFlipSkill', slot: slot(0), target: 2 }
    ]);
  });

  it('rejects dead and out-of-range targets before resolving a step', () => {
    const db = testDb();
    const base = combat(db, 'reject-targets');
    const state = {
      ...placeFirstCoin(base, 0, db),
      enemies: base.enemies.map((enemy, index) => (index === 1 ? { ...enemy, hp: 0 } : enemy))
    };

    expect(step(state, { type: 'useFlipSkill', slot: slot(0), target: 1 }, db)).toEqual({
      ok: false,
      error: 'target enemy is not alive'
    });
    expect(step(state, { type: 'useFlipSkill', slot: slot(0), target: 99 }, db)).toEqual({
      ok: false,
      error: 'target enemy is not alive'
    });
  });

  it('lists only the last living enemy immediately before all enemies are defeated', () => {
    const db = testDb();
    const base = combat(db, 'last-living-target');
    const state = {
      ...placeFirstCoin(base, 0, db),
      enemies: base.enemies.map((enemy, index) => (index === 2 ? enemy : { ...enemy, hp: 0 }))
    };

    expect(useFlipTargets(state, 0, db)).toEqual([{ type: 'useFlipSkill', slot: slot(0), target: 2 }]);
  });

  it('applies the same target enumeration to single-enemy consume skills', () => {
    const db = testDb();
    const state = combat(db, 'consume-targets');
    const targetCommands = useConsumeTargets(state, 2, db);
    const selfCommands = useConsumeTargets(state, 3, db);
    const selected = targetCommands[0]?.type === 'useConsumeSkill' ? targetCommands[0].coins : [];

    expect(targetCommands).toEqual([
      { type: 'useConsumeSkill', slot: slot(2), coins: selected, target: 0 },
      { type: 'useConsumeSkill', slot: slot(2), coins: selected, target: 1 },
      { type: 'useConsumeSkill', slot: slot(2), coins: selected, target: 2 }
    ]);
    expect(selfCommands).toEqual([
      { type: 'useConsumeSkill', slot: slot(3), coins: selected, target: undefined }
    ]);
  });

  it('returns deterministic command lists for the same state', () => {
    const db = testDb();
    const state = placeFirstCoin(combat(db, 'deterministic-targets'), 0, db);

    expect(legalCommands(state, db)).toEqual(legalCommands(state, db));
  });

  it('keeps invariants while fuzzing legal commands across multi-enemy fixtures', () => {
    const db = testDb();
    for (let seed = 0; seed < 200; seed += 1) {
      const rng = rngFrom(seedFromString(`multi-target-fuzz-${seed}`));
      const enemies: readonly EnemyDefId[] =
        seed % 2 === 0 ? [id('left'), id('center')] : [id('left'), id('center'), id('right')];
      let state = combat(db, `multi-target-fuzz-${seed}`, enemies);
      for (let stepIndex = 0; stepIndex < 80 && state.phase === 'player'; stepIndex += 1) {
        const legal = legalCommands(state, db);
        const command = legal[rng.int(legal.length)];
        const result = step(state, command!, db);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
        expect(zoneCoinCount(state.zones)).toBe(Object.keys(state.coins).length);
        expect(state.player.hp).toBeGreaterThanOrEqual(0);
        expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
        for (const enemy of state.enemies) {
          expect(enemy.hp).toBeGreaterThanOrEqual(0);
          expect(enemy.hp).toBeLessThanOrEqual(enemy.maxHp);
          expect(enemy.block).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
