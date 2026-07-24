// P13 Wave 4a contract lock.
// 사유: Wave-0 즉시 과열 특성화는 fire-fist 예약 진입 계약과 충돌하므로,
// inner-passion 즉시 진입은 유지하고 scheduleOverheat는 다음 턴 예약으로 잠근다.
import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, Face, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import type { ContentDb, FlipSkillDef, SkillDef } from '../content-types';
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

const skill = (skillId: string, base: FlipSkillDef['base']): FlipSkillDef => ({
  id: id<SkillId>(skillId),
  name: skillId,
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  base
});

const dbFor = (skills: readonly SkillDef[]): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null }
  },
  skills: Object.fromEntries(skills.map((item) => [String(item.id), item])),
  enemies: {
    dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: 20, intents: [{ id: 'idle', actions: [] }] }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: 'warrior',
      maxHp: 40,
      startingBag: [id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic'), id<CoinDefId>('basic')],
      startingSkills: skills.map((item) => item.id),
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (db: ContentDb): CombatState => ({
  ...createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('dummy')] }, db, 'p13-lock-overheat'),
  zones: {
    ...createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('dummy')] }, db, 'p13-lock-overheat').zones,
    draw: [],
    hand: [1, 2, 3, 4, 5].map((value) => value as CoinUid),
    discard: []
  },
  rngImpl: { flip: scriptedFlips(['heads']) }
});

const useFlip = (state: CombatState, db: ContentDb, slotIndex = 0): ReturnType<typeof step> & { ok: true } => {
  const used = step(state, { type: 'useImmediateFlipSkill', slot: slot(slotIndex), coins: [state.zones.hand[0]!], target: 0 }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

describe('P13 overheat contract lock', () => {
  it('keeps enterOverheat as immediate same-turn overheat', () => {
    const db = dbFor([skill('inner-passion', [{ kind: 'enterOverheat' }])]);
    const result = useFlip(combat(db), db);
    expect(result.events).toContainEqual({ type: 'overheatEntered' });
    expect(result.state.player.overheat).toBe(true);
    expect(result.state.player.pendingOverheat).toBe(false);
  });

  it('locks scheduleOverheat as a next-turn effect instead of immediate overheat', () => {
    const db = dbFor([skill('fire-fist', [{ kind: 'scheduleOverheat' }, { kind: 'damage', amount: 1 }])]);
    const scheduled = useFlip(combat(db), db);
    expect(scheduled.events).toContainEqual({ type: 'overheatScheduled' });
    expect(scheduled.state.player.overheat).toBe(false);
    expect(scheduled.state.player.pendingOverheat).toBe(true);

    const ended = step(scheduled.state, { type: 'endTurn' }, db);
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.events).toContainEqual({ type: 'overheatActivated' });
    expect(ended.state.player.overheat).toBe(true);
    expect(ended.state.player.pendingOverheat).toBe(false);
  });
});
