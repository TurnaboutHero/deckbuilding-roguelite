import {
  legalCommands,
  previewFlip,
  type Command,
  type CombatState,
  type ConsumeSkillDef,
  type ContentDb,
  type EffectAtom,
  type SlotId,
} from "@game/core";

import { commandKey, stableCommandOrder } from "./command-key";
import type { PolicyId } from "./types";
import { PolicyDecisionError } from "./types";

export interface PublicOutcome {
  readonly expectedDamage: number;
  readonly expectedBlock: number;
  readonly expectedSelfDamage: number;
  readonly expectedBurn: number;
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
  preventedIncomingDamage: 0,
  expectedHpLoss: incomingHpLoss(state),
  unusedResources: unusedResourcesAfter(state, committedResources),
});

const flipOutcome = (
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): PublicOutcome => {
  // Policy evaluation must never consume an injected runtime RNG. The core
  // preview reconstructs its deterministic oracle from the public snapshots.
  const preview = previewFlip({ ...state, rngImpl: undefined }, slot, db);
  const baseLoss = incomingHpLoss(state);
  const expectedSelfDamage = preview.branches.reduce(
    (total, branch) => total + branch.selfDamage * branch.probability,
    0,
  );
  const preventedIncomingDamage = preview.branches.reduce(
    (total, branch) =>
      total + Math.min(baseLoss, branch.block) * branch.probability,
    0,
  );
  const committed = state.zones.placed[slot]?.length ?? 0;

  return {
    expectedDamage: preview.expected.damage,
    expectedBlock: preview.expected.block,
    expectedSelfDamage,
    expectedBurn: preview.expected.burn,
    preventedIncomingDamage,
    expectedHpLoss:
      Math.max(0, baseLoss - preventedIncomingDamage) + expectedSelfDamage,
    unusedResources: unusedResourcesAfter(state, committed),
  };
};

interface GuaranteedEffectTotals {
  expectedDamage: number;
  expectedBlock: number;
  expectedSelfDamage: number;
  expectedBurn: number;
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

const isLegal = (
  state: CombatState,
  db: ContentDb,
  command: Command,
): boolean => {
  const key = commandKey(command);
  return legalCommands(state, db).some(
    (candidate) => commandKey(candidate) === key,
  );
};

const hasLegalCommandKey = (
  legalCommandKeys: ReadonlySet<string>,
  command: Command,
): boolean => legalCommandKeys.has(commandKey(command));

const applyPlannedPlacement = (
  state: CombatState,
  command: Extract<Command, { type: "placeCoin" }>,
): CombatState => ({
  ...state,
  zones: {
    ...state.zones,
    hand: state.zones.hand.filter((coin) => coin !== command.coin),
    placed: {
      ...state.zones.placed,
      [command.slot]: [
        ...(state.zones.placed[command.slot] ?? []),
        command.coin,
      ],
    },
  },
});

const combinations = <T>(values: readonly T[], count: number): T[][] => {
  if (count === 0) return [[]];
  if (count > values.length) return [];
  const result: T[][] = [];

  const visit = (start: number, selected: T[]): void => {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }
    const needed = count - selected.length;
    for (let index = start; index <= values.length - needed; index += 1) {
      const value = values[index];
      if (value === undefined) continue;
      selected.push(value);
      visit(index + 1, selected);
      selected.pop();
    }
  };

  visit(0, []);
  return result;
};

const placementOutcomes = (
  state: CombatState,
  command: Extract<Command, { type: "placeCoin" }>,
  db: ContentDb,
  legalCommandKeys: ReadonlySet<string>,
): PublicOutcome[] => {
  if (!hasLegalCommandKey(legalCommandKeys, command)) return [];
  const slotState = state.slots[Number(command.slot)];
  const skill =
    slotState === undefined ? undefined : db.skills[String(slotState.skillId)];
  if (skill === undefined || skill.type !== "flip") return [];

  const afterFirst = applyPlannedPlacement(state, command);
  const remaining =
    skill.cost - (afterFirst.zones.placed[command.slot]?.length ?? 0);
  if (remaining < 0) return [];

  const legalPlacements = stableCommandOrder(
    legalCommands(afterFirst, db),
  ).filter(
    (candidate): candidate is Extract<Command, { type: "placeCoin" }> =>
      candidate.type === "placeCoin" && candidate.slot === command.slot,
  );

  const plans = combinations(legalPlacements, remaining);
  const outcomes: PublicOutcome[] = [];
  for (const plan of plans) {
    let planned = afterFirst;
    let valid = true;
    for (const placement of plan) {
      if (!isLegal(planned, db, placement)) {
        valid = false;
        break;
      }
      planned = applyPlannedPlacement(planned, placement);
    }
    if (!valid) continue;
    const use = legalCommands(planned, db).find(
      (candidate) =>
        candidate.type === "useFlipSkill" && candidate.slot === command.slot,
    );
    if (use === undefined) continue;
    outcomes.push(flipOutcome(planned, command.slot, db));
  }
  return outcomes;
};

const outcomesForCommand = (
  state: CombatState,
  command: Command,
  db: ContentDb,
  legalCommandKeys: ReadonlySet<string>,
): PublicOutcome[] => {
  switch (command.type) {
    case "useFlipSkill":
      return [flipOutcome(state, command.slot, db)];
    case "useConsumeSkill":
      return [consumeOutcome(state, command, db)];
    case "placeCoin": {
      const planned = placementOutcomes(state, command, db, legalCommandKeys);
      return planned.length > 0 ? planned : [neutralOutcome(state)];
    }
    case "unplaceCoin":
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
  const legalCommandKeys = new Set(commands.map(commandKey));
  const first = commands[0];
  if (first === undefined) {
    throw new PolicyDecisionError("NO_LEGAL_COMMANDS", policyId, state.phase);
  }

  let selected = first;
  let selectedOutcome = bestOutcome(
    outcomesForCommand(state, first, db, legalCommandKeys),
    compare,
  );
  for (const command of commands.slice(1)) {
    const outcome = bestOutcome(
      outcomesForCommand(state, command, db, legalCommandKeys),
      compare,
    );
    if (compare(outcome, selectedOutcome) > 0) {
      selected = command;
      selectedOutcome = outcome;
    }
  }
  return selected;
};
