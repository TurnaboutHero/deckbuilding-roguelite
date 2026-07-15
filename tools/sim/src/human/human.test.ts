import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTENT_VERSION, contentDb } from "@game/content";
import {
  acceptEvent,
  choosePassiveReward,
  chooseRunNode,
  claimTreasure,
  declineEvent,
  leaveShop,
  chooseCoinReward,
  createRun,
  resolveCoinRemoval,
  restHeal,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  step,
} from "@game/core";
import type { CombatEvent, CombatState, Command, RunState } from "@game/core";
import { describe, expect, it } from "vitest";

import { chooseRunCommand } from "../run-sim";
import { parseHumanReportArgs } from "./human-report";
import { readHumanLogDirectory } from "./reader";
import { commandFromHumanTelemetry, replayHumanRun } from "./replay";
import { buildHumanReport, renderHumanReportMarkdown } from "./report";
import type {
  HumanDamageFact,
  HumanDecisionFact,
  HumanRunTraceLike,
  VerifiedHumanRun,
} from "./types";

const hpList = (state: CombatState): number[] =>
  state.enemies.map((enemy) => enemy.hp);

describe("explicit telemetry command replay", () => {
  it("reconstructs every optional reducer choice and accepts legacy omissions", () => {
    expect(
      commandFromHumanTelemetry({
        type: "useFlipSkill",
        slot: 2,
        target: 1,
        chosen: [3],
        desiredCoin: "fire",
        chosenEquipment: "mana-shield",
        chosenSummon: 8,
      }),
    ).toEqual({
      type: "useFlipSkill",
      slot: 2,
      target: 1,
      chosen: [3],
      desiredCoin: "fire",
      chosenEquipment: "mana-shield",
      chosenSummon: 8,
    });
    expect(
      commandFromHumanTelemetry({
        type: "useConsumeSkill",
        slot: 1,
        coins: [4, 5],
        desiredCoin: "mana",
        chosenSummon: 3,
      }),
    ).toEqual({
      type: "useConsumeSkill",
      slot: 1,
      coins: [4, 5],
      desiredCoin: "mana",
      chosenSummon: 3,
    });
    expect(
      commandFromHumanTelemetry({ type: "endTurn", preserve: [6] }),
    ).toEqual({ type: "endTurn", preserve: [6] });
    expect(
      commandFromHumanTelemetry({ type: "useFlipSkill", slot: 0 }),
    ).toEqual({ type: "useFlipSkill", slot: 0 });
  });
});

const commandFact = (command: Command): HumanDecisionFact["commands"][number] => {
  if (command.type === "placeCoin") {
    return { type: "placeCoin", coin: Number(command.coin), slot: Number(command.slot) };
  }
  if (command.type === "unplaceCoin") {
    return { type: "unplaceCoin", coin: Number(command.coin) };
  }
  if (command.type === "useFlipSkill") {
    return command.target === undefined
      ? { type: "useFlipSkill", slot: Number(command.slot) }
      : { type: "useFlipSkill", slot: Number(command.slot), target: command.target };
  }
  if (command.type === "useConsumeSkill") {
    const fact = {
      type: "useConsumeSkill" as const,
      slot: Number(command.slot),
      coins: command.coins.map(Number),
    };
    return command.target === undefined ? fact : { ...fact, target: command.target };
  }
  return { type: "endTurn" };
};

const damageFacts = (events: readonly CombatEvent[]): HumanDamageFact[] =>
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

const decisionFact = (
  before: CombatState,
  command: Command,
  after: CombatState,
  events: readonly CombatEvent[],
): HumanDecisionFact => ({
  turn: before.turn,
  commands: [commandFact(command)],
  skills: events.flatMap((event) =>
    event.type === "skillUsed"
      ? [{ slot: Number(event.slot), skill: String(event.skill), kind: event.kind }]
      : [],
  ),
  flips: events.flatMap((event) =>
    event.type === "coinFlipped"
      ? [{ coin: Number(event.coin), face: event.face }]
      : [],
  ),
  damage: damageFacts(events),
  hp: {
    playerBefore: before.player.hp,
    playerAfter: after.player.hp,
    enemiesBefore: hpList(before),
    enemiesAfter: hpList(after),
  },
});

