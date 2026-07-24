import { CONTENT_VERSION, contentDb } from "@game/content";
import {
  acceptEvent,
  buyShopCoin,
  buyShopPassive,
  buyShopRemoval,
  buyShopSkill,
  chooseCoinReward,
  choosePassiveReward,
  chooseRunNode,
  chooseSkillReward,
  claimTreasure,
  createRun,
  declineEvent,
  leaveShop,
  resolveCoinRemoval,
  restHeal,
  restUpgrade,
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
  EquipmentDefId,
  PassiveId,
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

export const commandFromHumanTelemetry = (command: TelemetryCommand): Command => {
  if (command.type === "useImmediateFlipSkill") {
    return {
      type: "useImmediateFlipSkill",
      slot: command.slot as SlotId,
      coins: command.coins.map((coin) => coin as CoinUid),
      ...(command.target === undefined ? {} : { target: command.target }),
      ...(command.chosen === undefined
        ? {}
        : { chosen: command.chosen.map((coin) => coin as CoinUid) }),
      ...(command.desiredCoin === undefined
        ? {}
        : { desiredCoin: command.desiredCoin as CoinDefId }),
      ...(command.chosenEquipment === undefined
        ? {}
        : { chosenEquipment: command.chosenEquipment as EquipmentDefId }),
      ...(command.chosenSummon === undefined
        ? {}
        : { chosenSummon: command.chosenSummon }),
    };
  }
  if (command.type === "useConsumeSkill") {
    const converted = {
      type: "useConsumeSkill" as const,
      slot: command.slot as SlotId,
      coins: command.coins.map((coin) => coin as CoinUid),
    };
    return {
      ...converted,
      ...(command.target === undefined ? {} : { target: command.target }),
      ...(command.desiredCoin === undefined
        ? {}
        : { desiredCoin: command.desiredCoin as CoinDefId }),
      ...(command.chosenSummon === undefined
        ? {}
        : { chosenSummon: command.chosenSummon }),
    };
  }
  return command.preserve === undefined
    ? { type: "endTurn" }
    : {
        type: "endTurn",
        preserve: command.preserve.map((coin) => coin as CoinUid),
      };
};

const hpList = (state: CombatState): number[] =>
  state.enemies.map((enemy) => enemy.hp);

const furnaceList = (state: CombatState): number[] =>
  state.enemies.map((enemy) => enemy.furnaceTemperature ?? 0);

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
  if (
    decision.hp.enemyFurnaceBefore !== undefined &&
    !sameNumberArray(decision.hp.enemyFurnaceBefore, furnaceList(before))
  ) {
    pushMismatch(
      mismatches,
      `${path}.hp.enemyFurnaceBefore`,
      decision.hp.enemyFurnaceBefore,
      furnaceList(before),
    );
  }
  if (
    decision.hp.enemyFurnaceAfter !== undefined &&
    !sameNumberArray(decision.hp.enemyFurnaceAfter, furnaceList(after))
  ) {
    pushMismatch(
      mismatches,
      `${path}.hp.enemyFurnaceAfter`,
      decision.hp.enemyFurnaceAfter,
      furnaceList(after),
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
      return chooseCoinReward(input, choice, contentDb);
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
    if (reward.choice === null) return skipSkillReward(input, contentDb);
    return chooseSkillReward(
      input,
      reward.choice as SkillId,
      reward.replacedSlot,
      contentDb,
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

  // P4.3: 비전투 노드(갈림길·상점)는 기록된 path 사실로만 통과한다 — 사실이 없거나
  // 코어가 거부하면 mismatch (리플레이가 임의 정책으로 경로를 지어내지 않는다).
  // P6 v3: rest/treasure 노드와 보상 패시브 단계도 같은 원칙으로 path 사실만 소비한다.
  let pathCursor = 0;
  // 보상 패시브 단계(보스 정산)만 미해결로 남은 rewards 페이즈인가
  const pendingPassiveStage = (state: RunState): boolean =>
    state.phase === "rewards" &&
    state.pendingRewards !== undefined &&
    state.pendingRewards.coinChoiceResolved &&
    state.pendingRewards.coinRemovalResolved &&
    state.pendingRewards.skillChoiceResolved &&
    state.pendingRewards.passiveChoiceResolved === false;
  const traversePath = (current: RunState): RunState => {
    let next = current;
    let guard = 0;
    while (
      (next.phase === "choose-node" ||
        next.phase === "shop" ||
        next.phase === "event" ||
        next.phase === "rest" ||
        next.phase === "treasure" ||
        pendingPassiveStage(next)) &&
      guard < 256
    ) {
      guard += 1;
      const layer = next.combatIndex;
      const fact = trace.path[pathCursor];
      if (fact === undefined) {
        mismatches.push(`path fact missing for layer ${layer} (${next.phase})`);
        return next;
      }
      if (fact.layer !== layer) {
        mismatches.push(`path fact layer mismatch: recorded ${fact.layer} replayed ${layer}`);
        return next;
      }
      pathCursor += 1;
      try {
        if (next.phase === "choose-node") {
          if (fact.type !== "choose-node") {
            mismatches.push(`path fact for layer ${layer} is not choose-node`);
            return next;
          }
          next = chooseRunNode(next, fact.choice, contentDb);
        } else if (next.phase === "shop") {
          if (fact.type !== "shop") {
            mismatches.push(`path fact for layer ${layer} is not shop`);
            return next;
          }
          let left = false;
          for (const action of fact.actions) {
            if (action.kind === "buy-coin")
              next = buyShopCoin(next, action.option, contentDb);
            else if (action.kind === "buy-skill")
              next = buyShopSkill(next, action.option, contentDb, action.slot);
            else if (action.kind === "remove-coin")
              next = buyShopRemoval(next, action.bagIndex, contentDb);
            else if (action.kind === "buy-passive")
              next = buyShopPassive(next, action.option, contentDb);
            else {
              next = leaveShop(next, contentDb);
              left = true;
              break;
            }
          }
          if (!left) {
            mismatches.push(`shop fact for layer ${layer} never leaves`);
            return next;
          }
        } else if (next.phase === "event") {
          if (fact.type !== "event") {
            mismatches.push(`path fact for layer ${layer} is not event`);
            return next;
          }
          next =
            fact.action === "accept"
              ? acceptEvent(next, contentDb, fact.choice)
              : declineEvent(next, contentDb);
        } else if (next.phase === "rest") {
          // P6 D1 — 휴식: 회복 또는 슬롯 강화, 기록된 선택만 재생 (발명된 정책 금지)
          if (fact.type !== "rest") {
            mismatches.push(`path fact for layer ${layer} is not rest`);
            return next;
          }
          if (fact.choice === "heal") {
            next = restHeal(next, contentDb);
          } else {
            if (fact.slot === undefined) {
              mismatches.push(`rest fact for layer ${layer} upgrades without a slot`);
              return next;
            }
            next = restUpgrade(next, fact.slot, contentDb);
          }
        } else if (next.phase === "treasure") {
          // P6 D1 — 보물: 결정론 롤과 기록된 passiveId가 일치해야 한다
          if (fact.type !== "treasure") {
            mismatches.push(`path fact for layer ${layer} is not treasure`);
            return next;
          }
          const rolled = next.pendingTreasure?.passiveOption ?? null;
          const before = mismatches.length;
          pushMismatch(
            mismatches,
            `treasure ${layer}.passiveId`,
            fact.passiveId,
            rolled === null ? null : String(rolled),
          );
          if (mismatches.length > before) return next;
          next = claimTreasure(next, contentDb);
        } else {
          // P6 D2 — 보스 보상 패시브 3중1택 (null = 스킵)
          if (fact.type !== "passive-reward") {
            mismatches.push(`path fact for layer ${layer} is not passive-reward`);
            return next;
          }
          next = choosePassiveReward(
            next,
            fact.passiveId === null ? null : (fact.passiveId as PassiveId),
            contentDb,
          );
        }
      } catch (error) {
        mismatches.push(
          `path replay failed at layer ${layer}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return next;
      }
    }
    return next;
  };

  for (const combatTrace of sortedCombats) {
    run = traversePath(run);
    if (mismatches.length > 0 && run.phase !== "ready") break;
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
      const commands = decision.commands.map(commandFromHumanTelemetry);
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
