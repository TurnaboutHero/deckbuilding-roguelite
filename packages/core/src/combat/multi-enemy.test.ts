import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import { legalCommands } from './commands';
import type { Command } from './commands';
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
    fire: {
      id: id<CoinDefId>('fire'),
      element: 'fire',
      proc: {
        face: 'heads',
        effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }]
      }
    }
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
      base: [{ kind: 'damage', amount: 6 }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
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
    focus: {
      id: id<SkillId>('focus'),
      name: 'Focus',
      type: 'flip',
      rarity: 'common',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: []
    },
    recoil: {
      id: id<SkillId>('recoil'),
      name: 'Recoil',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'selfDamage', amount: 99 }]
    }
  },
  enemies: {
    left: {
      id: id<EnemyDefId>('left'),
      name: 'Left',
      maxHp: 20,
      intents: [
        { id: 'left-attack', actions: [{ kind: 'attack', damage: 3 }] },
        { id: 'left-next', actions: [{ kind: 'attack', damage: 4 }] }
      ]
    },
    right: {
      id: id<EnemyDefId>('right'),
      name: 'Right',
      maxHp: 30,
      intents: [
        { id: 'right-attack', actions: [{ kind: 'attack', damage: 5 }] },
        { id: 'right-next', actions: [{ kind: 'block', amount: 2 }] }
      ]
    }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: 'Warrior',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [
        id<SkillId>('slash'),
        id<SkillId>('guard'),
        id<SkillId>('focus'),
        id<SkillId>('slash'),
        id<SkillId>('guard'),
        id<SkillId>('recoil')
      ],
      trait: { id: 'none', name: 'None', hook: 'combatStart', effects: [] }
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

const withHandDefs = (state: CombatState, defs: readonly string[]): CombatState => ({
  ...state,
  coins: {
    ...state.coins,
    ...Object.fromEntries(
      defs.map((defId, index) => {
        const coin = state.zones.hand[index];
        if (coin === undefined) throw new Error('missing hand coin');
        return [Number(coin), { ...state.coins[Number(coin)]!, defId: id<CoinDefId>(defId) }];
      })
    )
  }
});

const placeFirstCoin = (state: CombatState, slotIndex: number, db: ContentDb): CombatState => {
  const placed = step(state, { type: 'placeCoin', coin: firstHandCoin(state), slot: slot(slotIndex) }, db);
  if (!placed.ok) throw new Error(placed.error);
  return placed.state;
};

const useFirstCoin = (
  state: CombatState,
  slotIndex: number,
  target: number | undefined,
  db: ContentDb
): ReturnType<typeof step> => {
  const placed = placeFirstCoin(state, slotIndex, db);
  return step(placed, { type: 'useFlipSkill', slot: slot(slotIndex), target }, db);
};

const twoEnemyCombat = (db: ContentDb, seed: string): CombatState =>
  createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('left'), id<EnemyDefId>('right')] }, db, seed);

