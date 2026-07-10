import type { CombatState, Command, ContentDb } from "@game/core";
import { effectiveElements, legalCommands } from "@game/core";

export const REJECTION_TEXT = {
  generic: "지금은 할 수 없다",
  notPlayerPhase: "해결 중에는 안 된다",
  skillCap: "스킬은 턴당 3회까지",
  usedThisTurn: "이미 사용한 스킬이다",
  usedThisCombat: "이번 전투에 이미 썼다",
  socketFull: "소켓이 이미 가득 찼다",
  coinCost: "동전이 더 필요하다",
  noFuel: "필요한 동전이 없다",
  coinNotSelectable: "고를 수 없는 동전이다",
} as const;

const sameCommand = (left: Command, right: Command): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === "endTurn" && right.type === "endTurn") return true;
  if (left.type === "placeCoin" && right.type === "placeCoin")
    return left.coin === right.coin && left.slot === right.slot;
  if (left.type === "unplaceCoin" && right.type === "unplaceCoin")
    return left.coin === right.coin;
  if (left.type === "useFlipSkill" && right.type === "useFlipSkill")
    return left.slot === right.slot && left.target === right.target;
  if (left.type === "useConsumeSkill" && right.type === "useConsumeSkill")
    return (
      left.slot === right.slot &&
      left.target === right.target &&
      left.coins.length === right.coins.length &&
      left.coins.every((coin, index) => coin === right.coins[index])
    );
  return false;
};

const slotReason = (
  state: CombatState,
  command: Extract<Command, { type: "useFlipSkill" | "useConsumeSkill" }>,
  db: ContentDb,
): string | null => {
  const slotState = state.slots[Number(command.slot)];
  if (slotState === undefined) return null;
  const skill = db.skills[String(slotState.skillId)];
  if (skill === undefined) return null;
  if (state.skillUsesThisTurn >= 3) return REJECTION_TEXT.skillCap;
  if (slotState.usedThisTurn) return REJECTION_TEXT.usedThisTurn;
  if (skill.oncePerCombat === true && slotState.usedThisCombat)
    return REJECTION_TEXT.usedThisCombat;

  if (command.type === "useFlipSkill") {
    if (skill.type !== "flip") return null;
    if ((state.zones.placed[command.slot]?.length ?? 0) < skill.cost)
      return REJECTION_TEXT.coinCost;
    return null;
  }

  if (skill.type !== "consume") return null;
  const fuelCount = state.zones.hand.filter((coin) => {
    const instance = state.coins[Number(coin)];
    return (
      instance !== undefined &&
      effectiveElements(instance, db).includes(skill.consume.element)
    );
  }).length;
  if (fuelCount < skill.consume.count) return REJECTION_TEXT.noFuel;
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
      (state.zones.placed[command.slot]?.length ?? 0) >= skill.cost
    )
      return REJECTION_TEXT.socketFull;
    return REJECTION_TEXT.generic;
  }

  if (command.type === "unplaceCoin") {
    const placed = Object.values(state.zones.placed).some((coins) =>
      coins.includes(command.coin),
    );
    return placed ? REJECTION_TEXT.generic : REJECTION_TEXT.coinNotSelectable;
  }

  if (command.type === "useFlipSkill" || command.type === "useConsumeSkill")
    return slotReason(state, command, db) ?? REJECTION_TEXT.generic;

  return REJECTION_TEXT.generic;
}
