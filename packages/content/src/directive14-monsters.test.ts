import { describe, expect, it } from 'vitest';

import { generateRunGraph } from '@game/core';

import { contentDb, enemies } from './index';

describe('Directive 14 Batch D monster content', () => {
  it('defines M09 black pouch thief with a telegraphed custody seizure and repeated strike', () => {
    expect(enemies['black-pouch-coin-thief']).toMatchObject({
      maxHp: 44,
      coinSeizure: { target: 'mostNumerousPublicElementInHand', maxCoins: 2, capFraction: 0.5 },
      intents: [
        {
          id: 'seize-purse',
          windup: { turns: 1, revealAtStart: true },
          actions: [{ kind: 'seizeCustody' }, { kind: 'attack', damage: 4 }]
        },
        { id: 'cutpurse-strike', actions: [{ kind: 'attack', damage: 6 }] }
      ]
    });
  });

  it('defines M10 grey tower sealer with a non-attacking cast and repeated bolts', () => {
    expect(enemies['grey-tower-sealer']).toMatchObject({
      maxHp: 46,
      skillSeal: { recentPlayerTurns: 2, turns: 2, uniqueSkillEffectMultiplier: 0.75 },
      intents: [
        { id: 'cast-seal', actions: [{ kind: 'sealRecentSkill' }] },
        { id: 'arcane-bolt', actions: [{ kind: 'attack', damage: 7 }] },
        { id: 'greater-bolt', actions: [{ kind: 'attack', damage: 5 }] }
      ]
    });
  });

  it('keeps Batch D schema-valid and limits its encounters to Acts 2 and 3 with at most three enemies', () => {
    expect(contentDb.validate()).toEqual([]);
    const batchD = new Set(['black-pouch-coin-thief', 'grey-tower-sealer']);
    const seen = new Set<string>();

    for (let seed = 0; seed < 160; seed += 1) {
      const graph = generateRunGraph(`directive14-batch-d-${seed}`, contentDb);
      for (const [layerIndex, layer] of graph.layers.entries()) {
        for (const node of layer) {
          if (node.kind !== 'combat' || node.encounter === undefined) continue;
          expect(node.encounter.length).toBeLessThanOrEqual(3);
          for (const enemy of node.encounter) {
            if (!batchD.has(String(enemy))) continue;
            expect(layerIndex).toBeGreaterThanOrEqual(10);
            seen.add(String(enemy));
          }
        }
      }
    }

    expect(seen).toEqual(batchD);
  });
});
