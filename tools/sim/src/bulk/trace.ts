import { contentDb } from "@game/content";
import {
  effectiveElements,
  legalCommands,
  step,
  zoneCoinCount,
  type CoinUid,
  type CombatEvent,
  type CombatState,
  type Command,
} from "@game/core";

import {
  M6_TRACE_SCHEMA_VERSION,
  type M6CombatTrace,
  type M6DecisionTrace,
  type M6SkillDecisionTrace,
  type M6TurnTrace,
} from "../metrics";
import {
  commandKey,
  stableCommandOrder,
  type CombatPolicy,
} from "../policies";
import {
  M6_TRANSCRIPT_SCHEMA_VERSION,
  type M6CombatTranscript,
  type M6CommandEventTrace,
  type M6OpportunitySnapshot,
} from "./types";

interface MutableTurnTrace {
  readonly turn: number;
  readonly drawnCoinUids: Set<number>;
  readonly elementalCoinUidsSeen: Set<number>;
  readonly elementalCoinUidsFlippedHeads: Set<number>;
  elementalCoinsConsumed: number;
  consumeOpportunity: boolean;
  multiCoinSkillOpportunity: boolean;
  playerDamageDealt: number;
  enemyDamageDealt: number;
  burnDamageDealt: number;
  unusedCoinCount: number;
  readonly decisions: M6DecisionTrace[];
}

export interface PolicyCombatResult {
  readonly state: CombatState;
  readonly trace: M6CombatTrace;
  readonly transcript: M6CombatTranscript;
  readonly crash: { code: string } | null;
}

const zoneCoins = (state: CombatState): CoinUid[] => [
  ...state.zones.draw,
  ...state.zones.hand,
  ...Object.values(state.zones.placed).flat(),
  ...state.zones.discard,
  ...state.zones.exhausted,
];

export const combatInvariantViolations = (
  state: CombatState,
  expectedCoins: number,
): string[] => {
  const violations: string[] = [];
  const ledgerSize = Object.keys(state.coins).length;
  const zoned = zoneCoins(state);
  if (zoneCoinCount(state.zones) !== ledgerSize) {
    violations.push("zone coin count mismatch");
  }
  if (ledgerSize !== expectedCoins) violations.push("coin ledger mismatch");
  if (zoned.length !== new Set(zoned.map(Number)).size) {
    violations.push("coin appears in more than one zone");
  }
  if (state.player.hp < 0 || state.player.hp > state.player.maxHp) {
    violations.push("player HP out of range");
  }
  if (state.player.block < 0) violations.push("player block is negative");
  // P9 — 캡 카운터 폐지: 슬롯 쿨다운 범위만 검증 (0~4)
  for (const slot of state.slots) {
    if (
      !Number.isInteger(slot.cooldownRemaining) ||
      slot.cooldownRemaining < 0 ||
      slot.cooldownRemaining > 4
    ) {
      violations.push("slot cooldown is out of range");
      break;
    }
  }
  for (const enemy of state.enemies) {
    if (enemy.hp < 0 || enemy.hp > enemy.maxHp) {
      violations.push("enemy HP out of range");
    }
    if (enemy.block < 0) violations.push("enemy block is negative");
  }
  return violations;
};

const newTurnTrace = (turn: number, availableAtTurnStart: readonly CoinUid[] = []): MutableTurnTrace => ({
  turn,
  // P11 보존 동전은 새 draw 이벤트 없이 다음 턴 손패에 남는다. 기존
  // M6 필드명은 저장 호환을 위해 유지하되, 분모에는 그 턴 실제로 쓸 수
  // 있었던 이월 동전도 포함해 미사용 수가 가용 수를 넘지 않게 한다.
  drawnCoinUids: new Set<number>(availableAtTurnStart.map(Number)),
  elementalCoinUidsSeen: new Set<number>(),
  elementalCoinUidsFlippedHeads: new Set<number>(),
  elementalCoinsConsumed: 0,
  consumeOpportunity: false,
  multiCoinSkillOpportunity: false,
  playerDamageDealt: 0,
  enemyDamageDealt: 0,
  burnDamageDealt: 0,
  unusedCoinCount: 0,
  decisions: [],
});

