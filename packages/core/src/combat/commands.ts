import type { ContentDb } from '../content-types';
import { effectiveElements } from '../content-types';
import type { CoinUid, SlotId } from '../ids';
import type { CombatState } from './state';

export type Command =
  | { type: 'placeCoin'; coin: CoinUid; slot: SlotId }
  | { type: 'unplaceCoin'; coin: CoinUid }
  | { type: 'useFlipSkill'; slot: SlotId; target?: number }
  | { type: 'useConsumeSkill'; slot: SlotId; coins: CoinUid[]; target?: number }
  | { type: 'endTurn' };

const livingEnemyTargets = (state: CombatState): number[] =>
  state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [index] : []));

const targetsForSkill = (state: CombatState, targetType: 'single-enemy' | 'all-enemies' | 'self' | 'none'): (number | undefined)[] =>
  targetType === 'single-enemy' ? livingEnemyTargets(state) : [undefined];

export const legalCommands = (state: CombatState, db: ContentDb): Command[] => {
  if (state.phase !== 'player') return [];
  const commands: Command[] = [{ type: 'endTurn' }];

  for (let i = 0; i < state.slots.length; i += 1) {
    const slot = i as SlotId;
    const slotState = state.slots[i];
    if (slotState === undefined || slotState.usedThisTurn || state.skillUsesThisTurn >= 3) continue;
    const skill = db.skills[String(slotState.skillId)];
    if (skill === undefined || (skill.oncePerCombat === true && slotState.usedThisCombat)) continue;

    if (skill.type === 'flip') {
      if ((state.zones.placed[slot]?.length ?? 0) === skill.cost) {
        for (const target of targetsForSkill(state, skill.targetType)) {
          commands.push({ type: 'useFlipSkill', slot, target });
        }
      }
      if ((state.zones.placed[slot]?.length ?? 0) < skill.cost) {
        for (const coin of state.zones.hand) {
          commands.push({ type: 'placeCoin', coin, slot });
        }
      }
    } else {
      const usable = state.zones.hand
        .filter((coin) => {
          const instance = state.coins[Number(coin)];
          return instance !== undefined && effectiveElements(instance, db).includes(skill.consume.element);
        })
        .sort((left, right) => {
          const leftGranted = state.coins[Number(left)]?.grants.includes(skill.consume.element) === true;
          const rightGranted = state.coins[Number(right)]?.grants.includes(skill.consume.element) === true;
          if (leftGranted === rightGranted) return 0;
          return leftGranted ? -1 : 1;
        })
        .slice(0, skill.consume.count);
      if (usable.length === skill.consume.count) {
        for (const target of targetsForSkill(state, skill.targetType)) {
          commands.push({ type: 'useConsumeSkill', slot, coins: usable, target });
        }
      }
    }
  }

  for (const [key, coins] of Object.entries(state.zones.placed)) {
    void key;
    for (const coin of coins) commands.push({ type: 'unplaceCoin', coin });
  }

  return commands;
};
