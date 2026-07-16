// P13 Wave 4a contract lock.
// 사유: Wave-0 방어 참조 특성화는 보상 은퇴 전 저장 호환용으로만 유지된다.
// 새 잠금은 기존 원자를 삭제하지 않되, 갑주 반향 원자가 방어를 직접 피해로 변환/소모하지 않는 계약을 고정한다.
import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import type { ConsumeSkillDef, ContentDb, SkillDef } from '../content-types';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const consume = (skillId: string, effects: ConsumeSkillDef['effects'], targetType: ConsumeSkillDef['targetType'] = 'single-enemy'): ConsumeSkillDef => ({
  id: id<SkillId>(skillId),
  name: skillId,
  type: 'consume',
  rarity: 'common',
  tags: ['attack'],
  targetType,
  consume: { element: 'mana', count: 1 },
  effects
});

const dbFor = (skills: readonly SkillDef[]): ContentDb => ({
  coins: {
    mana: {
      id: id<CoinDefId>('mana'),
      element: 'mana',
      procs: { heads: [{ kind: 'damage', amount: 1 }], tails: [{ kind: 'block', amount: 1 }] }
    }
  },
  skills: Object.fromEntries(skills.map((item) => [String(item.id), item])),
  enemies: {
    dummy: { id: id<EnemyDefId>('dummy'), name: 'dummy', maxHp: 80, intents: [{ id: 'attack', actions: [{ kind: 'attack', damage: 5 }] }] }
  },
  characters: {
    arcanist: {
      id: id<CharacterId>('arcanist'),
      name: 'arcanist',
      maxHp: 40,
      startingBag: [id<CoinDefId>('mana'), id<CoinDefId>('mana'), id<CoinDefId>('mana'), id<CoinDefId>('mana'), id<CoinDefId>('mana')],
      startingSkills: skills.map((item) => item.id),
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (db: ContentDb): CombatState => ({
  ...createCombat({ character: id<CharacterId>('arcanist'), enemies: [id<EnemyDefId>('dummy')] }, db, 'p13-lock-block-atoms'),
  zones: {
    ...createCombat({ character: id<CharacterId>('arcanist'), enemies: [id<EnemyDefId>('dummy')] }, db, 'p13-lock-block-atoms').zones,
    draw: [],
    hand: [1, 2, 3, 4, 5].map((value) => value as CoinUid),
    discard: []
  }
});

const useConsume = (state: CombatState, db: ContentDb, slotIndex = 0, target = 0): ReturnType<typeof step> & { ok: true } => {
  const used = step(state, { type: 'useConsumeSkill', slot: slot(slotIndex), coins: [state.zones.hand[0]!], target }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

describe('P13 armor echo contract lock', () => {
  it('keeps retired block-reference atoms resolvable for save compatibility', () => {
    const db = dbFor([consume('legacy', [{ kind: 'damagePlusBlock', base: 2, cap: 4 }])]);
    const state = { ...combat(db), player: { ...combat(db).player, block: 9 } };
    const beforeHp = state.enemies[0]?.hp ?? 0;
    const result = useConsume(state, db);
    expect(beforeHp - (result.state.enemies[0]?.hp ?? 0)).toBe(6);
    expect(result.state.player.block).toBe(9);
  });

  it('uses armor echo as the only new block-to-attack bridge without consuming block', () => {
    const db = dbFor([consume('smash', [{ kind: 'damagePlusEcho', base: 6 }])]);
    const echoed = step({ ...combat(db), player: { ...combat(db).player, block: 8 } }, { type: 'endTurn' }, db);
    if (!echoed.ok) throw new Error(echoed.error);
    const state = { ...echoed.state, player: { ...echoed.state.player, block: 7 } };
    const beforeHp = state.enemies[0]?.hp ?? 0;
    const result = useConsume(state, db);
    expect(beforeHp - (result.state.enemies[0]?.hp ?? 0)).toBe(11);
    expect(result.events).toContainEqual({ type: 'echoSpent', skill: id<SkillId>('smash'), amount: 5 });
    expect(result.state.player.armorEcho).toBe(5);
    expect(result.state.player.block).toBe(7);
  });
});