const isElementalCoin = (state: CombatState, coin: CoinUid): boolean => {
  const instance = state.coins[Number(coin)];
  return instance !== undefined && effectiveElements(instance, contentDb).length > 0;
};

const observeCoin = (
  turn: MutableTurnTrace,
  state: CombatState,
  coin: CoinUid,
): void => {
  turn.drawnCoinUids.add(Number(coin));
  if (isElementalCoin(state, coin)) {
    turn.elementalCoinUidsSeen.add(Number(coin));
  }
};

const applyEventsToTurn = (
  turn: MutableTurnTrace,
  events: readonly CombatEvent[],
  eventState: CombatState,
): void => {
  for (const event of events) {
    if (event.type === "coinsDrawn") {
      for (const coin of event.coins) observeCoin(turn, eventState, coin);
    } else if (event.type === "coinCreated" && event.zone === "hand") {
      observeCoin(turn, eventState, event.coin);
    } else if (event.type === "elementGranted") {
      for (const coin of event.coins) {
        turn.elementalCoinUidsSeen.add(Number(coin));
      }
    } else if (event.type === "coinFlipped" && event.face === "heads") {
      if (isElementalCoin(eventState, event.coin)) {
        // Remise can flip the same physical coin more than once. Utilization
        // remains a unique-coin metric even though the event stream records
        // every actual flip for presentation and replay.
        turn.elementalCoinUidsFlippedHeads.add(Number(event.coin));
      }
    } else if (event.type === "coinsConsumed") {
      turn.elementalCoinsConsumed += event.coins.filter((coin) =>
        isElementalCoin(eventState, coin),
      ).length;
    } else if (event.type === "damageDealt") {
      if (event.target.type === "enemy") {
        turn.playerDamageDealt += event.amount;
        if (event.source === "burn") turn.burnDamageDealt += event.amount;
      } else if (event.source === "enemy") {
        turn.enemyDamageDealt += event.amount;
      }
    }
  }
};

const multiCoinOpportunity = (
  state: CombatState,
  commands: readonly Command[],
): boolean => {
  for (const command of commands) {
    if (command.type === "useConsumeSkill" && command.coins.length >= 2) {
      return true;
    }
    if (command.type === "useFlipSkill") {
      const slot = state.slots[Number(command.slot)];
      const skill =
        slot === undefined ? undefined : contentDb.skills[String(slot.skillId)];
      if (skill?.type === "flip" && skill.cost >= 2) return true;
    }
    if (command.type === "placeCoin") {
      const slot = state.slots[Number(command.slot)];
      const skill =
        slot === undefined ? undefined : contentDb.skills[String(slot.skillId)];
      if (
        skill?.type === "flip" &&
        skill.cost >= 2 &&
        (state.zones.placed[command.slot]?.length ?? 0) +
          state.zones.hand.length >=
          skill.cost
      ) {
        return true;
      }
    }
  }
  return false;
};

const opportunitySnapshot = (
  state: CombatState,
  combatIndex: number,
  decisionIndex: number,
): M6OpportunitySnapshot => {
  const commands = stableCommandOrder(legalCommands(state, contentDb));
  return {
    schemaVersion: M6_TRANSCRIPT_SCHEMA_VERSION,
    combatIndex,
    turn: state.turn,
    decisionIndex,
    legalCommandKeys: commands.map(commandKey),
    handCoinUids: state.zones.hand.map(Number).sort((left, right) => left - right),
    placedCoinUids: Object.values(state.zones.placed)
      .flat()
      .map(Number)
      .sort((left, right) => left - right),
    consumeOpportunity: commands.some(
      (command) => command.type === "useConsumeSkill",
    ),
    multiCoinSkillOpportunity: multiCoinOpportunity(state, commands),
  };
};

