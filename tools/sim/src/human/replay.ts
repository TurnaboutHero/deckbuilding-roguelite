import { CONTENT_VERSION, contentDb } from "@game/content";
import {
  chooseCoinReward,
  chooseSkillReward,
  createRun,
  resolveCoinRemoval,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  step,
} from "@game/core";
import type {
  CoinDefId,
  CoinUid,
  Command,
  CombatEvent,
  CombatState,
  RunState,
  SkillId,
  SlotId,
} from "@game/core";

import type {
  HumanDamageFact,
  HumanDecisionFact,
  HumanRewardFact,
  HumanRunTraceLike,
  ReplayedDecision,
  TelemetryCommand,
  VerifiedHumanRun,
} from "./types";

export interface ReplayVerification {
  ok: boolean;
  mismatches: string[];
}

const character = "warrior" as never;

const commandFromTelemetry = (command: TelemetryCommand): Command => {
  if (command.type === "placeCoin") {
    return {
      type: "placeCoin",
      coin: command.coin as CoinUid,
      slot: command.slot as SlotId,
    };
  }
  if (command.type === "unplaceCoin") {
    return { type: "unplaceCoin", coin: command.coin as CoinUid };
  }
  if (command.type === "useFlipSkill") {
    return command.target === undefined
      ? { type: "useFlipSkill", slot: command.slot as SlotId }
      : {
          type: "useFlipSkill",
          slot: command.slot as SlotId,
          target: command.target,
        };
  }
  if (command.type === "useConsumeSkill") {
    const converted = {
      type: "useConsumeSkill" as const,
      slot: command.slot as SlotId,
      coins: command.coins.map((coin) => coin as CoinUid),
    };
    return command.target === undefined
      ? converted
      : { ...converted, target: command.target };
  }
  return { type: "endTurn" };
};

const hpList = (state: CombatState): number[] =>
  state.enemies.map((enemy) => enemy.hp);

