import type { CoinUid, CombatState, Command, ContentDb, SlotId } from "@game/core";
import {
  legalCommands,
  skillCoinChoiceCandidates,
  skillRequiresCoinChoice,
  step,
} from "@game/core";

export interface CoinChoiceSelection {
  slot: SlotId;
  coins: CoinUid[];
}

// 기본 코인 규칙·후보 집합은 코어 헬퍼가 정본 — UI는 규칙을 중복하지 않는다
const slotNeedsChoice = (
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): boolean => {
  const slotState = state.slots[Number(slot)];
  const skill =
    slotState === undefined ? undefined : db.skills[String(slotState.skillId)];
  return skill?.type === "flip" && skillRequiresCoinChoice(skill);
};

export function coinChoiceCandidates(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): CoinUid[] {
  if (!slotNeedsChoice(state, slot, db)) return [];
  const slotState = state.slots[Number(slot)];
  const skill = slotState?.skillId === null || slotState === undefined
    ? undefined
    : db.skills[String(slotState.skillId)];
  return skill?.type === "flip" ? skillCoinChoiceCandidates(state, db, skill) : [];
}

export function autoSuggestCoinChoice(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): CoinUid[] {
  return coinChoiceCandidates(state, slot, db).slice(0, 1);
}

export function requiresCoinChoiceSelection(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): boolean {
  return coinChoiceCandidates(state, slot, db).length >= 2;
}

export function toggleCoinChoice(
  selection: CoinChoiceSelection,
  coin: CoinUid,
  state: CombatState,
  db: ContentDb,
): CoinChoiceSelection {
  if (!coinChoiceCandidates(state, selection.slot, db).includes(coin))
    return selection;
  return {
    ...selection,
    coins: selection.coins.includes(coin) ? [] : [coin],
  };
}

export function coinChoiceCommand(
  selection: CoinChoiceSelection,
  state: CombatState,
  db: ContentDb,
): Extract<Command, { type: "useFlipSkill" }> | null {
  if (selection.coins.length !== 1) return null;
  // target은 legalCommands가 열거한 합법 대상에서 가져온다 — target 0 고정은
  // 첫 적이 죽은 다중 적 전투에서 확정이 침묵 실패하는 결함 (감시자 발견).
  // 대상 지정 모드가 이어질 경우 App이 이 커맨드의 target을 교체한다.
  const legal = legalCommands(state, db).find(
    (candidate): candidate is Extract<Command, { type: "useFlipSkill" }> =>
      candidate.type === "useFlipSkill" && candidate.slot === selection.slot,
  );
  if (legal === undefined) return null;
  const command: Extract<Command, { type: "useFlipSkill" }> = {
    type: "useFlipSkill",
    slot: selection.slot,
    chosen: selection.coins,
    desiredCoin: legal.desiredCoin,
    target: legal.target,
  };
  return step(state, command, db).ok ? command : null;
}
