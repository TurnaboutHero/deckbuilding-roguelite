import { describe, expect, it } from 'vitest';

import type { ContentDb, FlipSkillDef, SkillDef } from '../content-types';
import { validateContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, Face, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import { createCombat, step } from './reducer';
import { previewFlip } from './preview';
import { statusStacks, statusTurns } from './state';
import type { CombatState } from './state';
import { deriveUpgradedSkill } from '../run/run';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const ladderSkill = (value: string, definition: Record<string, unknown>): FlipSkillDef =>
  ({
    id: id<SkillId>(value),
    name: value,
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    ...definition
  }) as unknown as FlipSkillDef;

const basicAttack = ladderSkill('basic-attack', {
  cost: 1,
  successFace: 'heads',
  successLadder: [[], [{ kind: 'damage', amount: 4 }]]
});

const basicBlock = ladderSkill('basic-block', {
  cost: 1,
  tags: ['defense'],
  targetType: 'self',
  successFace: 'tails',
  successLadder: [[], [{ kind: 'block', amount: 4 }]]
});

const flameFist = ladderSkill('flame-fist', {
  cost: 2,
  element: 'fire',
  successFace: 'heads',
  successLadder: [
    [{ kind: 'damage', amount: 2 }],
    [{ kind: 'damage', amount: 4 }, { kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }],
    [{ kind: 'damage', amount: 7 }, { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }]
  ],
  resonance: {
    element: 'fire',
    effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }]
  }
});

const directHit = ladderSkill('direct-hit', {
  cost: 2,
  element: 'fire',
  successFace: 'heads',
  successLadder: [
    [{ kind: 'damage', amount: 1 }],
    [
      { kind: 'damage', amount: 4 },
      { kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'draw', position: 'top', count: 1 }
    ],
    [
      { kind: 'damage', amount: 6 },
      { kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'draw', position: 'top', count: 1 }
    ]
  ]
});

const legacyStrike: FlipSkillDef = {
  id: id<SkillId>('legacy-strike'),
  name: 'legacy-strike',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 2,
  base: [{ kind: 'damage', amount: 2 }],
  heads: { mode: 'per', effects: [{ kind: 'damage', amount: 1 }] }
};

const testDb = (skills: readonly SkillDef[] = [basicAttack, basicBlock, flameFist, directHit, legacyStrike]): ContentDb => {
  const db = {
    coins: {
      basic: { id: id<CoinDefId>('basic'), element: null },
      fire: {
        id: id<CoinDefId>('fire'),
        element: 'fire' as const,
        procs: {
          heads: [{ kind: 'applyStatus' as const, status: 'burn' as const, stacks: 1, to: 'target' as const }],
          tails: [{ kind: 'damage' as const, amount: 1 }]
        }
      },
      frost: {
        id: id<CoinDefId>('frost'),
        element: 'frost' as const,
        procs: {
          heads: [{ kind: 'applyStatus' as const, status: 'frostbite' as const, stacks: 1, to: 'target' as const }],
          tails: [{ kind: 'block' as const, amount: 1 }]
        }
      }
    },
    skills: Object.fromEntries(skills.map((skill) => [String(skill.id), skill])),
    enemies: {
      target: {
        id: id<EnemyDefId>('target'),
        name: 'target',
        maxHp: 100,
        intents: [{ id: 'wait', actions: [] }]
      }
    },
    characters: {
      tester: {
        id: id<CharacterId>('tester'),
        name: 'tester',
        maxHp: 50,
        startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
        startingSkills: skills.map((skill) => skill.id),
        trait: { id: 'none', name: 'none', hook: 'combatStart' as const, effects: [] }
      }
    }
  };
  return { ...db, validate: () => validateContentDb(db) };
};

const scriptedFlips = (faces: readonly Face[], onFlip?: () => void): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      onFlip?.();
      const face = faces[index];
      if (face === undefined) throw new Error('scripted flip exhausted');
      index += 1;
      return face;
    },
    shuffle: <T>(values: readonly T[]) => [...values],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const combat = (db: ContentDb, faces: readonly Face[]): CombatState => {
  const state = createCombat({ character: id<CharacterId>('tester'), enemies: [id<EnemyDefId>('target')] }, db, 'success-ladder');
  return { ...state, rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) } };
};

