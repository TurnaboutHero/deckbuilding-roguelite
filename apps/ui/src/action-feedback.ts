import type { CombatState, Command, ContentDb } from "@game/core";
import { isRepeatReservationEligible, legalCommands } from "@game/core";
import { sameCommand } from "./interaction";
import { fuelRequirement } from "./fuel-selection";

export const REJECTION_TEXT = {
  generic: "지금은 할 수 없다",
  notPlayerPhase: "해결 중에는 안 된다",
  // P7 D1 — 턴당 3회 캡 폐지 → 스킬별 쿨다운 사유로 대체
  usedThisCombat: "이번 전투에 이미 썼다",
  socketFull: "소켓이 이미 가득 찼다",
  coinCost: "동전이 더 필요하다",
  noFuel: "필요한 동전이 없다",
  coinNotSelectable: "고를 수 없는 동전이다",
  emptySlot: "빈 슬롯이다",
} as const;

export const cooldownReason = (turns: number): string =>
  `재사용 대기 ${turns}턴`;

const slotReason = (
  state: CombatState,
  command: Extract<Command, { type: "useImmediateFlipSkill" | "useFlipSkill" | "useConsumeSkill" }>,
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

  if (command.type === "useFlipSkill") {
    if (skill.type !== "flip") return null;
    const reservation =
      command.reservationId === undefined
        ? state.flipReservations.find((candidate) => candidate.slot === command.slot)
        : state.flipReservations.find(
            (candidate) =>
              candidate.id === command.reservationId && candidate.slot === command.slot,
          );
    if (reservation === undefined)
      return REJECTION_TEXT.coinCost;
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

  if (command.type === "placeCoin") {
    if (!state.zones.hand.includes(command.coin))
      return REJECTION_TEXT.coinNotSelectable;
    const slotState = state.slots[Number(command.slot)];
    const skill =
      slotState === undefined
        ? undefined
        : db.skills[String(slotState.skillId)];
    if (
      skill?.type === "flip" &&
      (!isRepeatReservationEligible(skill) &&
        state.flipReservations.some((reservation) => reservation.slot === command.slot))
    )
      return REJECTION_TEXT.socketFull;
    return REJECTION_TEXT.generic;
  }

  if (command.type === "unplaceCoin") {
    const placed =
      Object.values(state.zones.placed).some((coins) => coins.includes(command.coin)) ||
      state.flipReservations.some((reservation) => reservation.coinUids.includes(command.coin));
    return placed ? REJECTION_TEXT.generic : REJECTION_TEXT.coinNotSelectable;
  }

  if (command.type === "useImmediateFlipSkill" || command.type === "useFlipSkill" || command.type === "useConsumeSkill")
    return slotReason(state, command, db) ?? REJECTION_TEXT.generic;

  return REJECTION_TEXT.generic;
}