const resolveRewards = (
  trace: HumanRunTraceLike,
  input: RunState,
): RunState => {
  if (input.phase !== "rewards" || input.pendingRewards === undefined) return input;
  const completedCombatIndex = input.combatIndex - 1;
  const coinChoice = input.pendingRewards.coinOptions[0] ?? null;
  trace.rewards.push({
    combatIndex: completedCombatIndex,
    stage: "coin",
    options: input.pendingRewards.coinOptions.map(String),
    choice: coinChoice === null ? null : String(coinChoice),
    resolution: coinChoice === null ? "skipped" : "selected",
  });
  let run = chooseCoinReward(input, coinChoice, contentDb);
  // P6 신스펙: 제거 단계는 레거시 흐름에만 존재 (coinRemovalResolved는 true 고정) —
  // 코인 선택만으로 보상이 완결될 수 있으므로 각 단계 앞에 페이즈/플래그 가드가 필수다.
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.coinRemovalResolved === false
  ) {
    trace.rewards.push({
      combatIndex: completedCombatIndex,
      stage: "removal",
      options: run.bag.map(String),
      choice: null,
      resolution: "skipped",
    });
    run = resolveCoinRemoval(run, null, contentDb);
  }
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.coinChoiceResolved === false &&
    run.pendingRewards.coinRemovalResolved
  ) {
    const fallback = run.pendingRewards.coinOptions[0] ?? null;
    trace.rewards.push({
      combatIndex: completedCombatIndex,
      stage: "fallback-coin",
      options: run.pendingRewards.coinOptions.map(String),
      choice: fallback === null ? null : String(fallback),
      resolution: fallback === null ? "skipped" : "selected",
    });
    run = chooseCoinReward(run, fallback, contentDb);
  }
  if (run.phase === "rewards" && run.pendingRewards?.skillChoiceResolved === false) {
    trace.rewards.push({
      combatIndex: completedCombatIndex,
      stage: "skill",
      options: run.pendingRewards.skillOptions.map(String),
      choice: null,
      resolution: "skipped",
    });
    run = skipSkillReward(run, contentDb);
  }
  // P6 D2 — 보스 보상 패시브: v3 경로 사실(passive-reward)로 기록한다.
  // layer = 기록 시점의 run.combatIndex (정산 후 진입할 다음 레이어).
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.passiveChoiceResolved === false
  ) {
    const offered = run.pendingRewards.passiveOptions ?? [];
    const passiveChoice = offered[0] ?? null;
    trace.path.push({
      layer: run.combatIndex,
      type: "passive-reward",
      passiveId: passiveChoice === null ? null : String(passiveChoice),
    });
    run = choosePassiveReward(run, passiveChoice, contentDb);
  }
  return run;
};

