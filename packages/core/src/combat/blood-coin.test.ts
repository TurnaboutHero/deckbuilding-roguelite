import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, Face, SkillId, SlotId } from '../ids';
import { rngFrom, seedFromString } from '../rng';
import { legalCommands } from './commands';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const db = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    blood: {
      id: id<CoinDefId>('blood'),
      element: 'blood',
      procs: {
        heads: [{ kind: 'coinDamage', amount: 1 }],
        tails: [
          { kind: 'loseHp', amount: 1 },
          { kind: 'coinDamage', amount: 2 }
        ]
      }
    }
  },
  skills: {
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
    guard: {
      id: id<SkillId>('guard'),
      name: 'Guard',
      type: 'flip',
      rarity: 'common',
      tags: ['defense'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'block', amount: 2 }]
    },
    sweep: {
      id: id<SkillId>('sweep'),
      name: 'Sweep',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'all-enemies',
      cost: 1,
      base: [{ kind: 'damage', amount: 1 }]
    },
    feast: {
      id: id<SkillId>('feast'),
      name: 'Feast',
      type: 'consume',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      consume: { element: 'blood', count: 1 },
      effects: [{ kind: 'damage', amount: 5 }]
    }
  },
  enemies: {
    dummy: {
      id: id<EnemyDefId>('dummy'),
      name: 'Dummy',
      maxHp: 20,
      intents: [{ id: 'wait', actions: [{ kind: 'attack', damage: 0 }] }]
    }
  },
  characters: {
    tester: {
      id: id<CharacterId>('tester'),
      name: 'Tester',
      maxHp: 20,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('blood')),
      startingSkills: [id<SkillId>('strike')],
      trait: { id: 'none', name: 'None', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (skills: string[], enemyCount = 1): CombatState =>
  createCombat(
    {
      character: id<CharacterId>('tester'),
      enemies: Array.from({ length: enemyCount }, () => id<EnemyDefId>('dummy')),
      equippedSkills: skills.map((skillId) => id<SkillId>(skillId)),
      bag: Array.from({ length: 10 }, () => id<CoinDefId>('blood'))
    },
    db(),
    'blood-coin-contract'
  );

const withFace = (state: CombatState, face: Face): CombatState => {
  const scripted = rngFrom(seedFromString(`blood-${face}`));
  return {
    ...state,
    rngImpl: {
      ...state.rngImpl,
      flip: { ...scripted, flip: () => face }
    }
  };
};

const costCoin = (state: CombatState): CoinUid => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing blood coin');
  return coin;
};

describe('blood coin risk/reward contract', () => {
  it('heads deals one designated coin-damage packet separate from skill damage', () => {
    const state = withFace(combat(['strike']), 'heads');
    const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [costCoin(state)], target: 0 }, db());
    if (!result.ok) throw new Error(result.error);

    expect(result.events.filter((event) => event.type === 'damageDealt' && event.target.type === 'enemy')).toEqual([
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 4, blocked: 0, source: 'skill' },
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 1, blocked: 0, source: 'coin' }
    ]);
  });

  it('tails bypasses player block, loses one HP, and deals two coin damage', () => {
    const prepared = withFace(combat(['strike']), 'tails');
    const state = { ...prepared, player: { ...prepared.player, block: 9 } };
    const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [costCoin(state)], target: 0 }, db());
    if (!result.ok) throw new Error(result.error);

    expect(result.state.player).toMatchObject({ hp: 19, block: 9 });
    expect(result.events).toContainEqual({
      type: 'damageDealt',
      target: { type: 'player' },
      amount: 1,
      blocked: 0,
      source: 'self'
    });
    expect(result.events).toContainEqual({
      type: 'damageDealt',
      target: { type: 'enemy', index: 0 },
      amount: 2,
      blocked: 0,
      source: 'coin'
    });
  });

  it('at one HP the tails loss and coin damage fail together while the skill still resolves', () => {
    const prepared = withFace(combat(['strike']), 'tails');
    const state = { ...prepared, player: { ...prepared.player, hp: 1, block: 9 } };
    const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [costCoin(state)], target: 0 }, db());
    if (!result.ok) throw new Error(result.error);

    expect(result.state.player).toMatchObject({ hp: 1, block: 9 });
    expect(result.state.enemies[0]?.hp).toBe(16);
    expect(result.events.some((event) => event.type === 'damageDealt' && event.source === 'coin')).toBe(false);
    expect(result.events.some((event) => event.type === 'damageDealt' && event.source === 'self')).toBe(false);
    expect(result.events).toContainEqual({ type: 'bloodCoinFizzle', coin: expect.any(Number) as CoinUid });
  });

  it('self-target skills reuse the existing explicit enemy designation flow', () => {
    const state = withFace(combat(['guard'], 3), 'heads');
    expect(
      legalCommands(state, db())
        .filter((command) => command.type === 'useImmediateFlipSkill' && command.slot === slot(0) && command.coins[0] === costCoin(state))
        .map((command) => (command.type === 'useImmediateFlipSkill' ? command.target : undefined))
    ).toEqual([0, 1, 2]);

    expect(step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [costCoin(state)] }, db())).toEqual({
      ok: false,
      error: 'target enemy is not alive'
    });
    const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [costCoin(state)], target: 1 }, db());
    if (!result.ok) throw new Error(result.error);
    expect(result.events.filter((event) => event.type === 'damageDealt' && event.source === 'coin')).toEqual([
      { type: 'damageDealt', target: { type: 'enemy', index: 1 }, amount: 1, blocked: 0, source: 'coin' }
    ]);
  });

  it('all-enemy skills hit all with the skill but only the designated enemy with the coin', () => {
    const state = withFace(combat(['sweep'], 3), 'heads');
    expect(
      legalCommands(state, db())
        .filter((command) => command.type === 'useImmediateFlipSkill' && command.slot === slot(0) && command.coins[0] === costCoin(state))
        .map((command) => (command.type === 'useImmediateFlipSkill' ? command.target : undefined))
    ).toEqual([0, 1, 2]);

    const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [costCoin(state)], target: 2 }, db());
    if (!result.ok) throw new Error(result.error);
    expect(result.state.enemies.map((enemy) => enemy.hp)).toEqual([19, 19, 18]);
    expect(result.events.filter((event) => event.type === 'damageDealt' && event.source === 'coin')).toEqual([
      { type: 'damageDealt', target: { type: 'enemy', index: 2 }, amount: 1, blocked: 0, source: 'coin' }
    ]);
  });

  it('consumed blood coins do not flip, self-damage, or deal coin damage', () => {
    const state = combat(['feast']);
    const fuel = state.zones.hand[0];
    if (fuel === undefined) throw new Error('missing blood coin');
    const result = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [fuel], target: 0 }, db());
    if (!result.ok) throw new Error(result.error);

    expect(result.events.some((event) => event.type === 'coinFlipped')).toBe(false);
    expect(result.events.some((event) => event.type === 'damageDealt' && event.source === 'coin')).toBe(false);
    expect(result.events.some((event) => event.type === 'damageDealt' && event.source === 'self')).toBe(false);
    expect(result.state.enemies[0]?.hp).toBe(15);
  });
});
