import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, Face, PassiveId, Rng, RngSnapshot, SkillId, SlotId } from '../index';
import type { ContentDb, FlipSkillDef } from '../content-types';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const scriptedFlips = (faces: readonly Face[]): Rng => {
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
    shuffle: <T>(items: readonly T[]) => [...items],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const dbFor = (skill: FlipSkillDef): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    lightning: { id: id<CoinDefId>('lightning'), element: 'lightning' }
  },
  skills: { [String(skill.id)]: skill },
  enemies: {
    dummy: { id: id<EnemyDefId>('dummy'), name: '허수아비', maxHp: 99, intents: [{ id: 'idle', actions: [] }] }
  },
  characters: {
    duelist: {
      id: id<CharacterId>('duelist'), name: '결투사', maxHp: 40,
      startingBag: [id<CoinDefId>('basic'), id<CoinDefId>('lightning')],
      startingSkills: [skill.id],
      trait: { id: 'remise', name: '르미즈', hook: 'combatStart', effects: [], mechanic: 'remise' }
    }
  },
  passives: {
    retrieval: {
      id: id<PassiveId>('retrieval'), name: '회수 습관', description: '', hook: 'combatStart',
      effects: [], mechanic: 'retrievalHabit', element: null, price: 0
    },
    residual: {
      id: id<PassiveId>('residual'), name: '잔류 전하', description: '', hook: 'combatStart',
      effects: [], mechanic: 'residualCharge', element: 'lightning', price: 0
    }
  },
  validate: () => []
});

const combat = (skill: FlipSkillDef, faces: readonly Face[]): CombatState => {
  const db = dbFor(skill);
  const created = createCombat(
    {
      character: id<CharacterId>('duelist'), enemies: [id<EnemyDefId>('dummy')],
      bag: [id<CoinDefId>('basic'), id<CoinDefId>('lightning')],
      passives: [id<PassiveId>('retrieval'), id<PassiveId>('residual')]
    },
    db,
    'p9-remise-routing'
  );
  const [first, second] = created.zones.hand;
  if (first === undefined || second === undefined) throw new Error('expected two coins');
  return {
    ...created,
    coins: {
      ...created.coins,
      [Number(first)]: { ...created.coins[Number(first)]!, defId: id<CoinDefId>('basic') },
      [Number(second)]: { ...created.coins[Number(second)]!, defId: id<CoinDefId>('lightning') }
    },
    zones: { ...created.zones, hand: [first, second], draw: [], discard: [] },
    rngImpl: { ...created.rngImpl, flip: scriptedFlips(faces) }
  };
};

const resolve = (state: CombatState, db: ContentDb, coins: readonly CoinUid[]) => {
  let current = state;
  for (const coin of coins) {
    const placed = step(current, { type: 'placeCoin', coin, slot: slot(0) }, db);
    if (!placed.ok) throw new Error(placed.error);
    current = placed.state;
  }
  const result = step(current, { type: 'useFlipSkill', slot: slot(0), target: 0 }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const testSkill = (returnFirstCoinOnReuse = false): FlipSkillDef => ({
  id: id<SkillId>('test-remise'), name: '테스트 르미즈', type: 'flip', rarity: 'common',
  tags: ['attack'], targetType: 'single-enemy', cost: 2, base: [{ kind: 'damage', amount: 1 }],
  remise: { returnFirstCoinOnReuse }
});

describe('P9 Remise coin routing', () => {
  it('emits coinFlipped for the reflip and every free-reuse coin, then routes different passive coins', () => {
    const skill = testSkill();
    const db = dbFor(skill);
    const state = combat(skill, ['heads', 'tails', 'heads', 'tails', 'tails']);
    const coins = [...state.zones.hand];
    const result = resolve(state, db, coins);

    expect(result.events.filter((event) => event.type === 'coinFlipped')).toHaveLength(5);
    expect(result.state.zones.draw.slice(0, 2)).toEqual(coins);
    expect(result.state.zones.discard).toEqual([]);
  });

  it('gives a Fente-style hand return precedence only for that coin', () => {
    const skill = testSkill(true);
    const db = dbFor(skill);
    const state = combat(skill, ['heads', 'tails', 'heads', 'tails', 'tails']);
    const [first, second] = state.zones.hand;
    if (first === undefined || second === undefined) throw new Error('expected two coins');
    const result = resolve(state, db, [first, second]);

    expect(result.state.zones.hand).toEqual([first]);
    expect(result.state.zones.draw[0]).toBe(second);
    expect(result.state.zones.discard).toEqual([]);
  });

  it('resolves the first face before its immediate reflip and still checks Remise before lethal base damage', () => {
    const skill: FlipSkillDef = {
      ...testSkill(),
      cost: 1,
      base: [{ kind: 'damage', amount: 200 }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 1 }] }
    };
    const db = dbFor(skill);
    const state = combat(skill, ['heads', 'tails']);
    const first = state.zones.hand[0];
    if (first === undefined) throw new Error('expected a coin');
    const result = resolve(state, db, [first]);
    const damageIndices = result.events.flatMap((event, index) => event.type === 'damageDealt' ? [index] : []);
    const firstDamage = damageIndices[0] ?? -1;
    const reflip = result.events.findIndex((event) => event.type === 'remiseReflipped');
    const lethalDamage = damageIndices.at(-1) ?? -1;

    expect(firstDamage).toBeGreaterThanOrEqual(0);
    expect(reflip).toBeGreaterThan(firstDamage);
    expect(lethalDamage).toBeGreaterThan(reflip);
    expect(result.state.phase).toBe('victory');
  });

  it('fires onAttackSkillResolved once for the original and once for a free reuse', () => {
    const skill = testSkill();
    const db = dbFor(skill);
    const created = combat(skill, ['heads', 'tails', 'heads', 'tails', 'tails']);
    const state: CombatState = {
      ...created,
      turnTriggers: [
        { uid: 1, trigger: { id: 'twice', hook: 'onAttackSkillResolved', effects: [{ kind: 'block', amount: 1 }] } }
      ]
    };
    const result = resolve(state, db, state.zones.hand);

    expect(result.events.filter((event) => event.type === 'turnTriggerFired' && event.trigger === 'twice')).toHaveLength(2);
    expect(result.state.player.block).toBe(2);
  });
});
