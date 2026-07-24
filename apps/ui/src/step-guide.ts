import type {
  CombatEvent,
  CombatState,
  Command,
  ContentDb,
} from "@game/core";

import { REJECTION_TEXT, rejectionReason } from "./action-feedback";

export type CombatStep = 1 | 2 | 3;

export interface CombatStepSelection {
  cardSelected: boolean;
  coinSelected: boolean;
  loadedCount: number;
  requiredCount: number;
}

export interface SocketGuidance {
  coinSelected: boolean;
  loaded: boolean;
}

export interface StepGuideFeedback {
  step: CombatStep;
  text: string;
}

export const COMBAT_STEP_LABELS = [
  "① 동전 선택",
  "② 스킬에 걸기",
  "③ 즉시 사용",
] as const;

export const deriveCombatStep = ({
  cardSelected,
  coinSelected,
  loadedCount,
  requiredCount,
}: CombatStepSelection): CombatStep => {
  if (requiredCount > 0 && loadedCount >= requiredCount) return 3;
  if (coinSelected || cardSelected) return 2;
  return 1;
};

export const loadedStepHelper = (step: CombatStep): string | null =>
  step === 3 ? "소켓을 다시 누르면 해제" : null;

export const socketActionLabel = ({
  coinSelected,
  loaded,
}: SocketGuidance): string => {
  if (loaded) return "누르면 해제";
  return coinSelected ? "이 스킬에 걸기" : "손패에서 동전을 먼저 선택";
};

export const socketRejectionFeedback = ({
  coinSelected,
  loaded,
}: SocketGuidance): StepGuideFeedback | null =>
  !loaded && !coinSelected
    ? { step: 1, text: "손패에서 동전을 먼저 선택" }
    : null;

export const drawNotice = (events: readonly CombatEvent[]): string | null => {
  const drawn = [...events]
    .reverse()
    .find(
      (
        event,
      ): event is Extract<CombatEvent, { type: "coinsDrawn" }> =>
        event.type === "coinsDrawn",
    );
  if (drawn === undefined) return null;
  return `${
    events.some((event) => event.type === "witherApplied") ? "위축으로 " : ""
  }동전 ${drawn.coins.length}개를 뽑았습니다`;
};

export const rejectionStepForReason = (reason: string): CombatStep =>
  reason === REJECTION_TEXT.coinCost ||
  reason === REJECTION_TEXT.coinNotSelectable ||
  reason === REJECTION_TEXT.noFuel
    ? 1
    : 3;

export function commandRejectionFeedback(
  state: CombatState,
  command: Command,
  db: ContentDb,
): StepGuideFeedback | null {
  const reason = rejectionReason(state, command, db);
  return reason === null
    ? null
    : { step: rejectionStepForReason(reason), text: reason };
}
