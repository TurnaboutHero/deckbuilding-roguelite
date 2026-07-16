// P13 Wave 3: 구 재플립 모델 잠금을 스택 모델 계약으로 교체
import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, Face, Rng, RngSnapshot, SkillId, SlotId } from '../index';
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
  id: id<SkillId>('fente'),
  name: 'fente',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  base: [{ kind: 'damage', amount: 6 }],
  remise: { onRepeatFinish: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }] }
};

const db: ContentDb = {
  coins: { basic: { id: id<CoinDefId>('basic'), element: null } },
  skills: { [String(skill.id)]: skill },
  enemies: { dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: 30, intents: [{ id: 'idle', actions: [] }] } },
  characters: {
    duelist: {
      id: id<CharacterId>('duelist'),
      name: 'duelist',
      maxHp: 40,
      startingBag: [id<CoinDefId>('basic')],
      startingSkills: [skill.id],
      trait: { id: 'remise', name: 'remise', hook: 'combatStart', effects: [], mechanic: 'remise' }
    }
  },
  validate: () => []
};

const combat = (faces: readonly Face[]): CombatState => {
  const state = createCombat({ character: id<CharacterId>('duelist'), enemies: [id<EnemyDefId>('dummy')], bag: [id<CoinDefId>('basic')] }, db, 'p13-lock-remise');
  return {
    ...state,
    zones: { ...state.zones, hand: [1 as CoinUid], draw: [], discard: [] },
    rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
  };
};

const use = (state: CombatState) => {
  const placed = step(state, { type: 'placeCoin', coin: 1 as CoinUid, slot: slot(0) }, db);
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slot(0), target: 0 }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

describe('P13 stack remise lock', () => {
  it('starts the first player turn with exactly one stack and no combat-start double grant', () => {
    const state = combat(['tails']);

    expect(state.player.remiseCharges).toBe(1);
    expect(state.events.filter((event) => event.type === 'remiseGained')).toEqual([{ type: 'remiseGained', amount: 1, total: 1 }]);
  });

  it('spends before the first flip result and repeats only when that original first face is heads', () => {
    const repeated = use(combat(['heads', 'tails']));
    const failed = use(combat(['tails']));

    expect(repeated.events).toContainEqual({ type: 'remiseSpent', skill: skill.id, firstFace: 'heads', repeat: true, remaining: 0 });
    expect(repeated.events).toContainEqual({ type: 'remiseRepeatResolved', skill: skill.id });
    expect(repeated.events).toContainEqual({ type: 'statusApplied', target: { type: 'enemy', index: 0 }, status: 'shock', stacks: 1, turns: 1 });
    expect(failed.events).toContainEqual({ type: 'remiseSpent', skill: skill.id, firstFace: 'tails', repeat: false, remaining: 0 });
    expect(failed.events.some((event) => event.type === 'remiseRepeatResolved')).toBe(false);
  });
});
