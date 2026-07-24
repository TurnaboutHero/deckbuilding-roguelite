import type { CombatState, Command, ContentDb } from "@game/core";
import { legalCommands } from "@game/core";
import { sameCommand } from "./interaction";
import { fuelRequirement } from "./fuel-selection";

export const REJECTION_TEXT = {
  generic: "지금은 할 수 없다",
  notPlayerPhase: "해결 중에는 안 된다",
  // P7 D1 — 턴당 3회 캡 폐지 → 스킬별 쿨다운 사유로 대체
  usedThisCombat: "이번 전투에 이미 썼다",
  coinCost: "동전이 더 필요하다",
  noFuel: "필요한 동전이 없다",
  coinNotSelectable: "고를 수 없는 동전이다",
  emptySlot: "빈 슬롯이다",
} as const;

export const cooldownReason = (turns: number): string =>
  `재사용 대기 ${turns}턴`;

const slotReason = (
  state: CombatState,
  command: Extract<Command, { type: "useImmediateFlipSkill" | "useConsumeSkill" }>,
  db: ContentDb,
): string | null => {
  const slotState = state.slots[Number(command.slot)];
  if (slotState === undefined) return null;
  if (slotState.skillId === null) return REJECTION_TEXT.emptySlot;
  const skill = db.skills[String(slotState.skillId)];
  if (skill === undefined) return null;
  if (skill.oncePerCombat === true && slotState.usedThisCombat)
    return REJECTION_TEXT.usedThisCombat;
  if (slotState.cooldownRemaining > 0)
    return cooldownReason(slotState.cooldownRemaining);

  if (command.type === "useImmediateFlipSkill") {
    if (skill.type !== "flip") return null;
    if (command.coins.length !== skill.cost) return REJECTION_TEXT.coinCost;
    if (command.coins.some((coin) => !state.zones.hand.includes(coin)))
      return REJECTION_TEXT.coinNotSelectable;
    return null;
  }

  if (skill.type !== "consume") return null;
  const requirement = fuelRequirement(state, command.slot, db);
  if (requirement === null || requirement.available < requirement.min)
    return REJECTION_TEXT.noFuel;
  return null;
};

export function rejectionReason(
  state: CombatState,
  command: Command,
  db: ContentDb,
): string | null {
  if (
    legalCommands(state, db).some((candidate) =>
      sameCommand(candidate, command),
    )
  )
    return null;
  if (state.phase !== "player") return REJECTION_TEXT.notPlayerPhase;

  if (command.type === "useImmediateFlipSkill" || command.type === "useConsumeSkill")
    return slotReason(state, command, db) ?? REJECTION_TEXT.generic;

  return REJECTION_TEXT.generic;
}