const makeTrace = (seed: string): HumanRunTraceLike => {
  let run = createRun(
    { contentVersion: CONTENT_VERSION, runSeed: seed, character: "warrior" as never },
    contentDb,
  );
  const trace: HumanRunTraceLike = {
    schemaVersion: 3,
    source: "human",
    runSeed: seed,
    contentVersion: CONTENT_VERSION,
    buildId: "test",
    startedAtLocal: "2026-01-01T00:00:00.000",
    maxHp: run.maxHp,
    combats: [],
    rewards: [],
    path: [],
    result: "in-progress",
  };

  while (run.phase !== "victory" && run.phase !== "defeat") {
    const combatIndex = run.combatIndex;
    const attempt = run.attempt;
    const started = startRunCombat(run, contentDb);
    let state = started.combat;
    const combatTrace = {
      combatIndex,
      attempt,
      enemyIds: state.enemies.map((enemy) => String(enemy.defId)),
      startingHp: state.player.hp,
      maxHp: state.player.maxHp,
      decisions: [] as HumanDecisionFact[],
    };
    for (let index = 0; index < 500 && state.phase === "player"; index += 1) {
      const before = state;
      const command = chooseRunCommand(state);
      const stepped = step(state, command, contentDb);
      if (!stepped.ok) throw new Error(stepped.error);
      state = stepped.state;
      combatTrace.decisions.push(decisionFact(before, command, state, stepped.events));
    }
    if (state.phase !== "victory" && state.phase !== "defeat") {
      throw new Error("fixture combat did not finish");
    }
    trace.combats.push({
      ...combatTrace,
      outcome: {
        result: state.phase,
        turns: state.turn,
        playerHp: state.player.hp,
        enemyHp: hpList(state),
      },
    });
    run = settleRunCombat(started.run, state, contentDb);
    run = resolveRewards(trace, run);
    // P4.3: 비전투 노드는 fight-first + 즉시 leave로 통과하고 path 사실을 기록한다.
    // P6 v3: rest(회복 고정)·treasure(개봉) 노드도 경로 사실로 기록한다.
    while (
      run.phase === "choose-node" ||
      run.phase === "shop" ||
      run.phase === "event" ||
      run.phase === "rest" ||
      run.phase === "treasure"
    ) {
      const layer = run.combatIndex;
      if (run.phase === "choose-node") {
        const options = run.graph.layers[layer] ?? [];
        const found = options.findIndex((node) => node.kind !== "shop");
        const choice = found < 0 ? 0 : found;
        trace.path.push({ layer, type: "choose-node", choice });
        run = chooseRunNode(run, choice, contentDb);
      } else if (run.phase === "shop") {
        trace.path.push({ layer, type: "shop", actions: [{ kind: "leave" }] });
        run = leaveShop(run, contentDb);
      } else if (run.phase === "rest") {
        trace.path.push({ layer, type: "rest", choice: "heal" });
        run = restHeal(run, contentDb);
      } else if (run.phase === "treasure") {
        const passiveId = run.pendingTreasure?.passiveOption ?? null;
        trace.path.push({
          layer,
          type: "treasure",
          passiveId: passiveId === null ? null : String(passiveId),
        });
        run = claimTreasure(run, contentDb);
      } else {
        const event = contentDb.events?.[String(run.pendingEvent?.eventId)];
        const action = event?.risk === "combat" ? "accept" : "decline";
        trace.path.push({ layer, type: "event", action });
        run =
          action === "accept"
            ? acceptEvent(run, contentDb)
            : declineEvent(run, contentDb);
      }
    }
  }

  trace.result = run.phase;
  trace.finalHp = run.currentHp;
  trace.endedAtLocal = "2026-01-01T00:10:00.000";
  return trace;
};

const writeTrace = (dir: string, filename: string, trace: HumanRunTraceLike): void => {
  writeFileSync(join(dir, filename), JSON.stringify(trace), "utf8");
};

