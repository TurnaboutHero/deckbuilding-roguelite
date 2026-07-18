import { describe, expect, it } from 'vitest';

import { contentDb, enemies } from './index';

describe('Directive 12 Batch B monster content', () => {
  it('defines M11 plague doctor poison injection and plague mist threshold actions', () => {
    expect(enemies['plague-doctor']).toMatchObject({
      maxHp: 50,
      intents: [
        {
          id: 'poison-injection',
          actions: [
            { kind: 'attack', damage: 7 },
            { kind: 'applyStatus', status: 'poison', stacks: 2, requiresLastAttackHpDamage: true }
          ]
        },
        {
          id: 'plague-mist',
          windup: { turns: 1, revealAtStart: true },
          actions: [
            { kind: 'applyStatus', status: 'poison', stacks: 1 },
            { kind: 'applyStatus', status: 'healLock', stacks: 2, requiresPlayerStatus: { status: 'poison', atLeast: 5 } }
          ]
        }
      ]
    });
  });

  it('defines M12 white wraith cold touch, winter-hand windup, and four-coin punishment', () => {
    expect(enemies['white-wraith']).toMatchObject({
      maxHp: 48,
      playerTurnEndPunishment: { kind: 'unusedElementalCoinsAtLeast', threshold: 4, status: 'frostbite', stacks: 1 },
      intents: [
        {
          id: 'cold-touch',
          actions: [{ kind: 'attack', damage: 7 }, { kind: 'applyStatus', status: 'frostbite', stacks: 1 }]
        },
        {
          id: 'winters-hand',
          windup: { turns: 1, revealAtStart: true },
          actions: [{ kind: 'applyStatus', status: 'frostbite', stacks: 2 }]
        }
      ]
    });
  });

  it('defines M14 ancient treant with the fixed five-ring progression values', () => {
    expect(enemies['ancient-treant']).toMatchObject({
      maxHp: 65,
      roundGrowth: {
        gainPerRound: 1,
        maxStacks: 5,
        damageReductionPerStack: 0.08,
        healMaxHpFractionPerStack: 0.03,
        removeOneAtHpFraction: 0.15,
        removeTwoAtHpFraction: 0.25
      }
    });
  });

  it('keeps the Directive 12 monster content schema-valid', () => {
    expect(contentDb.validate()).toEqual([]);
  });
});
