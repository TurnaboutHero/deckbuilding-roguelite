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

const skill: FlipSkillDef = {
  id: id<SkillId>('test-remise'),
  name: 'test-remise',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 2,
  base: [{ kind: 'damage', amount: 1 }]
};

const db: ContentDb = {
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    lightning: { id: id<CoinDefId>('lightning'), element: 'lightning', procs: { heads: [{ kind: 'damage', amount: 1 }], tails: [{ kind: 'block', amount: 1 }] } }
  },
  skills: { [String(skill.id)]: skill },
  enemies: { dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: 99, intents: [{ id: 'idle', actions: [] }] } },
  characters: {
    duelist: {
      id: id<CharacterId>('duelist'),
      name: 'duelist',
      maxHp: 40,
      startingBag: [id<CoinDefId>('basic'), id<CoinDefId>('lightning')],
      startingSkills: [skill.id],
      trait: { id: 'remise', name: 'remise', hook: 'combatStart', effects: [], mechanic: 'remise' }
    }
  },
  passives: {
    retrieval: { id: id<PassiveId>('retrieval'), name: 'retrieval', description: 'x', hook: 'combatStart', effects: [], mechanic: 'retrievalHabit', element: null, price: 1 },
    residual: { id: id<PassiveId>('residual'), name: 'residual', description: 'x', hook: 'combatStart', effects: [], mechanic: 'residualCharge', element: 'lightning', price: 1 }
  },
  validate: () => []
};

const combat = (faces: readonly Face[]): CombatState => {
  const state = createCombat(
    {
      character: id<CharacterId>('duelist'),
      enemies: [id<EnemyDefId>('dummy')],
      bag: [id<CoinDefId>('basic'), id<CoinDefId>('lightning')],
      passives: [id<PassiveId>('retrieval'), id<PassiveId>('residual')]
    },
    db,
    'p9-remise-routing'
  );
  return {
    ...state,
    zones: { ...state.zones, hand: [1 as CoinUid, 2 as CoinUid], draw: [], discard: [] },
    rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
  };
};

const resolve = (state: CombatState) => {
  const result = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [...state.zones.hand], target: 0 }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('P9 Remise stack routing', () => {
  it('routes retrieval and residual coins after a successful stack repeat without hand return', () => {
    const result = resolve(combat(['heads', 'tails', 'tails', 'heads']));

    expect(result.events.filter((event) => event.type === 'coinFlipped')).toHaveLength(4);
    expect(result.events).toContainEqual({ type: 'remiseSpent', skill: skill.id, firstFace: 'heads', repeat: true, remaining: 0 });
    expect(result.events).toContainEqual({ type: 'remiseRepeatResolved', skill: skill.id });
    expect(result.state.zones.draw.slice(0, 2)).toEqual([1 as CoinUid, 2 as CoinUid]);
    expect(result.state.zones.hand).toEqual([]);
    expect(result.state.zones.discard).toEqual([]);
  });

  it('fires onAttackSkillResolved once for the original and once for the repeat', () => {
    const state: CombatState = {
      ...combat(['heads', 'tails', 'tails', 'heads']),
      turnTriggers: [{ uid: 1, trigger: { id: 'twice', hook: 'onAttackSkillResolved', effects: [{ kind: 'block', amount: 1 }] } }]
    };
    const result = resolve(state);

    expect(result.events.filter((event) => event.type === 'turnTriggerFired' && event.trigger === 'twice')).toHaveLength(2);
    expect(result.state.player.block).toBe(3);
  });
});
