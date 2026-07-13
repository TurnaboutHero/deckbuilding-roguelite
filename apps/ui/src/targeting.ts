import type { Command } from "@game/core";

export type TargetingCommand = Extract<
  Command,
  { type: "useFlipSkill" | "useConsumeSkill" }
>;

export type TargetDirection = "left" | "right";

export const livingEnemyTargets = (
  enemies: readonly { hp: number }[],
): number[] =>
  enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [index] : []));

const sameTargetingBase = (
  left: TargetingCommand,
  right: TargetingCommand,
): boolean =>
  left.type === right.type &&
  left.slot === right.slot &&
  left.chosenSummon === right.chosenSummon &&
  (left.type !== "useConsumeSkill" ||
    right.type !== "useConsumeSkill" ||
    (left.coins.length === right.coins.length &&
      left.coins.every((coin, index) => coin === right.coins[index])));

export const legalTargetsForCommand = (
  commands: readonly Command[],
  command: TargetingCommand,
): number[] =>
  commands.flatMap((candidate) =>
    (candidate.type === "useFlipSkill" ||
      candidate.type === "useConsumeSkill") &&
    sameTargetingBase(candidate, command) &&
    candidate.target !== undefined
      ? [candidate.target]
      : [],
  );

export const defaultTarget = (
  legalTargets: readonly number[],
  lastAttackTarget: number | null,
): number | null => {
  if (
    lastAttackTarget !== null &&
    legalTargets.includes(lastAttackTarget)
  )
    return lastAttackTarget;
  return legalTargets[0] ?? null;
};

export const cycleTarget = (
  legalTargets: readonly number[],
  current: number,
  direction: TargetDirection,
): number | null => {
  if (legalTargets.length === 0) return null;
  const index = legalTargets.indexOf(current);
  const nextIndex =
    direction === "left"
      ? (Math.max(0, index) + legalTargets.length - 1) % legalTargets.length
      : (Math.max(0, index) + 1) % legalTargets.length;
  return legalTargets[nextIndex] ?? null;
};
