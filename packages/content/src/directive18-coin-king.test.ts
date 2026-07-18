import { describe, expect, it } from 'vitest';

import { contentDb, enemies } from './index';

const directive18Enemies = enemies as Record<string, unknown>;

describe('Directive 18 Uncrowned Coin King Aurel content contract', () => {
  it('keeps M18 Marcel royal-tax data byte-equivalent while adding Aurel parameters', () => {
    expect(enemies['fallen-kings-treasurer-marcel']?.royalTax).toEqual({
      denomination: 2,
      deadline: 'endNextPlayerTurn',
      counterfeitCoin: 'counterfeit',
      counterfeitCount: 2,
      defaultShield: 8,
      seizureAfterDefaults: 2,
      seizureIntent: {
        id: 'royal-seizure',
        windup: { turns: 1, revealAtStart: true },
        actions: [
          { kind: 'seizeCustody' },
          { kind: 'attack', damage: 4 },
          { kind: 'resetRoyalTaxDefaults' }
        ]
      }
    });
  });

  it('declares the approved HP, tax/default flow, six-coin vault, and one-default foreclosure', () => {
    expect(directive18Enemies['uncrowned-coin-king-aurel']).toMatchObject({
      id: 'uncrowned-coin-king-aurel',
      maxHp: 180,
      royalVault: {
        capacity: 6,
        blockLostPerRecovery: 4,
        lead: {
          generatedTemporaryElementalCount: 3,
          minRemaining: 1,
          maxWeakensPerTurn: 2,
          maxWeakensPerWindup: 2,
          damageWeakeningThreshold: 16
        },
        atCapacityIntent: {
          id: 'crown-confiscation',
          windup: { turns: 1, revealAtStart: true },
          cancelOn: [
            { kind: 'vaultCoinsRecovered', count: 2 },
            { kind: 'skillDamage', threshold: 10 }
          ],
          actions: [
            { kind: 'attack', damage: 22 },
            { kind: 'createCounterfeit', coin: 'counterfeit', count: 2 },
            { kind: 'returnOldestRoyalVaultCoin', reason: 'crownResolved' }
          ],
          onCancelActions: [{ kind: 'returnOldestRoyalVaultCoin', reason: 'crownCancelled' }]
        }
      },
      royalTax: {
        denomination: 2,
        deadline: 'endNextPlayerTurn',
        counterfeitCount: 1,
        defaultShield: 0,
        paidNextOrdinaryAttackReduction: 2,
        foreclosureIntent: {
          id: 'royal-vault-foreclose',
          windup: { turns: 1, revealAtStart: true },
          actions: [{ kind: 'royalVaultForeclose' }]
        }
      },
      intents: [
        { id: 'royal-tax', actions: [{ kind: 'royalTax', degradedDamage: 8 }] },
        { id: 'royal-strike', actions: [{ kind: 'attack', damage: 10, ordinary: true }] }
      ]
    });
  });

  it('declares phase-two Lead and barrier rules, then phase-three exact seizure and Crown cancellation rules', () => {
    expect(directive18Enemies['uncrowned-coin-king-aurel']).toMatchObject({
      phases: [
        {
          hpBelowFraction: 0.7,
          transitionBeforeAction: true,
          onEnterActions: [
            { kind: 'removeCounterfeits', count: 1 },
            { kind: 'returnOldestRoyalVaultCoin' }
          ],
          intents: [
            {
              id: 'lead-decree',
              windup: { turns: 1, revealAtStart: true },
              actions: [{ kind: 'leadDecree' }]
            },
            { id: 'royal-strike', actions: [{ kind: 'attack', damage: 10, ordinary: true }] },
            { id: 'vault-barrier', actions: [{ kind: 'royalVaultBarrier', blockPerStoredCoin: 3 }] }
          ]
        },
        {
          hpBelowFraction: 0.35,
          transitionBeforeAction: true,
          onEnterActions: [
            { kind: 'clearLeadCoins' },
            { kind: 'returnOldestRoyalVaultCoin' }
          ],
          intents: [
            { id: 'royal-strike', actions: [{ kind: 'attack', damage: 12, ordinary: true }] },
            { id: 'royal-seizure', windup: { turns: 1, revealAtStart: true }, actions: [{ kind: 'royalVaultExactSeizure' }] }
          ]
        }
      ]
    });
    expect(contentDb.validate()).toEqual([]);
  });
});