describe("human log report", () => {
  it("parses pnpm-forwarded leading double dash", () => {
    expect(parseHumanReportArgs(["--", "--dir", "--", "--", "/tmp/human-logs", "--", "--json"])).toEqual({
      ok: true,
      help: false,
      dir: "/tmp/human-logs",
      out: undefined,
      json: true,
    });
  });

  it("reads generated logs and verifies replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "human-log-"));
    const trace = makeTrace("human-fixture-1");
    writeTrace(dir, "a.json", trace);

    const read = readHumanLogDirectory(dir);
    expect(read.rejected).toEqual([]);
    expect(read.files).toHaveLength(1);
    const replay = replayHumanRun(read.files[0]!.trace);
    expect(replay.verification).toEqual({ ok: true, mismatches: [] });
  });

  it("keeps optional explicit choices while reading older schema-v3 logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "human-log-explicit-"));
    const trace = makeTrace("human-fixture-explicit");
    const decision = trace.combats[0]?.decisions[0];
    if (decision === undefined) throw new Error("missing decision");
    decision.source = "auto-turn-end";
    decision.commands = [
      {
        type: "useFlipSkill",
        slot: 0,
        target: 1,
        chosen: [2],
        desiredCoin: "fire",
        chosenEquipment: "mana-shield",
        chosenSummon: 4,
      },
      {
        type: "useConsumeSkill",
        slot: 1,
        coins: [3],
        desiredCoin: "mana",
        chosenSummon: 5,
      },
      { type: "endTurn", preserve: [6] },
    ];
    writeTrace(dir, "explicit.json", trace);

    const read = readHumanLogDirectory(dir);
    expect(read.rejected).toEqual([]);
    expect(read.files[0]?.trace.combats[0]?.decisions[0]).toMatchObject({
      source: "auto-turn-end",
      commands: decision.commands,
    });
  });

  it("rejects tampered facts and content drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "human-log-"));
    const trace = makeTrace("human-fixture-2");
    const tamperedHp = structuredClone(trace);
    tamperedHp.combats[0]!.decisions[0]!.hp.playerAfter += 1;
    const drift = structuredClone(trace);
    drift.contentVersion = "old-content";
    writeTrace(dir, "a-valid.json", trace);
    writeTrace(dir, "b-tampered.json", tamperedHp);
    writeTrace(dir, "c-drift.json", drift);

    const read = readHumanLogDirectory(dir);
    expect(read.rejected).toEqual([
      {
        filename: "c-drift.json",
        reason: `content drift: trace contentVersion old-content does not match ${CONTENT_VERSION}`,
      },
    ]);
    const tampered = read.files.find((file) => file.filename === "b-tampered.json");
    expect(tampered).toBeDefined();
    const replay = replayHumanRun(tampered!.trace);
    expect(replay.verification.ok).toBe(false);
    expect(replay.verification.mismatches.join("\n")).toContain("hp.playerAfter mismatch");
  });

  it("renders deterministic markdown", () => {
    const trace = makeTrace("human-fixture-3");
    const replay = replayHumanRun(trace);
    expect(replay.run).toBeDefined();
    const report = buildHumanReport([{ ...replay.run!, filename: "run.json" }], []);
    expect(renderHumanReportMarkdown(report)).toBe(renderHumanReportMarkdown(report));
  });

  it("computes known scenario metrics", () => {
    const before = {
      turn: 1,
      phase: "player",
      player: { hp: 10, maxHp: 10, block: 0, statuses: {}, nextDrawPenalty: 0 },
      enemies: [{ defId: "raider", hp: 1, maxHp: 1, block: 0, statuses: {}, intent: { id: "wait", actions: [] }, intentIndex: 0 }],
      coins: { 1: { uid: 1, defId: "fire", permanent: true, grants: [] } },
      zones: { draw: [], hand: [1], placed: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] }, discard: [], exhausted: [] },
      slots: [
        { skillId: "slash", usedThisTurn: false, usedThisCombat: false },
        { skillId: "guard", usedThisTurn: false, usedThisCombat: false },
        { skillId: "burning-strike", usedThisTurn: false, usedThisCombat: false },
        { skillId: "ignite", usedThisTurn: false, usedThisCombat: false },
        { skillId: "ignite-sword", usedThisTurn: false, usedThisCombat: false },
        { skillId: "flame-rampage", usedThisTurn: false, usedThisCombat: false },
      ],
      skillUsesThisTurn: 0,
      rng: { flip: { s: [0, 0, 0, 0] }, shuffle: { s: [0, 0, 0, 0] }, ai: { s: [0, 0, 0, 0] } },
      nextUid: 2,
      events: [],
    } as unknown as CombatState;
    const after = { ...before, phase: "victory" } as unknown as CombatState;
    const run: VerifiedHumanRun = {
      filename: "known.json",
      trace: {
        schemaVersion: 2,
        source: "human",
        runSeed: "known",
        path: [],
        contentVersion: CONTENT_VERSION,
        buildId: "test",
        startedAtLocal: "2026-01-01T00:00:00.000",
        maxHp: 10,
        combats: [],
        rewards: [],
        result: "victory",
        finalHp: 10,
      },
      combats: [{ combatIndex: 0, enemyIds: ["raider"], turns: 1, result: "victory", playerHp: 10 }],
      decisions: [
        {
          combatIndex: 0,
          enemyIds: ["raider"],
          decision: {
            turn: 1,
            commands: [],
            skills: [],
            flips: [],
            damage: [],
            hp: { playerBefore: 10, playerAfter: 10, enemiesBefore: [1], enemiesAfter: [0] },
          },
          before,
          after,
          commands: [],
          events: [
            { type: "skillUsed", slot: 0 as never, skill: "slash" as never, kind: "flip" },
            { type: "coinPlaced", coin: 1 as never, slot: 0 as never },
            { type: "coinFlipped", coin: 1 as never, face: "heads" },
          ],
        },
      ],
    };

    const report = buildHumanReport([run], []);
    expect(report.aggregate.averageTurns).toBe(1);
    expect(report.aggregate.skillsPerTurn).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(report.aggregate.fireCoinUtilization).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    const markdown = renderHumanReportMarkdown(report);
    expect(markdown).toContain("- 턴당 스킬 사용 수: 1.00 (1/1)");
    expect(markdown).not.toMatch(/턴당 스킬 사용 수: [^\n%]*%/);
    expect(markdown).toContain("| known.json | known | victory | 10 | 1 | 1.00 | 1.00 (1/1) |");
  });
});