const loadAndUse = (input: CombatState, skillSlot: number, count: number, db: ContentDb, defs?: readonly string[]) => {
  let state = input;
  const coins = state.zones.hand.slice(0, count);
  if (defs !== undefined) {
    const replacements = Object.fromEntries(
      coins.map((coin, index) => [Number(coin), { ...state.coins[Number(coin)]!, defId: id<CoinDefId>(defs[index]!) }])
    );
    state = { ...state, coins: { ...state.coins, ...replacements } };
  }
  for (const coin of coins) {
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(skillSlot) }, db);
    if (!placed.ok) throw new Error(placed.error);
    state = placed.state;
  }
  const used = step(state, { type: 'useFlipSkill', slot: slot(skillSlot), target: 0 }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

describe('success-ladder flip resolution', () => {
  it('resolves the 1-cost basic Attack only on heads', () => {
    const db = testDb();
    expect(loadAndUse(combat(db, ['tails']), 0, 1, db).state.enemies[0]?.hp).toBe(100);
    expect(loadAndUse(combat(db, ['heads']), 0, 1, db).state.enemies[0]?.hp).toBe(96);
  });

  it('resolves the 1-cost basic Block only on tails', () => {
    const db = testDb();
    expect(loadAndUse(combat(db, ['heads']), 1, 1, db).state.player.block).toBe(0);
    expect(loadAndUse(combat(db, ['tails']), 1, 1, db).state.player.block).toBe(4);
  });

  it('uses Flame Fist exact success tiers and applies fire resonance once', () => {
    const db = testDb();
    const zero = loadAndUse(combat(db, ['tails', 'tails']), 2, 2, db, ['basic', 'basic']);
    expect(zero.state.enemies[0]?.hp).toBe(98);
    expect(statusStacks(zero.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(0);

    const one = loadAndUse(combat(db, ['heads', 'tails']), 2, 2, db, ['basic', 'basic']);
    expect(one.state.enemies[0]?.hp).toBe(96);
    expect(statusStacks(one.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(1);

    const twoWithFire = loadAndUse(combat(db, ['heads', 'heads']), 2, 2, db, ['fire', 'fire']);
    expect(twoWithFire.state.enemies[0]?.hp).toBe(93);
    expect(statusStacks(twoWithFire.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(5);
    expect(
      twoWithFire.events
        .filter((event) => event.type === 'statusApplied' && event.status === 'burn')
        .map((event) => (event.type === 'statusApplied' ? event.stacks : 0))
    ).toEqual([2, 1, 1, 1]);
    expect(twoWithFire.events.filter((event) => event.type === 'resonanceTriggered')).toEqual([
      { type: 'resonanceTriggered', skill: flameFist.id, element: 'fire' }
    ]);
    const resonanceIndex = twoWithFire.events.findIndex((event) => event.type === 'resonanceTriggered');
    expect(twoWithFire.events[resonanceIndex + 1]).toMatchObject({ type: 'statusApplied', status: 'burn', stacks: 1 });
  });

  it('applies an off-element face proc without granting fire resonance', () => {
    const db = testDb();
    const result = loadAndUse(combat(db, ['heads', 'tails']), 2, 2, db, ['frost', 'basic']);
    expect(statusStacks(result.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(1);
    expect(statusTurns(result.state.enemies[0]?.statuses ?? {}, 'frostbite')).toBe(1);
    expect(result.events.some((event) => event.type === 'resonanceTriggered')).toBe(false);
  });

  it('does not emit resonance for zero successful faces or legacy skills', () => {
    const db = testDb();
    const zeroSuccess = loadAndUse(combat(db, ['tails', 'tails']), 2, 2, db, ['fire', 'fire']);
    expect(zeroSuccess.events.some((event) => event.type === 'resonanceTriggered')).toBe(false);

    const legacy = loadAndUse(combat(db, ['heads', 'heads']), 4, 2, db, ['fire', 'fire']);
    expect(legacy.events.some((event) => event.type === 'resonanceTriggered')).toBe(false);
  });

  it('puts Direct Hit temporary fire coin on draw top for the next turn', () => {
    const db = testDb();
    const used = loadAndUse(combat(db, ['heads', 'tails']), 3, 2, db);
    const created = used.events.find((event) => event.type === 'coinCreated');
    expect(created).toMatchObject({ type: 'coinCreated', defId: 'fire', zone: 'draw' });
    if (created?.type !== 'coinCreated') throw new Error('missing created coin');
    expect(used.state.zones.draw[0]).toBe(created.coin);
    expect(used.state.coins[Number(created.coin)]?.permanent).toBe(false);

    const ended = step(used.state, { type: 'endTurn' }, db);
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.state.zones.hand).toContain(created.coin);
  });

  it('uses the real resolver for success-ladder preview EV', () => {
    const db = testDb();
    let state = combat(db, ['heads', 'heads']);
    for (const coin of state.zones.hand.slice(0, 2)) {
      const placed = step(state, { type: 'placeCoin', coin, slot: slot(3) }, db);
      if (!placed.ok) throw new Error(placed.error);
      state = placed.state;
    }
    const preview = previewFlip(state, slot(3), db);
    expect(preview.byAxis.damage).toEqual({ min: 1, max: 6 });
    expect(preview.expected.damage).toBe(3.75);
    expect(preview.expected.coinsCreated).toBe(0.75);
  });

  it('consumes the same number of RNG flips as a legacy skill of the same cost', () => {
    const run = (skill: FlipSkillDef): number => {
      const db = testDb([skill]);
      let calls = 0;
      const state = {
        ...combat(db, ['heads', 'tails']),
        rngImpl: { flip: scriptedFlips(['heads', 'tails'], () => { calls += 1; }) }
      };
      loadAndUse(state, 0, 2, db);
      return calls;
    };
    expect(run(directHit)).toBe(2);
    expect(run(legacyStrike)).toBe(2);
  });
});

describe('success-ladder validation', () => {
  const errorsFor = (definition: Record<string, unknown>): string[] => {
    const skill = ladderSkill('invalid', definition);
    return testDb([skill]).validate();
  };

  it('requires exactly cost + 1 ladder entries', () => {
    expect(errorsFor({ cost: 2, successFace: 'heads', successLadder: [[], []] })).toContainEqual(expect.stringContaining('cost + 1'));
  });

  it('requires a success face', () => {
    expect(errorsFor({ cost: 1, successLadder: [[], []] })).toContainEqual(expect.stringContaining('successFace'));
  });

  it('requires a cost-1 zero-success tier to be empty', () => {
    expect(
      errorsFor({ cost: 1, successFace: 'heads', successLadder: [[{ kind: 'damage', amount: 1 }], [{ kind: 'damage', amount: 4 }]] })
    ).toContainEqual(expect.stringContaining('zero-success'));
  });

  it('requires resonance to match the skill element', () => {
    expect(
      errorsFor({
        cost: 2,
        requiredElement: 'fire',
        successFace: 'heads',
        successLadder: [[], [], []],
        resonance: { element: 'frost', effects: [{ kind: 'block', amount: 1 }] }
      })
    ).toContainEqual(expect.stringContaining('resonance element'));
  });

  it('rejects mixed legacy and success-ladder fields', () => {
    expect(
      errorsFor({
        cost: 1,
        successFace: 'heads',
        successLadder: [[], [{ kind: 'damage', amount: 4 }]],
        base: [{ kind: 'damage', amount: 1 }]
      })
    ).toContainEqual(expect.stringContaining('mix legacy'));
  });

  it('accepts a ladderAmount upgrade and rejects legacy patches on ladder skills', () => {
    expect(
      errorsFor({
        cost: 1,
        successFace: 'heads',
        successLadder: [[], [{ kind: 'damage', amount: 4 }]],
        upgrade: {
          name: 'trained',
          description: 'damage 5',
          patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
        }
      })
    ).toEqual([]);
    expect(
      errorsFor({
        cost: 1,
        successFace: 'heads',
        successLadder: [[], [{ kind: 'damage', amount: 4 }]],
        upgrade: { name: 'invalid', description: 'invalid', patch: { kind: 'baseAmount', index: 0, delta: 1 } }
      })
    ).toContainEqual(expect.stringContaining('ladderAmount'));
  });

  it('validates ladderAmount tier, atom, amount, and delta contracts', () => {
    const errors = (patch: Record<string, unknown>, successLadder: unknown[][] = [[], [{ kind: 'damage', amount: 4 }]]) =>
      errorsFor({
        cost: 1,
        successFace: 'heads',
        successLadder,
        upgrade: { name: 'invalid', description: 'invalid', patch }
      });

    expect(errors({ kind: 'ladderAmount', tier: 2, index: 0, delta: 1 })).toContainEqual(expect.stringContaining('tier 2'));
    expect(errors({ kind: 'ladderAmount', tier: 1, index: 1, delta: 1 })).toContainEqual(expect.stringContaining('index 1'));
    expect(
      errors({ kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }, [[], [{ kind: 'grantElement', element: 'fire', scope: 'allBasicInHand' }]])
    ).toContainEqual(expect.stringContaining('has no amount'));
    expect(errors({ kind: 'ladderAmount', tier: 1, index: 0, delta: 0 })).toContainEqual(expect.stringContaining('nonzero integer'));

    const legacy = {
      ...legacyStrike,
      upgrade: {
        name: 'invalid',
        description: 'invalid',
        patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
      }
    } as unknown as SkillDef;
    expect(testDb([legacy]).validate()).toContainEqual(expect.stringContaining('requires a success-ladder'));
  });
});

describe('success-ladder upgrades', () => {
  it('changes only the selected ladder atom and leaves the authored skill immutable', () => {
    const authored = ladderSkill('upgradeable-basic', {
      cost: 1,
      successFace: 'heads',
      successLadder: [[], [{ kind: 'damage', amount: 4 }]],
      upgrade: {
        name: 'trained',
        description: 'damage 5',
        patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
      }
    });

    const upgraded = deriveUpgradedSkill(authored);
    expect(upgraded).toMatchObject({ successLadder: [[], [{ kind: 'damage', amount: 5 }]] });
    expect(authored.successLadder).toEqual([[], [{ kind: 'damage', amount: 4 }]]);
  });
});
