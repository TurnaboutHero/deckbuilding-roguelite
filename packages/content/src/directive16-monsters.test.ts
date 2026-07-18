import { describe, expect, it } from 'vitest';

import { contentDb, enemies } from './index';

const directive16Enemies = enemies as Record<string, unknown>;

describe('Directive 16 summoned-enemy content contract', () => {
  it('declares M15 Bonebell, its two-skeleton cap within the three-enemy battle limit, and their approved combat values', () => {
    expect(directive16Enemies['mortbell-bonebell-necromancer']).toMatchObject({
      id: 'mortbell-bonebell-necromancer',
      maxHp: 50,
      intents: [
        { id: 'bone-shard', actions: [{ kind: 'attack', damage: 6 }] },
        {
          id: 'raise-skeleton',
          windup: { turns: 1, revealAtStart: true },
          actions: [{ kind: 'summonEnemies', enemy: 'skeleton-servant', maxCount: 2 }]
        }
      ]
    });
    expect(directive16Enemies['skeleton-servant']).toMatchObject({
      id: 'skeleton-servant',
      maxHp: 15,
      intents: [{ id: 'rattle-strike', actions: [{ kind: 'attack', damage: 4 }] }]
    });
  });

  it('declares M16 Eggkeeper, its delayed mud egg, and its hatchling with the approved combat values', () => {
    expect(directive16Enemies['fenmarsh-eggkeeper-witch']).toMatchObject({
      id: 'fenmarsh-eggkeeper-witch',
      maxHp: 55,
      intents: [
        { id: 'marsh-curse', actions: [{ kind: 'attack', damage: 6 }] },
        { id: 'lay-eggs', actions: [{ kind: 'summonEnemies', enemy: 'mud-egg', maxCount: 2 }] },
        { id: 'accelerate-brood', actions: [{ kind: 'accelerateHatching', amount: 1 }] }
      ]
    });
    expect(directive16Enemies['mud-egg']).toMatchObject({
      id: 'mud-egg',
      maxHp: 10,
      hatch: { into: 'marsh-hatchling', turns: 2, delayAtHpFraction: 0.5 },
      intents: [{ id: 'incubate', actions: [{ kind: 'tickHatch' }] }]
    });
    expect(directive16Enemies['marsh-hatchling']).toMatchObject({
      id: 'marsh-hatchling',
      maxHp: 18,
      intents: [{ id: 'marsh-bite', actions: [{ kind: 'attack', damage: 5 }] }]
    });
    expect(contentDb.validate()).toEqual([]);
  });
});