describe('multi-enemy combat harness', () => {
  it('creates two enemies with initial intents and independent unit state', () => {
    const db = testDb();
    const state = twoEnemyCombat(db, 'two-enemy-create');

    expect(state.enemies).toHaveLength(2);
    expect(state.enemies[0]).toMatchObject({
      defId: 'left',
      hp: 20,
      maxHp: 20,
      block: 0,
      statuses: {},
      intent: { id: 'left-attack' },
      intentIndex: 0
    });
    expect(state.enemies[1]).toMatchObject({
      defId: 'right',
      hp: 30,
      maxHp: 30,
      block: 0,
      statuses: {},
      intent: { id: 'right-attack' },
      intentIndex: 0
    });

    const changed = {
      ...state,
      enemies: state.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, hp: 7, block: 2, statuses: { burn: 1 } } : enemy
      )
    };
    expect(changed.enemies[0]).toMatchObject({ hp: 7, block: 2, statuses: { burn: 1 } });
    expect(changed.enemies[1]).toMatchObject({ hp: 30, block: 0, statuses: {} });
  });

  it('damages only the selected living enemy and rejects a dead target', () => {
    const db = testDb();
    const hitRight = useFirstCoin(replaceFlipRng(twoEnemyCombat(db, 'target-right'), ['tails']), 0, 1, db);
    expect(hitRight.ok).toBe(true);
    if (!hitRight.ok) return;
    expect(hitRight.state.enemies.map((enemy) => enemy.hp)).toEqual([20, 24]);

    const hitLeft = useFirstCoin(replaceFlipRng(twoEnemyCombat(db, 'target-left'), ['tails']), 0, 0, db);
    expect(hitLeft.ok).toBe(true);
    if (!hitLeft.ok) return;
    expect(hitLeft.state.enemies.map((enemy) => enemy.hp)).toEqual([14, 30]);

    const deadLeft = replaceFlipRng(
      { ...hitLeft.state, enemies: hitLeft.state.enemies.map((enemy, index) => (index === 0 ? { ...enemy, hp: 0 } : enemy)) },
      ['tails']
    );
    const rejected = useFirstCoin(deadLeft, 3, 0, db);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toBe('target enemy is not alive');
  });

  it('routes a self-target fire coin proc to the first alive enemy when enemy 0 is dead', () => {
    const db = testDb();
    const state = withHandDefs(replaceFlipRng(twoEnemyCombat(db, 'first-alive-proc'), ['heads']), ['fire']);
    const enemy0Dead = {
      ...state,
      enemies: state.enemies.map((enemy, index) => (index === 0 ? { ...enemy, hp: 0 } : enemy))
    };

    const focused = useFirstCoin(enemy0Dead, 2, undefined, db);
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(focused.state.enemies[0]?.statuses.burn ?? 0).toBe(0);
    expect(focused.state.enemies[1]?.statuses.burn).toBe(1);
    expect(focused.events).toContainEqual({
      type: 'statusApplied',
      target: { type: 'enemy', index: 1 },
      status: 'burn',
      stacks: 1
    });
  });

  it('runs enemy phase left-to-right, clears per-enemy block, ticks burn independently, and reveals surviving intents', () => {
    const db = testDb();
    const state = {
      ...twoEnemyCombat(db, 'enemy-phase-order'),
      enemies: [
        { ...twoEnemyCombat(db, 'enemy-phase-order').enemies[0]!, hp: 1, block: 7, statuses: { burn: 2 } },
        { ...twoEnemyCombat(db, 'enemy-phase-order').enemies[1]!, hp: 10, block: 9, statuses: { burn: 3 } }
      ]
    };

    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;

    expect(ended.state.player.hp).toBe(62);
    expect(ended.state.enemies[0]).toMatchObject({ hp: 0, block: 0, statuses: { burn: 1 } });
    expect(ended.state.enemies[1]).toMatchObject({ hp: 7, block: 0, statuses: { burn: 2 }, intent: { id: 'right-next' } });
    expect(ended.state.phase).toBe('player');

    expect(ended.events.filter((event) => event.type === 'blockCleared')).toEqual([
      { type: 'blockCleared', target: { type: 'enemy', index: 0 }, amount: 7 },
      { type: 'blockCleared', target: { type: 'enemy', index: 1 }, amount: 9 }
    ]);
    expect(ended.events.filter((event) => event.type === 'damageDealt' && event.source === 'enemy')).toEqual([
      { type: 'damageDealt', target: { type: 'player' }, amount: 3, blocked: 0, source: 'enemy' },
      { type: 'damageDealt', target: { type: 'player' }, amount: 5, blocked: 0, source: 'enemy' }
    ]);
    expect(ended.events.filter((event) => event.type === 'statusTicked' && event.target.type === 'enemy')).toEqual([
      { type: 'statusTicked', target: { type: 'enemy', index: 0 }, status: 'burn', amount: 2, remaining: 1 },
      { type: 'statusTicked', target: { type: 'enemy', index: 1 }, status: 'burn', amount: 3, remaining: 2 }
    ]);
    expect(ended.events.filter((event) => event.type === 'intentRevealed')).toEqual([
      { type: 'intentRevealed', enemy: 1, intent: db.enemies.right!.intents[1]! }
    ]);
  });

  it('requires all enemies to reach 0 for victory and preserves defeat priority when player death prevents a lethal burn win', () => {
    const db = testDb();
    const oneLow = {
      ...replaceFlipRng(twoEnemyCombat(db, 'kill-one'), ['tails']),
      enemies: twoEnemyCombat(db, 'kill-one').enemies.map((enemy, index) => (index === 0 ? { ...enemy, hp: 6 } : enemy))
    };
    const killedOne = useFirstCoin(oneLow, 0, 0, db);
    expect(killedOne.ok).toBe(true);
    if (!killedOne.ok) return;
    expect(killedOne.state.enemies.map((enemy) => enemy.hp)).toEqual([0, 30]);
    expect(killedOne.state.phase).toBe('player');

    const secondLow = {
      ...replaceFlipRng(killedOne.state, ['tails']),
      enemies: killedOne.state.enemies.map((enemy, index) => (index === 1 ? { ...enemy, hp: 6 } : enemy))
    };
    const victory = useFirstCoin(secondLow, 3, 1, db);
    expect(victory.ok).toBe(true);
    if (!victory.ok) return;
    expect(victory.state.phase).toBe('victory');

    const lethalForBothAfterEnemyAction = {
      ...twoEnemyCombat(db, 'defeat-priority'),
      player: { ...twoEnemyCombat(db, 'defeat-priority').player, hp: 1 },
      enemies: twoEnemyCombat(db, 'defeat-priority').enemies.map((enemy) => ({ ...enemy, hp: 1, statuses: { burn: 1 } }))
    };
    const defeated = step(lethalForBothAfterEnemyAction, { type: 'endTurn' }, db);
    expect(defeated.ok).toBe(true);
    if (!defeated.ok) return;
    expect(defeated.state.phase).toBe('defeat');
    expect(defeated.events).toContainEqual({ type: 'combatEnded', result: 'defeat', turns: 1 });
    expect(defeated.events).not.toContainEqual({ type: 'combatEnded', result: 'victory', turns: 1 });
  });

  it('replays identical events for the same seed and commands with two enemies', () => {
    const db = testDb();
    const run = () => {
      let state = replaceFlipRng(twoEnemyCombat(db, 'same-two-enemy-seed'), ['heads', 'tails']);
      const first = firstHandCoin(state);
      const commands: Command[] = [
        { type: 'placeCoin', coin: first, slot: slot(0) },
        { type: 'useFlipSkill', slot: slot(0), target: 1 },
        { type: 'endTurn' }
      ];
      return commands.flatMap((command) => {
        const result = step(state, command, db);
        expect(result.ok).toBe(true);
        if (!result.ok) return [];
        state = result.state;
        return result.events;
      });
    };

    expect(run()).toEqual(run());
  });

  it('documents legalCommands target behavior for multi-enemy single-target skills', () => {
    const db = testDb();
    const state = placeFirstCoin(twoEnemyCombat(db, 'legal-targets'), 0, db);
    const offered = legalCommands(state, db).filter(
      (command): command is Extract<Command, { type: 'useFlipSkill' }> => command.type === 'useFlipSkill' && command.slot === slot(0)
    );

    // PROGRESS M1 deferred "다중 적 타겟 UI (M5+)": command generation currently exposes only target 0.
    expect(offered).toEqual([{ type: 'useFlipSkill', slot: slot(0), target: 0 }]);
    expect(offered.some((command) => command.target === 1)).toBe(false);
  });
});