const decisionSkillTrace = (
  before: CombatState,
  command: Command,
  events: readonly CombatEvent[],
): M6SkillDecisionTrace | null => {
  if (
    command.type !== "useFlipSkill" &&
    command.type !== "useConsumeSkill"
  ) {
    return null;
  }
  const slot = before.slots[Number(command.slot)];
  if (slot === undefined) return null;
  const resolution = command.type === "useFlipSkill" ? "flip" : "consume";
  const coinCount =
    command.type === "useFlipSkill"
      ? (before.zones.placed[command.slot]?.length ?? 0)
      : command.coins.length;
  const directDamage = events.reduce(
    (total, event) =>
      total +
      (event.type === "damageDealt" &&
      event.target.type === "enemy" &&
      event.source === "skill"
        ? event.amount
        : 0),
    0,
  );
  const blockGained = events.reduce(
    (total, event) =>
      total +
      (event.type === "blockGained" && event.target.type === "player"
        ? event.amount
        : 0),
    0,
  );
  const burnStacksApplied = events.reduce(
    (total, event) =>
      total +
      (event.type === "statusApplied" &&
      event.target.type === "enemy" &&
      event.status === "burn"
        ? event.stacks
        : 0),
    0,
  );
  return {
    skillId: String(slot.skillId),
    resolution,
    coinCount,
    valueContribution: { directDamage, blockGained, burnStacksApplied },
  };
};

const finalizeTurn = (turn: MutableTurnTrace): M6TurnTrace => ({
  schemaVersion: M6_TRACE_SCHEMA_VERSION,
  turn: turn.turn,
  drawnCoinCount: turn.drawnCoinUids.size,
  unusedCoinCount: turn.unusedCoinCount,
  elementalCoinsSeen: turn.elementalCoinUidsSeen.size,
  elementalCoinsFlippedHeads: turn.elementalCoinUidsFlippedHeads.size,
  elementalCoinsConsumed: turn.elementalCoinsConsumed,
  consumeOpportunity: turn.consumeOpportunity,
  multiCoinSkillOpportunity: turn.multiCoinSkillOpportunity,
  playerDamageDealt: turn.playerDamageDealt,
  enemyDamageDealt: turn.enemyDamageDealt,
  burnDamageDealt: turn.burnDamageDealt,
  decisions: turn.decisions,
});

const unusedCoinCount = (state: CombatState): number =>
  state.zones.hand.length + Object.values(state.zones.placed).flat().length;

