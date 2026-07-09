import { describe, expect, it } from 'vitest';

import type { Rng, RngSnapshot } from '../rng';
import type { CoinDefId, CoinUid, SkillId, SlotId } from '../ids';
import type { ContentDb } from '../content-types';
import { createCombat, step } from './reducer';
import { legalCommands } from './commands';
import type { Command } from './commands';
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
      if (face === undefined) {
        throw new Error('scripted flip exhausted');
      }
      index += 1;
      return face;
    },
    shuffle: <T>(xs: readonly T[]) => [...xs],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

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
      id: id('raider'),
      name: '약탈자',
      maxHp: 75,
      intents: [
        { id: 'slam', actions: [{ kind: 'attack', damage: 11 }] },
        { id: 'double', actions: [{ kind: 'attack', damage: 4 }, { kind: 'attack', damage: 4 }] }
      ]
    }
  },
  characters: {
    warrior: {
      id: id('warrior'),
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

const replaceFlipRng = (state: CombatState, faces: readonly ('heads' | 'tails')[]): CombatState => ({
  ...state,
  rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
});

const firstHandCoin = (state: CombatState): CoinUid => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing hand coin');
  return coin;
};

const useFirstCoin = (state: CombatState, slotIndex: number, target = 0) => {
  const placed = step(state, { type: 'placeCoin', coin: firstHandCoin(state), slot: slot(slotIndex) }, testDb());
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slot(slotIndex), target }, testDb());
  if (!used.ok) throw new Error(used.error);
  return used;
};

describe('combat golden traces', () => {
  it('slash deals 10 on heads and 6 on tails', () => {
    const db = testDb();
    const headsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'heads'
    ]);
    expect(useFirstCoin(headsState, 0).state.enemies[0]?.hp).toBe(65);

    const tailsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'tails'
    ]);
    expect(useFirstCoin(tailsState, 0).state.enemies[0]?.hp).toBe(69);
  });

  it('guard gains 5 on heads and 8 on tails', () => {
    const db = testDb();
    const headsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'heads'
    ]);
    expect(useFirstCoin(headsState, 1).state.player.block).toBe(5);

    const tailsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'tails'
    ]);
    expect(useFirstCoin(tailsState, 1).state.player.block).toBe(8);
  });
});

describe('combat determinism and D0', () => {
  it('replays identical events for the same seed and commands', () => {
    const db = testDb();
    const run = () => {
      let state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'same-seed');
      const coin = firstHandCoin(state);
      const commands: Command[] = [
        { type: 'placeCoin', coin, slot: slot(0) },
        { type: 'useFlipSkill', slot: slot(0), target: 0 },
        { type: 'endTurn' }
      ];
      return commands.flatMap((cmd) => {
        const result = step(state, cmd, db);
        expect(result.ok).toBe(true);
        if (!result.ok) return [];
        state = result.state;
        return result.events;
      });
    };

    expect(run()).toEqual(run());
  });

  it('rejects same skill twice and fourth skill use, then resets next turn', () => {
    const db = testDb();
    let state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'd0'), [
      'heads',
      'heads',
      'heads'
    ]);
    const first = useFirstCoin(state, 0);
    state = first.state;

    const sameSkill = step(state, { type: 'placeCoin', coin: firstHandCoin(state), slot: slot(0) }, db);
    expect(sameSkill.ok && step(sameSkill.state, { type: 'useFlipSkill', slot: slot(0), target: 0 }, db).ok).toBe(
      false
    );

    const second = useFirstCoin(state, 1);
    state = second.state;
    state.slots[2] = { skillId: id<SkillId>('slash'), usedThisTurn: false, usedThisCombat: false };
    state.slots[3] = { skillId: id<SkillId>('guard'), usedThisTurn: false, usedThisCombat: false };
    state = useFirstCoin(state, 2).state;
    const fourthPlaced = step(state, { type: 'placeCoin', coin: firstHandCoin(state), slot: slot(3) }, db);
    expect(fourthPlaced.ok).toBe(true);
    if (fourthPlaced.ok) {
      expect(step(fourthPlaced.state, { type: 'useFlipSkill', slot: slot(3), target: 0 }, db).ok).toBe(false);
    }

    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.state.skillUsesThisTurn).toBe(0);
      expect(ended.state.slots.every((s) => !s.usedThisTurn)).toBe(true);
    }
  });
});

describe('draw and win loss', () => {
  it('draws 5, reshuffles discard when draw is depleted, and permits partial draw', () => {
    const db = testDb();
    let state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'draw');
    expect(state.zones.hand).toHaveLength(5);

    state = {
      ...state,
      zones: { ...state.zones, hand: [], draw: [], discard: [1 as CoinUid, 2 as CoinUid, 3 as CoinUid], exhausted: [] }
    };
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.state.zones.hand).toHaveLength(3);
    }
  });

  it('ends on enemy hp zero, player hp zero, and checks after each atom', () => {
    const db = testDb();
    const state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'win'), [
      'heads'
    ]);
    state.enemies[0]!.hp = 10;
    expect(useFirstCoin(state, 0).state.phase).toBe('victory');

    const losing = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'loss');
    const lost = step({ ...losing, player: { ...losing.player, hp: 1 } }, { type: 'endTurn' }, db);
    expect(lost.ok).toBe(true);
    if (lost.ok) expect(lost.state.phase).toBe('defeat');
  });
});

describe('combat fuzz smoke', () => {
  it('keeps core invariants for 100 deterministic games', () => {
    const db = testDb();
    for (let game = 0; game < 100; game += 1) {
      let state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, `fuzz-${game}`);
      for (let i = 0; i < 50 && state.phase === 'player'; i += 1) {
        const legal = legalCommands(state, db);
        const cmd =
          legal.find((candidate) => candidate.type === 'useFlipSkill') ??
          legal.find((candidate) => candidate.type === 'placeCoin') ??
          ({ type: 'endTurn' } as Command);
        const result = step(state, cmd, db);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
        expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
        expect(state.player.block).toBeGreaterThanOrEqual(0);
        expect(Object.keys(state.coins)).toHaveLength(10);
      }
    }
  });
});
