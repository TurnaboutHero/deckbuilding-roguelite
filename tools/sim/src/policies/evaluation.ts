import {
  legalCommands,
  statusStacks,
  step,
  type Command,
  type CombatState,
  type ConsumeSkillDef,
  type ContentDb,
  type EffectAtom,
} from "@game/core";

import { stableCommandOrder } from "./command-key";
import type { PolicyId } from "./types";
import { PolicyDecisionError } from "./types";

export interface PublicOutcome {
  readonly expectedDamage: number;
  readonly expectedBlock: number;
  readonly expectedSelfDamage: number;
  readonly expectedBurn: number;
  readonly expectedResourcesCreated: number;
  readonly preventedIncomingDamage: number;
  readonly expectedHpLoss: number;
  readonly unusedResources: number;
}

export type OutcomeComparator = (
  candidate: PublicOutcome,
  incumbent: PublicOutcome,
) => number;

const incomingDamage = (state: CombatState): number =>
  state.enemies.reduce(
    (total, enemy) =>
      total +
      (enemy.hp <= 0
        ? 0
        : enemy.intent.actions.reduce(
            (intentTotal, action) =>
              intentTotal +
              (action.kind === "attack"
                ? action.damage * (action.hits ?? 1)
                : 0),
            0,
          )),
    0,
  );

const incomingHpLoss = (state: CombatState): number =>
  Math.max(0, incomingDamage(state) - state.player.block);

const availableResourceCount = (state: CombatState): number =>
  state.zones.hand.length +
  Object.values(state.zones.placed).reduce(
    (total, coins) => total + coins.length,
    0,
  );

const unusedResourcesAfter = (
  state: CombatState,
  committedResources: number,
): number => Math.max(0, availableResourceCount(state) - committedResources);

const neutralOutcome = (
  state: CombatState,
  committedResources = 0,
): PublicOutcome => ({
  expectedDamage: 0,
  expectedBlock: 0,
  expectedSelfDamage: 0,
  expectedBurn: 0,
  expectedResourcesCreated: 0,
  preventedIncomingDamage: 0,
  expectedHpLoss: incomingHpLoss(state),
  unusedResources: unusedResourcesAfter(state, committedResources),
});

const immediateFlipOutcome = (
  state: CombatState,
  command: Extract<Command, { type: "useImmediateFlipSkill" }>,
  db: ContentDb,
): PublicOutcome => {
  const result = step(state, command, db);
  if (!result.ok) return neutralOutcome(state);
  const expectedDamage = state.enemies.reduce(
    (total, enemy, index) => total + Math.max(0, enemy.hp - (result.state.enemies[index]?.hp ?? enemy.hp)),
    0,
  );
  const expectedBlock = Math.max(0, result.state.player.block - state.player.block);
  const expectedSelfDamage = Math.max(0, state.player.hp - result.state.player.hp);
  const expectedBurn = result.state.enemies.reduce(
    (total, enemy, index) =>
      total + Math.max(0, statusStacks(enemy.statuses, "burn") - statusStacks(state.enemies[index]?.statuses ?? {}, "burn")),
    0,
  );
  const expectedResourcesCreated = Math.max(
    0,
    Object.keys(result.state.coins).length - Object.keys(state.coins).length,
  );
  const baseLoss = incomingHpLoss(state);
  const preventedIncomingDamage = Math.min(baseLoss, expectedBlock);
  return {
    expectedDamage,
    expectedBlock,
    expectedSelfDamage,
    expectedBurn,
    expectedResourcesCreated,
    preventedIncomingDamage,
    expectedHpLoss: Math.max(0, baseLoss - preventedIncomingDamage) + expectedSelfDamage,
    unusedResources: unusedResourcesAfter(state, command.coins.length),
  };
};

interface GuaranteedEffectTotals {
  expectedDamage: number;
  expectedBlock: number;
  expectedSelfDamage: number;
  expectedBurn: number;
  expectedResourcesCreated: number;
  finalPlayerBlock: number;
}

const firstAliveEnemy = (state: CombatState): number | undefined => {
  const index = state.enemies.findIndex((enemy) => enemy.hp > 0);
  return index < 0 ? undefined : index;
};

const consumeTarget = (
  state: CombatState,
  skill: ConsumeSkillDef,
  command: Extract<Command, { type: "useConsumeSkill" }>,
): { type: "player" } | { type: "enemy"; index: number } => {
  if (skill.targetType === "self" || skill.targetType === "none") {
    return { type: "player" };
  }
  if (skill.targetType === "single-enemy") {
    return {
      type: "enemy",
      index: command.target ?? firstAliveEnemy(state) ?? 0,
    };
  }
  return { type: "enemy", index: firstAliveEnemy(state) ?? 0 };
};

