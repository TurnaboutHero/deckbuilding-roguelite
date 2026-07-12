import type { ContentDb, FlipSkillDef } from '../content-types';
import { effectiveElements } from '../content-types';
import type { CoinUid, EquipmentDefId, SlotId } from '../ids';
import type { CombatState } from './state';

export type Command =
  | { type: 'placeCoin'; coin: CoinUid; slot: SlotId }
  | { type: 'unplaceCoin'; coin: CoinUid }
  | { type: 'useFlipSkill'; slot: SlotId; target?: number; chosen?: CoinUid[]; chosenEquipment?: EquipmentDefId; chosenSummon?: number }
  | { type: 'useConsumeSkill'; slot: SlotId; coins: CoinUid[]; target?: number }
  | { type: 'endTurn' };

const livingEnemyTargets = (state: CombatState): number[] =>
  state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [index] : []));

const targetsForSkill = (state: CombatState, targetType: 'single-enemy' | 'all-enemies' | 'self' | 'none'): (number | undefined)[] =>
  targetType === 'single-enemy' ? livingEnemyTargets(state) : [undefined];

const isBasicCoinInHand = (state: CombatState, db: ContentDb, coin: CoinUid): boolean => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
  return instance !== undefined && def?.element === null && instance.grants.length === 0;
};

// P6 D6 — 소환 선택 스킬 술어 (UI/심이 선택 필요 여부를 중복 구현하지 않도록 공개)
export const skillRequiresEquipmentChoice = (skill: FlipSkillDef): boolean =>
  [...skill.base, ...(skill.heads?.effects ?? []), ...(skill.tails?.effects ?? [])].some(
    (effect) => effect.kind === 'summonEquipment' && effect.equipment === 'chosen'
  );

export const skillCommandsSummon = (skill: FlipSkillDef): boolean =>
  [...skill.base, ...(skill.heads?.effects ?? []), ...(skill.tails?.effects ?? [])].some(
    (effect) => effect.kind === 'commandChosenSummon'
  );

const hasChooseBasicInHand = (skill: FlipSkillDef): boolean =>
  [...skill.base, ...(skill.heads?.effects ?? []), ...(skill.tails?.effects ?? [])].some(
    (effect) => effect.kind === 'grantElement' && effect.scope === 'chooseBasicInHand'
  );

const suggestedChosen = (state: CombatState, db: ContentDb): CoinUid[] | undefined => {
  const coin = state.zones.hand.find((candidate) => isBasicCoinInHand(state, db, candidate));
  return coin === undefined ? undefined : [coin];
};

// UI가 기본 코인 규칙을 중복 구현하지 않도록 공개하는 조회 헬퍼 (판정 정본은 여전히 step)
export const chooseBasicCandidates = (state: CombatState, db: ContentDb): CoinUid[] =>
  state.zones.hand.filter((candidate) => isBasicCoinInHand(state, db, candidate));

export const skillRequiresCoinChoice = (skill: FlipSkillDef): boolean => hasChooseBasicInHand(skill);

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
        // P6 D6 — 명령 스킬은 소환이 있어야 합법 (없으면 낭비 사용 제안 안 함)
        if (skillCommandsSummon(skill) && state.summons.length === 0) continue;
        const chosen = hasChooseBasicInHand(skill) ? suggestedChosen(state, db) : undefined;
        const chosenEquipment = skillRequiresEquipmentChoice(skill)
          ? (Object.keys(db.equipment ?? {}).sort()[0] as EquipmentDefId | undefined)
          : undefined;
        const chosenSummon = skillCommandsSummon(skill) ? state.summons[0]?.uid : undefined;
        for (const target of targetsForSkill(state, skill.targetType)) {
          const command: Command = { type: 'useFlipSkill', slot, target };
          if (chosen !== undefined) command.chosen = chosen;
          if (chosenEquipment !== undefined) command.chosenEquipment = chosenEquipment;
          if (chosenSummon !== undefined) command.chosenSummon = chosenSummon;
          commands.push(command);
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