export const playPolicyCombat = (
  initial: CombatState,
  combatIndex: number,
  policy: CombatPolicy,
  maxCommands: number,
): PolicyCombatResult => {
  let state = initial;
  let expectedCoins = Object.keys(state.coins).length;
  const invariantViolations = combatInvariantViolations(state, expectedCoins);
  const turns: M6TurnTrace[] = [];
  const opportunities: M6OpportunitySnapshot[] = [];
  const commandEvents: M6CommandEventTrace[] = [];
  let activeTurn = newTurnTrace(state.turn, state.zones.hand);
  for (const coin of state.zones.hand) observeCoin(activeTurn, state, coin);
  applyEventsToTurn(activeTurn, state.events, state);
  let crash: { code: string } | null =
    invariantViolations.length > 0 ? { code: "INVARIANT_VIOLATION" } : null;

  for (
    let commandIndex = 0;
    commandIndex < maxCommands && state.phase === "player" && crash === null;
    commandIndex += 1
  ) {
    const decisionIndex = activeTurn.decisions.length;
    const opportunity = opportunitySnapshot(
      state,
      combatIndex,
      decisionIndex,
    );
    opportunities.push(opportunity);
    activeTurn.consumeOpportunity ||= opportunity.consumeOpportunity;
    activeTurn.multiCoinSkillOpportunity ||=
      opportunity.multiCoinSkillOpportunity;

    const beforeStateText = JSON.stringify(state);
    let command: Command;
    try {
      command = policy.choose(state, contentDb);
    } catch (error) {
      crash = {
        code:
          error instanceof Error && error.name === "PolicyDecisionError"
            ? "POLICY_DECISION_ERROR"
            : "POLICY_THROW",
      };
      break;
    }
    if (JSON.stringify(state) !== beforeStateText) {
      invariantViolations.push("policy mutated observed combat state");
      crash = { code: "POLICY_STATE_MUTATION" };
      break;
    }

    const key = commandKey(command);
    if (!opportunity.legalCommandKeys.includes(key)) {
      invariantViolations.push(`policy chose illegal command: ${key}`);
      crash = { code: "POLICY_ILLEGAL_COMMAND" };
      break;
    }

    const before = state;
    const result = step(state, command, contentDb);
    if (!result.ok) {
      commandEvents.push({
        schemaVersion: M6_TRANSCRIPT_SCHEMA_VERSION,
        combatIndex,
        turn: before.turn,
        decisionIndex,
        commandKey: key,
        command,
        events: [],
      });
      invariantViolations.push(`step rejected legal command: ${result.error}`);
      crash = { code: "STEP_REJECTED" };
      break;
    }

    state = result.state;
    commandEvents.push({
      schemaVersion: M6_TRANSCRIPT_SCHEMA_VERSION,
      combatIndex,
      turn: before.turn,
      decisionIndex,
      commandKey: key,
      command,
      events: result.events,
    });
    activeTurn.decisions.push({
      schemaVersion: M6_TRACE_SCHEMA_VERSION,
      decisionIndex,
      turn: before.turn,
      commandKey: key,
      commandType: command.type,
      skill: decisionSkillTrace(before, command, result.events),
    });

    const advancedTurn = state.turn !== before.turn;
    const currentEvents = advancedTurn
      ? result.events.filter((event) => event.type !== "coinsDrawn")
      : result.events;
    applyEventsToTurn(activeTurn, currentEvents, state);
    expectedCoins += result.events.filter(
      (event) => event.type === "coinCreated",
    ).length;
    const stepViolations = combatInvariantViolations(state, expectedCoins);
    invariantViolations.push(...stepViolations);

    if (
      command.type === "endTurn" ||
      state.phase === "victory" ||
      state.phase === "defeat"
    ) {
      activeTurn.unusedCoinCount =
        command.type === "endTurn"
          ? unusedCoinCount(before)
          : unusedCoinCount(state);
    }

    if (advancedTurn || state.phase !== "player") {
      turns.push(finalizeTurn(activeTurn));
      if (advancedTurn && state.phase === "player") {
        activeTurn = newTurnTrace(state.turn, state.zones.hand);
        for (const coin of state.zones.hand) observeCoin(activeTurn, state, coin);
        applyEventsToTurn(
          activeTurn,
          result.events.filter((event) => event.type === "coinsDrawn"),
          state,
        );
      }
    }
    if (stepViolations.length > 0) {
      crash = { code: "INVARIANT_VIOLATION" };
    }
  }

  if (
    state.phase === "player" &&
    activeTurn.decisions.length > 0 &&
    turns.every((turn) => turn.turn !== activeTurn.turn)
  ) {
    activeTurn.unusedCoinCount = unusedCoinCount(state);
    turns.push(finalizeTurn(activeTurn));
  }

  const result =
    state.phase === "victory" || state.phase === "defeat"
      ? state.phase
      : "nonterminal";
  return {
    state,
    trace: {
      schemaVersion: M6_TRACE_SCHEMA_VERSION,
      combatIndex,
      enemyIds: initial.enemies.map((enemy) => String(enemy.defId)),
      startingPlayerHp: initial.player.hp,
      endingPlayerHp: state.player.hp,
      result,
      invariantViolations,
      turns,
    },
    transcript: {
      schemaVersion: M6_TRANSCRIPT_SCHEMA_VERSION,
      combatIndex,
      initialRng: initial.rng,
      initialEvents: initial.events,
      opportunities,
      commands: commandEvents,
    },
    crash,
  };
};
