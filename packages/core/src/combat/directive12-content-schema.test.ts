import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import { validateContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId } from '../ids';

const id = <T extends string>(value: string) => value as T;

const baseEnemy = (overrides: Partial<EnemyDef> = {}): EnemyDef => ({
  id: id<EnemyDefId>('candidate'),
  name: 'candidate',
  maxHp: 65,
  intents: [{ id: 'idle', actions: [] }],
  ...overrides
});

const content = (enemy: EnemyDef): Omit<ContentDb, 'validate'> => ({
  coins: { basic: { id: id<CoinDefId>('basic'), element: null } },
  skills: {},
  enemies: { [String(enemy.id)]: enemy },
  characters: {
    hero: {
      id: id<CharacterId>('hero'),
      name: 'hero',
      maxHp: 70,
      startingBag: [id<CoinDefId>('basic')],
      startingSkills: [],
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  }
});

describe('Directive 12 Batch B content schema', () => {
  it('accepts the exact M14 ring configuration', () => {
    const db = content(
      baseEnemy({
        roundGrowth: {
          gainPerRound: 1,
          maxStacks: 5,
          damageReductionPerStack: 0.08,
          healMaxHpFractionPerStack: 0.03,
          removeOneAtHpFraction: 0.15,
          removeTwoAtHpFraction: 0.25
        }
      })
    );

    expect(validateContentDb(db)).toEqual([]);
  });

  it('rejects a ring configuration that can reduce all damage', () => {
    const db = content(
      baseEnemy({
        roundGrowth: {
          gainPerRound: 1,
          maxStacks: 5,
          damageReductionPerStack: 0.2,
          healMaxHpFractionPerStack: 0.03,
          removeOneAtHpFraction: 0.15,
          removeTwoAtHpFraction: 0.25
        }
      })
    );

    expect(validateContentDb(db)).toContain('enemy candidate roundGrowth: damageReductionPerStack must keep total reduction below 1');
  });

  it('rejects an unused-element punishment without a positive threshold', () => {
    const db = content(
      baseEnemy({
        playerTurnEndPunishment: { kind: 'unusedElementalCoinsAtLeast', threshold: 0, status: 'frostbite', stacks: 1 }
      })
    );

    expect(validateContentDb(db)).toContain('enemy candidate playerTurnEndPunishment: threshold must be a positive integer');
  });
});