const sameNumberArray = (
  left: readonly number[],
  right: readonly number[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const stableJson = (value: unknown): string => JSON.stringify(value);

const eventSkills = (
  events: readonly CombatEvent[],
): HumanDecisionFact["skills"] =>
  events.flatMap((event) =>
    event.type === "skillUsed"
      ? [
          {
            slot: Number(event.slot),
            skill: String(event.skill),
            kind: event.kind,
          },
        ]
      : [],
  );

const eventFlips = (
  events: readonly CombatEvent[],
): HumanDecisionFact["flips"] =>
  events.flatMap((event) =>
    event.type === "coinFlipped"
      ? [{ coin: Number(event.coin), face: event.face }]
      : [],
  );

const eventDamage = (events: readonly CombatEvent[]): HumanDamageFact[] =>
  events.flatMap((event) => {
    if (event.type !== "damageDealt") return [];
    const target =
      event.target.type === "player"
        ? ({ target: "player" } as const)
        : ({ target: "enemy", enemyIndex: event.target.index } as const);
    return [
      {
        ...target,
        amount: event.amount,
        blocked: event.blocked,
        source: event.source,
      },
    ];
  });

const pushMismatch = (
  mismatches: string[],
  path: string,
  expected: unknown,
  actual: unknown,
): void => {
  if (stableJson(expected) !== stableJson(actual)) {
    mismatches.push(
      `${path} mismatch: recorded ${stableJson(expected)} replayed ${stableJson(actual)}`,
    );
  }
};

const verifyDecisionFacts = (
  mismatches: string[],
  path: string,
  decision: HumanDecisionFact,
  before: CombatState,
  after: CombatState,
  events: readonly CombatEvent[],
): void => {
  if (decision.turn !== before.turn) {
    mismatches.push(
      `${path}.turn mismatch: recorded ${decision.turn} replayed ${before.turn}`,
    );
  }
  if (decision.hp.playerBefore !== before.player.hp) {
    mismatches.push(
      `${path}.hp.playerBefore mismatch: recorded ${decision.hp.playerBefore} replayed ${before.player.hp}`,
    );
  }
  if (!sameNumberArray(decision.hp.enemiesBefore, hpList(before))) {
    pushMismatch(
      mismatches,
      `${path}.hp.enemiesBefore`,
      decision.hp.enemiesBefore,
      hpList(before),
    );
  }
  if (decision.hp.playerAfter !== after.player.hp) {
    mismatches.push(
      `${path}.hp.playerAfter mismatch: recorded ${decision.hp.playerAfter} replayed ${after.player.hp}`,
    );
  }
  if (!sameNumberArray(decision.hp.enemiesAfter, hpList(after))) {
    pushMismatch(
      mismatches,
      `${path}.hp.enemiesAfter`,
      decision.hp.enemiesAfter,
      hpList(after),
    );
  }
  pushMismatch(mismatches, `${path}.skills`, decision.skills, eventSkills(events));
  pushMismatch(mismatches, `${path}.flips`, decision.flips, eventFlips(events));
  pushMismatch(mismatches, `${path}.damage`, decision.damage, eventDamage(events));
};

const optionsMatch = (
  recorded: readonly string[],
  actual: readonly unknown[],
): boolean =>
  sameNumberArray(
    recorded.map((_value, index) => index),
    actual.map((_value, index) => index),
  ) && recorded.every((value, index) => value === String(actual[index]));

const resolveReward = (
  input: RunState,
  reward: HumanRewardFact,
  mismatches: string[],
): RunState => {
  if (input.phase !== "rewards" || input.pendingRewards === undefined) {
    mismatches.push(
      `reward ${reward.combatIndex}/${reward.stage} mismatch: run is not resolving rewards`,
    );
    return input;
  }
  const pending = input.pendingRewards;
  const path = `reward ${reward.combatIndex}/${reward.stage}`;
  if (reward.stage === "coin" || reward.stage === "fallback-coin") {
    if (!optionsMatch(reward.options, pending.coinOptions)) {
      mismatches.push(
        `${path}.options mismatch: recorded ${stableJson(reward.options)} replayed ${stableJson(pending.coinOptions.map(String))}`,
      );
    }
    const choice = reward.choice === null ? null : (reward.choice as CoinDefId);
    try {
      return chooseCoinReward(input, choice);
    } catch (error) {
      mismatches.push(`${path} resolution failed: ${error instanceof Error ? error.message : String(error)}`);
      return input;
    }
  }
  if (reward.stage === "removal") {
    try {
      return resolveCoinRemoval(input, reward.bagIndex ?? null, contentDb);
    } catch (error) {
      mismatches.push(`${path} resolution failed: ${error instanceof Error ? error.message : String(error)}`);
      return input;
    }
  }
  if (!optionsMatch(reward.options, pending.skillOptions)) {
    mismatches.push(
      `${path}.options mismatch: recorded ${stableJson(reward.options)} replayed ${stableJson(pending.skillOptions.map(String))}`,
    );
  }
  try {
    if (reward.choice === null) return skipSkillReward(input);
    return chooseSkillReward(
      input,
      reward.choice as SkillId,
      reward.replacedSlot,
    );
  } catch (error) {
    mismatches.push(`${path} resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    return input;
  }
};

const rewardsForCombat = (
  rewards: readonly HumanRewardFact[],
  combatIndex: number,
): HumanRewardFact[] =>
  rewards.filter((reward) => reward.combatIndex === combatIndex);

export function replayHumanRun(trace: HumanRunTraceLike): {
  verification: ReplayVerification;
  run?: VerifiedHumanRun;
} {
  const mismatches: string[] = [];
  const decisions: ReplayedDecision[] = [];
  const combats: VerifiedHumanRun["combats"] = [];

  if (trace.contentVersion !== CONTENT_VERSION) {
    return {
      verification: {
        ok: false,
        mismatches: [
          `content drift: trace contentVersion ${trace.contentVersion} does not match ${CONTENT_VERSION}`,
        ],
      },
    };
  }

  let run: RunState;
  try {
    run = createRun(
      {
        contentVersion: CONTENT_VERSION,
        runSeed: trace.runSeed,
        character,
      },
      contentDb,
    );
  } catch (error) {
    return {
      verification: {
        ok: false,
        mismatches: [
          `createRun failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
    };
  }

  if (trace.maxHp !== run.maxHp) {
    mismatches.push(
      `trace.maxHp mismatch: recorded ${trace.maxHp} replayed ${run.maxHp}`,
    );
  }

  const sortedCombats = [...trace.combats].sort(
    (left, right) =>
      left.combatIndex - right.combatIndex || left.attempt - right.attempt,
  );

  for (const combatTrace of sortedCombats) {
    if (run.phase !== "ready") {
      mismatches.push(
        `combat ${combatTrace.combatIndex} mismatch: run phase is ${run.phase}`,
      );
      break;
    }
    if (combatTrace.combatIndex !== run.combatIndex) {
      mismatches.push(
        `combatIndex mismatch: recorded ${combatTrace.combatIndex} replayed ${run.combatIndex}`,
      );
    }
    if (combatTrace.attempt !== run.attempt) {
      mismatches.push(
        `combat ${combatTrace.combatIndex}.attempt mismatch: recorded ${combatTrace.attempt} replayed ${run.attempt}`,
      );
    }

    const started = startRunCombat(run, contentDb);
    let state = started.combat;
    if (combatTrace.startingHp !== state.player.hp) {
      mismatches.push(
        `combat ${combatTrace.combatIndex}.startingHp mismatch: recorded ${combatTrace.startingHp} replayed ${state.player.hp}`,
      );
    }
    pushMismatch(
      mismatches,
      `combat ${combatTrace.combatIndex}.enemyIds`,
      combatTrace.enemyIds,
      state.enemies.map((enemy) => String(enemy.defId)),
    );

    for (let index = 0; index < combatTrace.decisions.length; index += 1) {
      const decision = combatTrace.decisions[index];
      if (decision === undefined) continue;
      if (state.phase !== "player") {
        mismatches.push(
          `combat ${combatTrace.combatIndex}.decisions[${index}] cannot replay: combat phase is ${state.phase}`,
        );
        break;
      }
      const before = state;
      const commands = decision.commands.map(commandFromTelemetry);
      const events: CombatEvent[] = [];
      for (const command of commands) {
        const result = step(state, command, contentDb);
        if (!result.ok) {
          mismatches.push(
            `combat ${combatTrace.combatIndex}.decisions[${index}] command ${stableJson(command)} failed: ${result.error}`,
          );
          break;
        }
        state = result.state;
        events.push(...result.events);
      }
      verifyDecisionFacts(
        mismatches,
        `combat ${combatTrace.combatIndex}.decisions[${index}]`,
        decision,
        before,
        state,
        events,
      );
      decisions.push({
        combatIndex: combatTrace.combatIndex,
        enemyIds: combatTrace.enemyIds,
        decision,
        before,
        after: state,
        events,
        commands,
      });
    }

    if (state.phase !== "victory" && state.phase !== "defeat") {
      mismatches.push(
        `combat ${combatTrace.combatIndex} did not replay to terminal phase; replayed ${state.phase}`,
      );
      break;
    }
    if (combatTrace.outcome === undefined) {
      mismatches.push(`combat ${combatTrace.combatIndex}.outcome is missing`);
    } else {
      const outcome = combatTrace.outcome;
      if (outcome.result !== state.phase) {
        mismatches.push(
          `combat ${combatTrace.combatIndex}.outcome.result mismatch: recorded ${outcome.result} replayed ${state.phase}`,
        );
      }
      if (outcome.turns !== state.turn) {
        mismatches.push(
          `combat ${combatTrace.combatIndex}.outcome.turns mismatch: recorded ${outcome.turns} replayed ${state.turn}`,
        );
      }
      if (outcome.playerHp !== state.player.hp) {
        mismatches.push(
          `combat ${combatTrace.combatIndex}.outcome.playerHp mismatch: recorded ${outcome.playerHp} replayed ${state.player.hp}`,
        );
      }
      pushMismatch(
        mismatches,
        `combat ${combatTrace.combatIndex}.outcome.enemyHp`,
        outcome.enemyHp,
        hpList(state),
      );
    }

    combats.push({
      combatIndex: combatTrace.combatIndex,
      enemyIds: state.enemies.map((enemy) => String(enemy.defId)),
      turns: state.turn,
      result: state.phase,
      playerHp: state.player.hp,
    });

    run = settleRunCombat(started.run, state, contentDb);
    if (run.phase === "rewards") {
      for (const reward of rewardsForCombat(trace.rewards, combatTrace.combatIndex)) {
        run = resolveReward(run, reward, mismatches);
      }
    }
  }

  if (trace.result !== "in-progress" && trace.result !== run.phase) {
    mismatches.push(
      `trace.result mismatch: recorded ${trace.result} replayed ${run.phase}`,
    );
  }
  if (trace.finalHp !== undefined && trace.finalHp !== run.currentHp) {
    mismatches.push(
      `trace.finalHp mismatch: recorded ${trace.finalHp} replayed ${run.currentHp}`,
    );
  }

  return {
    verification: { ok: mismatches.length === 0, mismatches },
    run:
      mismatches.length === 0
        ? { trace, decisions, combats }
        : undefined,
  };
}
