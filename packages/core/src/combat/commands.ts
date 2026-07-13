import type { ContentDb, EffectAtom, FlipSkillDef, SkillDef } from '../content-types';
import { effectiveElements } from '../content-types';
import type { CoinUid, EquipmentDefId, SlotId } from '../ids';
import type { CombatState } from './state';

export type Command =
  | { type: 'placeCoin'; coin: CoinUid; slot: SlotId }
  | { type: 'unplaceCoin'; coin: CoinUid }
  | { type: 'useFlipSkill'; slot: SlotId; target?: number; chosen?: CoinUid[]; chosenEquipment?: EquipmentDefId; chosenSummon?: number }
  | { type: 'useConsumeSkill'; slot: SlotId; coins: CoinUid[]; target?: number; chosenSummon?: number }
  | { type: 'endTurn' };

const livingEnemyTargets = (state: CombatState): number[] =>
  state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [index] : []));

const HOSTILE_STATUSES = new Set(['burn', 'frostbite', 'shock']);

const isHostileProc = (atom: EffectAtom): boolean =>
  atom.kind === 'damage' ||
  atom.kind === 'damagePerTargetBurn' ||
  atom.kind === 'damagePerBlock' ||
  (atom.kind === 'applyStatus' && atom.to === 'target' && HOSTILE_STATUSES.has(atom.status));

/**
 * 자기/무대상 플립 스킬에 공격형 속성 코인이 장전되면 적용할 적을 명시해야 한다.
 * 플립 전에는 면을 알 수 없으므로 어느 면이든 적대 proc이 있으면 대상을 요구한다.
 */
export const flipSkillRequiresEnemyTarget = (
  state: CombatState,
  slot: SlotId,
  skill: FlipSkillDef,
  db: ContentDb
): boolean => {
  if (skill.targetType !== 'self' && skill.targetType !== 'none') return false;
  for (const coinUid of state.zones.placed[slot] ?? []) {
    const instance = state.coins[Number(coinUid)];
    if (instance === undefined) continue;
    for (const element of effectiveElements(instance, db)) {
      const coinDef = Object.values(db.coins).find((candidate) => candidate.element === element);
      if ([...(coinDef?.procs?.heads ?? []), ...(coinDef?.procs?.tails ?? [])].some(isHostileProc)) return true;
    }
  }
  return false;
};

const targetsForSkill = (
  state: CombatState,
  skill: ContentDb['skills'][string],
  slot: SlotId,
  db: ContentDb
): (number | undefined)[] => {
  if (skill.targetType === 'single-enemy') return livingEnemyTargets(state);
  if (skill.type === 'flip' && flipSkillRequiresEnemyTarget(state, slot, skill, db)) {
    return livingEnemyTargets(state);
  }
  return [undefined];
};

const isBasicCoinInHand = (state: CombatState, db: ContentDb, coin: CoinUid): boolean => {
  const instance = state.coins[Number(coin)];
  const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
  return instance !== undefined && def?.element === null && instance.grants.length === 0;
};

export const coinSatisfiesFlipRequirement = (
  state: CombatState,
  db: ContentDb,
  skill: FlipSkillDef,
  coin: CoinUid
): boolean => {
  if (skill.requiredElement === undefined) return true;
  const instance = state.coins[Number(coin)];
  return instance !== undefined && effectiveElements(instance, db).includes(skill.requiredElement);
};

// P6 D6 — 소환 선택 스킬 술어 (UI/심이 선택 필요 여부를 중복 구현하지 않도록 공개)
export const skillRequiresEquipmentChoice = (skill: FlipSkillDef): boolean =>
  [...skill.base, ...(skill.heads?.effects ?? []), ...(skill.tails?.effects ?? [])].some(
    (effect) => effect.kind === 'summonEquipment' && effect.equipment === 'chosen'
  );

const skillEffects = (skill: SkillDef): readonly EffectAtom[] =>
  skill.type === 'flip'
    ? [
        ...skill.base,
        ...(skill.heads?.effects ?? []),
        ...(skill.tails?.effects ?? []),
        ...(skill.mixed?.effects ?? []),
        ...(skill.elementFaces ?? []).flatMap((bonus) => bonus.effects),
        ...(skill.overheatBonus ?? [])
      ]
    : [...skill.effects, ...(skill.overheatBonus ?? [])];

export const skillRequiresSummonChoice = (skill: SkillDef): boolean =>
  skillEffects(skill).some((effect) =>
    effect.kind === 'commandChosenSummon' ||
    effect.kind === 'grantChosenSummonAoe' ||
    effect.kind === 'extendChosenSummon' ||
    effect.kind === 'cloneChosenSummon'
  );

// Backward-compatible name retained for existing callers/tests.
export const skillCommandsSummon = (skill: FlipSkillDef): boolean =>
  skillRequiresSummonChoice(skill);

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
    // P7 D1 — 캡 폐지: 쿨다운 0(가용) 슬롯만. 빈 슬롯(null)은 제안 없음
    if (slotState === undefined || slotState.skillId === null || slotState.cooldownRemaining > 0) continue;
    const skill = db.skills[String(slotState.skillId)];
    if (skill === undefined || (skill.oncePerCombat === true && slotState.usedThisCombat)) continue;

    if (skill.type === 'flip') {
      if ((state.zones.placed[slot]?.length ?? 0) === skill.cost) {
        // P6 D6 — 명령 스킬은 소환이 있어야 합법 (없으면 낭비 사용 제안 안 함)
        if (skillRequiresSummonChoice(skill) && state.summons.length === 0) continue;
        const chosen = hasChooseBasicInHand(skill) ? suggestedChosen(state, db) : undefined;
        const chosenEquipment = skillRequiresEquipmentChoice(skill)
          ? (Object.keys(db.equipment ?? {}).sort()[0] as EquipmentDefId | undefined)
          : undefined;
        const summonChoices = skillRequiresSummonChoice(skill)
          ? state.summons.map((summon) => summon.uid)
          : [undefined];
        for (const target of targetsForSkill(state, skill, slot, db)) {
          for (const chosenSummon of summonChoices) {
            const command: Command = { type: 'useFlipSkill', slot, target };
            if (chosen !== undefined) command.chosen = chosen;
            if (chosenEquipment !== undefined) command.chosenEquipment = chosenEquipment;
            if (chosenSummon !== undefined) command.chosenSummon = chosenSummon;
            commands.push(command);
          }
        }
      }
      if ((state.zones.placed[slot]?.length ?? 0) < skill.cost) {
        for (const coin of state.zones.hand) {
          if (coinSatisfiesFlipRequirement(state, db, skill, coin)) commands.push({ type: 'placeCoin', coin, slot });
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
        if (skillRequiresSummonChoice(skill) && state.summons.length === 0) continue;
        const summonChoices = skillRequiresSummonChoice(skill)
          ? state.summons.map((summon) => summon.uid)
          : [undefined];
        for (const target of targetsForSkill(state, skill, slot, db)) {
          for (const chosenSummon of summonChoices) {
            const command: Command = { type: 'useConsumeSkill', slot, coins: usable, target };
            if (chosenSummon !== undefined) command.chosenSummon = chosenSummon;
            commands.push(command);
          }
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
