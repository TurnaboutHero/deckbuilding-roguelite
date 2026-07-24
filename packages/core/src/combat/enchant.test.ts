import { describe, expect, it } from 'vitest';

import type { ConsumeSkillDef, ContentDb, FlipSkillDef } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, Face, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

type EnchantId = 'sharpness' | 'heads-polish' | 'tails-polish' | 'echo' | 'pendulum';

const ladderAttack: FlipSkillDef = {
  id: id<SkillId>('ladder-attack'),
  name: 'ladder-attack',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  cooldown: 0,
  successFace: 'heads',
  successLadder: [[], [{ kind: 'damage', amount: 4 }]]
};

const legacyAttack: FlipSkillDef = {
  id: id<SkillId>('legacy-attack'),
  name: 'legacy-attack',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  cooldown: 0,
  base: [{ kind: 'damage', amount: 2 }],
  heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] }
};

const fireConsume: ConsumeSkillDef = {
  id: id<SkillId>('fire-consume'),
  name: 'fire-consume',
  type: 'consume',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cooldown: 0,
  consume: { element: 'fire', count: 1 },
  effects: [{ kind: 'damage', amount: 3 }]
};

const dbFor = (remise = false): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' }
  },
  skills: Object.fromEntries([ladderAttack, legacyAttack, fireConsume].map((skill) => [String(skill.id), skill])),
  enemies: {
    target: { id: id<EnemyDefId>('target'), name: 'target', maxHp: 50, intents: [{ id: 'wait', actions: [] }] }
  },
  characters: {
    tester: {
      id: id<CharacterId>('tester'),
      name: 'tester',
      maxHp: 30,
      startingBag: [id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic')],
      startingSkills: [ladderAttack.id, legacyAttack.id, fireConsume.id],
      trait: {
        id: remise ? 'remise' : 'none',
        name: remise ? 'remise' : 'none',
        hook: 'combatStart',
        effects: [],
        ...(remise ? { mechanic: 'remise' as const } : {})
      }
    }
  },
  validate: () => []
});

const controlledRng = (faces: readonly Face[], floats: readonly number[]): { rng: Rng; samples: () => number } => {
  let faceIndex = 0;
  let floatIndex = 0;
  let samples = 0;
  return {
    rng: {
      float: () => {
        samples += 1;
        const value = floats[floatIndex];
        if (value === undefined) throw new Error('scripted float exhausted');
        floatIndex += 1;
        return value;
      },
      int: () => 0,
      flip: () => {
        samples += 1;
        const face = faces[faceIndex];
        if (face === undefined) throw new Error('scripted flip exhausted');
        faceIndex += 1;
        return face;
      },
      shuffle: <T>(items: readonly T[]) => [...items],
      snapshot: (): RngSnapshot => ({ s: [faceIndex, floatIndex, samples, 0] })
    },
    samples: () => samples
  };
};

const combat = (
  db: ContentDb,
  faces: readonly Face[] = ['tails'],
  floats: readonly number[] = [0.5],
  bag?: readonly CoinDefId[]
): CombatState => {
  const initial = createCombat({ character: id<CharacterId>('tester'), enemies: [id<EnemyDefId>('target')], bag }, db, 'enchant');
  const scripted = controlledRng(faces, floats);
  return { ...initial, rngImpl: { ...initial.rngImpl, flip: scripted.rng } };
};

const enchant = (input: CombatState, coin: CoinUid, enchantId: EnchantId): CombatState => ({
  ...input,
  coins: {
    ...input.coins,
    [Number(coin)]: {
      ...input.coins[Number(coin)]!,
      permanent: true,
      enchant: enchantId
    } as never
  }
});

const changeCoinDef = (input: CombatState, coin: CoinUid, defId: CoinDefId): CombatState => ({
  ...input,
  coins: { ...input.coins, [Number(coin)]: { ...input.coins[Number(coin)]!, defId } }
});