const summarizeGuaranteedEffects = (
  state: CombatState,
  skill: ConsumeSkillDef,
  command: Extract<Command, { type: "useConsumeSkill" }>,
): GuaranteedEffectTotals => {
  const target = consumeTarget(state, skill, command);
  let playerBlock = state.player.block;
  let targetBlock =
    target.type === "enemy" ? (state.enemies[target.index]?.block ?? 0) : 0;
  let expectedDamage = 0;
  let expectedBlock = 0;
  let expectedSelfDamage = 0;
  let expectedBurn = 0;
  let expectedResourcesCreated = 0;

  const applyGuaranteedEffect = (effect: EffectAtom): void => {
    switch (effect.kind) {
      case "damage": {
        if (target.type === "enemy") {
          const blocked = Math.min(targetBlock, effect.amount);
          targetBlock -= blocked;
          expectedDamage += effect.amount - blocked;
        } else {
          const blocked = Math.min(playerBlock, effect.amount);
          playerBlock -= blocked;
          expectedSelfDamage += effect.amount - blocked;
        }
        return;
      }
      case "block":
        playerBlock += effect.amount;
        expectedBlock += effect.amount;
        return;
      case "selfDamage": {
        const blocked = Math.min(playerBlock, effect.amount);
        playerBlock -= blocked;
        expectedSelfDamage += effect.amount - blocked;
        return;
      }
      case "applyStatus":
        if (effect.status === "burn") {
          const statusTarget = effect.to === "self" ? "player" : target.type;
          if (statusTarget === "enemy") expectedBurn += effect.stacks;
          else expectedSelfDamage += effect.stacks;
        }
        return;
      case "addCoin":
        expectedResourcesCreated += effect.count;
        return;
      case "draw":
        expectedResourcesCreated += effect.count;
        return;
      case "grantElement":
        return;
    }
  };

  for (const effect of skill.effects) applyGuaranteedEffect(effect);
  return {
    expectedDamage,
    expectedBlock,
    expectedSelfDamage,
    expectedBurn,
    expectedResourcesCreated,
    finalPlayerBlock: playerBlock,
  };
};

const consumeOutcome = (
  state: CombatState,
  command: Extract<Command, { type: "useConsumeSkill" }>,
  db: ContentDb,
): PublicOutcome => {
  const slotState = state.slots[Number(command.slot)];
  const skill =
    slotState === undefined ? undefined : db.skills[String(slotState.skillId)];
  if (skill === undefined || skill.type !== "consume") {
    return neutralOutcome(state);
  }

  const totals = summarizeGuaranteedEffects(state, skill, command);
  const { finalPlayerBlock, ...guaranteed } = totals;
  const before = incomingHpLoss(state);
  const after = Math.max(0, incomingDamage(state) - finalPlayerBlock);
  const preventedIncomingDamage = Math.max(0, before - after);

  return {
    ...guaranteed,
    preventedIncomingDamage,
    expectedHpLoss: after + guaranteed.expectedSelfDamage,
    unusedResources: unusedResourcesAfter(state, command.coins.length),
  };
};

const outcomesForCommand = (
  state: CombatState,
  command: Command,
  db: ContentDb,
): PublicOutcome[] => {
  switch (command.type) {
    case "useImmediateFlipSkill":
      return [immediateFlipOutcome(state, command, db)];
    case "useConsumeSkill":
      return [consumeOutcome(state, command, db)];
    case "endTurn":
      return [neutralOutcome(state)];
  }
};

const bestOutcome = (
  outcomes: readonly PublicOutcome[],
  compare: OutcomeComparator,
): PublicOutcome => {
  const first = outcomes[0];
  if (first === undefined) throw new Error("command outcome list is empty");
  return outcomes
    .slice(1)
    .reduce(
      (best, candidate) => (compare(candidate, best) > 0 ? candidate : best),
      first,
    );
};

export const chooseEvaluatedCommand = (
  policyId: PolicyId,
  state: CombatState,
  db: ContentDb,
  compare: OutcomeComparator,
): Command => {
  const commands = stableCommandOrder(legalCommands(state, db));
  const first = commands[0];
  if (first === undefined) {
    throw new PolicyDecisionError("NO_LEGAL_COMMANDS", policyId, state.phase);
  }

  let selected = first;
  let selectedOutcome = bestOutcome(
    outcomesForCommand(state, first, db),
    compare,
  );
  for (const command of commands.slice(1)) {
    const outcome = bestOutcome(
      outcomesForCommand(state, command, db),
      compare,
    );
    if (compare(outcome, selectedOutcome) > 0) {
      selected = command;
      selectedOutcome = outcome;
    }
  }
  return selected;
};
