import type { ConsumeSkillDef, ContentDb, TargetRef } from '../../content-types';
import { effectiveElements, skillCooldown } from '../../content-types';
import type { CoinUid, SlotId } from '../../ids';
import type { CombatEvent } from '../events';
import type { CombatState } from '../state';
import { applyEffectAtom, checkCombatEnd, fireTurnTriggers, targetsForSkillEffect } from './flip';

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
  db: ContentDb,
  chosenSummon?: number
): ResolveConsumeResult => {
  const slotState = input.slots[Number(slot)];
  if (slotState === undefined) throw new Error('slot does not exist');
  if (slotState.cooldownRemaining > 0) throw new Error('skill is cooling down');
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
  // P7 D5 — 소비 스킬도 과열 강화 분기 지원 (해결 후 소비, 단일 finish 경로)
  const consumesOverheat = input.player.overheat && (skill.overheatBonus?.length ?? 0) > 0;
  const finish = (finishedState: CombatState): ResolveConsumeResult => {
    let state = finishedState;
    if (consumesOverheat && state.player.overheat) {
      events.push({ type: 'overheatConsumed', skill: skill.id });
      state = { ...state, player: { ...state.player, overheat: false } };
    }
    return { state, events };
  };

  let state: CombatState = {
    ...input,
    slots: input.slots.map((candidate, index) =>
      index === Number(slot)
        ? {
            ...candidate,
            cooldownRemaining: skillCooldown(skill),
            usedThisCombat: candidate.usedThisCombat || skill.oncePerCombat === true
          }
        : candidate
    ),
    zones: {
      ...input.zones,
      hand: removeCoins(input.zones.hand, consumed),
      exhausted: [...input.zones.exhausted, ...coins]
    }
  };

  // 피해 전용 과열 보너스는 기본 피해와 같은 타격으로 합산 (flip과 동일 규칙)
  const overheatBonus = input.player.overheat ? (skill.overheatBonus ?? []) : [];
  const effects = [...skill.effects];
  if (overheatBonus.length > 0) {
    if (overheatBonus.every((atom) => atom.kind === 'damage')) {
      let insertAt = -1;
      for (let i = 0; i < effects.length; i += 1) {
        if (effects[i]!.kind === 'damage') insertAt = i;
      }
      if (insertAt >= 0) effects.splice(insertAt + 1, 0, ...overheatBonus);
      else effects.push(...overheatBonus);
    } else {
      effects.push(...overheatBonus);
    }
  }
  for (const atom of effects) {
    for (const effectTarget of targetsForSkillEffect(state, atom, skill, skillTarget)) {
      state = applyEffectAtom(state, atom, effectTarget, db, events, undefined, { turnTriggerScope, sourceSlot: slot, chosenSummon });
      if (state.phase === 'victory' || state.phase === 'defeat') return finish(state);
    }
  }

  state = checkCombatEnd(state, events);
  if (state.phase !== 'victory' && state.phase !== 'defeat' && skill.tags.includes('attack')) {
    state = fireTurnTriggers(state, 'onAttackSkillResolved', skillTarget, db, events, turnTriggerScope);
  }
  return finish(state);
};
