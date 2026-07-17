import { describe, expect, it } from 'vitest';

import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, PassiveId, SkillId, SlotId } from '../ids';
import type { ContentDb, SkillDef } from '../content-types';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const skills: Record<string, SkillDef> = {
  strike: {
    id: id<SkillId>('strike'),
    name: 'strike',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'damage', amount: 1 }]
  },
  guard: {
    id: id<SkillId>('guard'),
    name: 'guard',
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cost: 1,
    base: [{ kind: 'block', amount: 2 }]
  }
};

const db: ContentDb = {
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null }
  },
  skills,
  enemies: {
    dummy: {
      id: id<EnemyDefId>('dummy'),
      name: 'dummy',
      maxHp: 20,
      intents: [{ id: 'poke', actions: [{ kind: 'attack', damage: 1 }] }]
    }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: 'warrior',
      maxHp: 20,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [id<SkillId>('guard'), id<SkillId>('guard'), id<SkillId>('strike')],
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  passives: {
    shieldMastery: {
      id: id<PassiveId>('shieldMastery'),
      name: 'shieldMastery',
      description: 'shieldMastery',
      price: 1,
      element: null,
      hook: 'combatStart',
      effects: [],
      mechanic: 'shieldMastery'
    },
    preparedStance: {
      id: id<PassiveId>('preparedStance'),
      name: 'preparedStance',
      description: 'preparedStance',
      price: 1,
      element: null,
      hook: 'combatStart',
      effects: [],
      mechanic: 'preparedStance'
    }
  },
  validate: () => []
};

const combat = (passives: readonly PassiveId[]): CombatState =>
  createCombat(
    {
      character: id<CharacterId>('warrior'),
      enemies: [id<EnemyDefId>('dummy')],
      equippedSkills: [id<SkillId>('guard'), id<SkillId>('guard'), id<SkillId>('strike')],
      passives
    },
    db,
    'warrior-passives'
  );

const useFlip = (state: CombatState, slotId: SlotId, coin: CoinUid, target = 0): CombatState => {
  const placed = step(state, { type: 'placeCoin', coin, slot: slotId }, db);
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slotId, target }, db);
  if (!used.ok) throw new Error(used.error);
  return used.state;
};

const endTurn = (state: CombatState): ReturnType<typeof step> & { ok: true } => {
  const result = step(state, { type: 'endTurn' }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('warrior passives', () => {
  it('applies shieldMastery only to the first defense skill each turn and resets next turn', () => {
    const firstTurn = combat([id<PassiveId>('shieldMastery')]);
    const afterFirstGuard = useFlip(firstTurn, slot(0), firstTurn.zones.hand[0]!);
    expect(afterFirstGuard.player.block).toBe(3);

    const afterSecondGuard = useFlip(afterFirstGuard, slot(1), afterFirstGuard.zones.hand[0]!);
    expect(afterSecondGuard.player.block).toBe(5);

    const nextTurn = endTurn(afterSecondGuard).state;
    const afterNextTurnGuard = useFlip(nextTurn, slot(0), nextTurn.zones.hand[0]!);
    expect(afterNextTurnGuard.player.block).toBe(3);
  });

  it('grants preparedStance block at turn end only after an attack skill and ignores remaining hand coins', () => {
    const idleTurn = combat([id<PassiveId>('preparedStance')]);
    const idleEnded = endTurn(idleTurn);
    expect(idleEnded.events.some((event) => event.type === 'blockGained')).toBe(false);
    expect(idleEnded.state.player.hp).toBe(19);

    const initialAttackTurn = combat([id<PassiveId>('preparedStance')]);
    const suppliedCoin = initialAttackTurn.zones.draw[0]!;
    const attackTurn: CombatState = {
      ...initialAttackTurn,
      zones: {
        ...initialAttackTurn.zones,
        hand: [...initialAttackTurn.zones.hand, suppliedCoin],
        draw: initialAttackTurn.zones.draw.slice(1)
      }
    };
    const afterAttack = useFlip(attackTurn, slot(2), attackTurn.zones.hand[0]!);
    expect(afterAttack.zones.hand.length).toBeGreaterThan(2);

    const attackEnded = endTurn(afterAttack);
    expect(attackEnded.events).toContainEqual({ type: 'blockGained', target: { type: 'player' }, amount: 1 });
    expect(attackEnded.state.player.hp).toBe(20);
  });
});