const useFlip = (input: CombatState, db: ContentDb, skillSlot = 0): Extract<ReturnType<typeof step>, { ok: true }> => {
  const coin = input.zones.hand[0];
  if (coin === undefined) throw new Error('missing hand coin');
  const used = step(input, { type: 'useImmediateFlipSkill', slot: slot(skillSlot), coins: [coin], target: 0 }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

const returnDiscardedCoinToHand = (input: CombatState, coin: CoinUid): CombatState => ({
  ...input,
  zones: {
    ...input.zones,
    discard: input.zones.discard.filter((candidate) => candidate !== coin),
    hand: [...input.zones.hand, coin]
  }
});

describe('permanent coin enchant contracts', () => {
  it('adds Sharpness damage only when its attack coin succeeds', () => {
    const db = dbFor();
    const initial = combat(db, ['heads']);
    const coin = initial.zones.hand[0]!;
    const result = useFlip(enchant(initial, coin, 'sharpness'), db);

    expect(result.state.enemies[0]?.hp).toBe(45);
  });

  it('uses one RNG sample and the 60/40 threshold for Heads Polish and Tails Polish', () => {
    const db = dbFor();
    const headsAt59 = controlledRng(['tails'], [0.59]);
    const headsAt60 = controlledRng(['heads'], [0.6]);
    const tailsAt59 = controlledRng(['heads'], [0.59]);
    const tailsAt60 = controlledRng(['tails'], [0.6]);
    const run = (script: ReturnType<typeof controlledRng>, enchantId: EnchantId): { hp: number; samples: number } => {
      const initial = combat(db);
      const coin = initial.zones.hand[0]!;
      const state = { ...enchant(initial, coin, enchantId), rngImpl: { ...initial.rngImpl, flip: script.rng } };
      return { hp: useFlip(state, db).state.enemies[0]!.hp, samples: script.samples() };
    };

    expect(run(headsAt59, 'heads-polish')).toEqual({ hp: 46, samples: 1 });
    expect(run(headsAt60, 'heads-polish')).toEqual({ hp: 50, samples: 1 });
    expect(run(tailsAt59, 'tails-polish')).toEqual({ hp: 50, samples: 1 });
    expect(run(tailsAt60, 'tails-polish')).toEqual({ hp: 46, samples: 1 });
  });

  it('forces Pendulum to the explicit success face only once per combat', () => {
    const db = dbFor();
    const initial = combat(db, ['tails', 'tails']);
    const coin = initial.zones.hand[0]!;
    const first = useFlip(enchant(initial, coin, 'pendulum'), db);
    const second = useFlip(returnDiscardedCoinToHand(first.state, coin), db);

    expect(first.state.enemies[0]?.hp).toBe(46);
    expect(second.state.enemies[0]?.hp).toBe(46);
  });

  it('leaves legacy non-ladder skills unchanged when their coin has Pendulum', () => {
    const db = dbFor();
    const initial = combat(db, ['tails']);
    const coin = initial.zones.hand[0]!;
    const result = useFlip(enchant(initial, coin, 'pendulum'), db, 1);

    expect(result.state.enemies[0]?.hp).toBe(48);
  });

  it('returns an Echo coin to hand once after a flip skill, then discards it on reuse', () => {
    const db = dbFor();
    const initial = combat(db, ['heads', 'heads']);
    const coin = initial.zones.hand[0]!;
    const first = useFlip(enchant(initial, coin, 'echo'), db);
    const second = useFlip(first.state, db);

    expect(first.state.zones.hand).toContain(coin);
    expect(first.state.zones.discard).not.toContain(coin);
    expect(second.state.zones.hand).not.toContain(coin);
    expect(second.state.zones.discard).toContain(coin);
  });

  it('returns an Echo coin to hand once after a consume skill, then exhausts it on reuse', () => {
    const db = dbFor();
    const initial = combat(db);
    const coin = initial.zones.hand[0]!;
    const enchanted = enchant(changeCoinDef(initial, coin, id<CoinDefId>('fire')), coin, 'echo');
    const first = step(enchanted, { type: 'useConsumeSkill', slot: slot(2), coins: [coin], target: 0 }, db);
    if (!first.ok) throw new Error(first.error);
    const second = step(first.state, { type: 'useConsumeSkill', slot: slot(2), coins: [coin], target: 0 }, db);
    if (!second.ok) throw new Error(second.error);

    expect(first.state.zones.hand).toContain(coin);
    expect(first.state.zones.exhausted).not.toContain(coin);
    expect(second.state.zones.hand).not.toContain(coin);
    expect(second.state.zones.exhausted).toContain(coin);
  });

  it('draws before returning an Echo coin consumed from a full hand', () => {
    const drawConsume: ConsumeSkillDef = {
      ...fireConsume,
      id: id<SkillId>('fire-draw-consume'),
      effects: [{ kind: 'draw', count: 1 }]
    };
    const base = dbFor();
    const db: ContentDb = { ...base, skills: { ...base.skills, [String(drawConsume.id)]: drawConsume } };
    const initial = combat(db, ['tails'], [0.5], Array.from({ length: 11 }, () => id<CoinDefId>('fire')));
    const fullHand = {
      ...initial,
      zones: {
        ...initial.zones,
        hand: [...initial.zones.hand, ...initial.zones.draw.slice(0, 7)],
        draw: initial.zones.draw.slice(7)
      },
      slots: initial.slots.map((candidate, index) => (index === 2 ? { ...candidate, skillId: drawConsume.id } : candidate))
    };
    const coin = fullHand.zones.hand[0]!;
    const drawnCoin = fullHand.zones.draw[0]!;
    const result = step(enchant(fullHand, coin, 'echo'), { type: 'useConsumeSkill', slot: slot(2), coins: [coin], target: 0 }, db);
    if (!result.ok) throw new Error(result.error);

    expect(result.state.zones.hand).toEqual(expect.arrayContaining([coin, drawnCoin]));
    expect(result.state.zones.exhausted).not.toContain(coin);
    expect(result.events.findIndex((event) => event.type === 'coinsDrawn')).toBeLessThan(
      result.events.findIndex((event) => event.type === 'enchantTriggered' && event.effect === 'return')
    );
  });

  it('rejects a temporary coin that has been corrupted with an enchant at runtime', () => {
    const db = dbFor();
    const initial = combat(db, ['heads']);
    const coin = initial.zones.hand[0]!;
    const invalid = {
      ...enchant(initial, coin, 'sharpness'),
      coins: { ...enchant(initial, coin, 'sharpness').coins, [Number(coin)]: { ...enchant(initial, coin, 'sharpness').coins[Number(coin)]!, permanent: false } }
    } as unknown as CombatState;
    const result = step(invalid, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [coin], target: 0 }, db);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/temporary coin.*enchant/i);
  });

  it('does not retrigger Pendulum during a Remise repeat', () => {
    const db = dbFor(true);
    const initial = combat(db, ['tails', 'tails']);
    const coin = initial.zones.hand[0]!;
    const state = { ...enchant(initial, coin, 'pendulum'), player: { ...initial.player, remiseCharges: 1 } };
    const result = useFlip(state, db);

    expect(result.state.enemies[0]?.hp).toBe(46);
  });

});
