import type { ConsumeSkillDef, ContentDb, TargetRef } from '../../content-types';
import { effectiveElements } from '../../content-types';
import type { CoinUid, SlotId } from '../../ids';
import type { CombatEvent } from '../events';
import type { CombatState } from '../state';
import { applyEffectAtom, checkCombatEnd, fireTurnTriggers } from './flip';

export interface ResolveConsumeResult {
  state: CombatState;
  events: CombatEvent[];
}

const removeCoins = (coins: readonly CoinUid[], selected: ReadonlySet<CoinUid>): CoinUid[] =>
  coins.filter((coin) => !selected.has(coin));

const isAliveEnemy = (state: CombatState, index: number): boolean => {
  const enemy = state.enemies[index];
  return enemy !== undefined && enemy.hp > 0;
};

const firstAliveEnemy = (state: CombatState): number | undefined =>
  state.enemies.findIndex((enemy) => enemy.hp > 0) >= 0
    ? state.enemies.findIndex((enemy) => enemy.hp > 0)
    : undefined;

const targetForSkill = (state: CombatState, skill: ConsumeSkillDef, target?: number): TargetRef => {
  if (skill.targetType === 'self' || skill.targetType === 'none') return { type: 'player' };
  if (skill.targetType === 'single-enemy') {
    if (target === undefined || !isAliveEnemy(state, target)) {
      throw new Error('target enemy is not alive');
    }
    return { type: 'enemy', index: target };
  }
  const fallback = firstAliveEnemy(state);
  if (fallback === undefined) throw new Error('no living enemy target');
  return { type: 'enemy', index: fallback };
};

export const resolveConsume = (
  input: CombatState,
  slot: SlotId,
  skill: ConsumeSkillDef,
  coins: readonly CoinUid[],
  target: number | undefined,
  db: ContentDb
): ResolveConsumeResult => {
  if (input.skillUsesThisTurn >= 3) throw new Error('skill use cap reached');
  const slotState = input.slots[Number(slot)];
  if (slotState === undefined) throw new Error('slot does not exist');
  if (slotState.usedThisTurn) throw new Error('skill already used this turn');
  if (skill.oncePerCombat === true && slotState.usedThisCombat) throw new Error('skill already used this combat');
  if (coins.length !== skill.consume.count) throw new Error('consumed coin count must equal skill cost');
  if (new Set(coins).size !== coins.length) throw new Error('consumed coins must be unique');

  for (const coin of coins) {
    if (!input.zones.hand.includes(coin)) throw new Error('consumed coin is not in hand');
    const instance = input.coins[Number(coin)];
    if (instance === undefined || !effectiveElements(instance, db).includes(skill.consume.element)) {
      throw new Error('consumed coin does not satisfy required element');
    }
  }

  const skillTarget = targetForSkill(input, skill, target);
  const turnTriggerScope = input.turnTriggers;
  const consumed = new Set<CoinUid>(coins);
  const events: CombatEvent[] = [
    { type: 'skillUsed', slot, skill: skill.id, kind: 'consume' },
    { type: 'coinsConsumed', coins: [...coins] }
  ];
  let state: CombatState = {
    ...input,
    slots: input.slots.map((candidate, index) =>
      index === Number(slot)
        ? { ...candidate, usedThisTurn: true, usedThisCombat: candidate.usedThisCombat || skill.oncePerCombat === true }
        : candidate
    ),
    skillUsesThisTurn: input.skillUsesThisTurn + 1,
    zones: {
      ...input.zones,
      hand: removeCoins(input.zones.hand, consumed),
      exhausted: [...input.zones.exhausted, ...coins]
    }
  };

  for (const atom of skill.effects) {
    state = applyEffectAtom(state, atom, skillTarget, db, events, undefined, { turnTriggerScope });
    if (state.phase === 'victory' || state.phase === 'defeat') return { state, events };
  }

  state = checkCombatEnd(state, events);
  if (state.phase !== 'victory' && state.phase !== 'defeat' && skill.tags.includes('attack')) {
    state = fireTurnTriggers(state, 'onAttackSkillResolved', skillTarget, db, events, turnTriggerScope);
  }
  return { state, events };
};
