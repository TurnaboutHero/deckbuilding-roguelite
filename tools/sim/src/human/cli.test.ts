import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTENT_VERSION, contentDb } from "@game/content";
import {
  chooseCoinReward,
  createRun,
  resolveCoinRemoval,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  step,
} from "@game/core";
import type { CombatEvent, CombatState, Command, RunState } from "@game/core";
import { beforeAll, describe, expect, it } from "vitest";

import { chooseRunCommand } from "../run-sim";
import type {
  HumanDamageFact,
  HumanDecisionFact,
  HumanRunTraceLike,
} from "./types";

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface ExecFileSyncError extends Error {
  status?: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

const repoRoot = process.cwd();
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const humanReportEntry = join(repoRoot, "tools", "sim", "src", "human", "human-report.ts");

const hpList = (state: CombatState): number[] =>
  state.enemies.map((enemy) => enemy.hp);

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

const resolveRewards = (trace: HumanRunTraceLike, input: RunState): RunState => {
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
  let run = chooseCoinReward(input, coinChoice);
  trace.rewards.push({
    combatIndex: completedCombatIndex,
    stage: "removal",
    options: run.bag.map(String),
    choice: null,
    resolution: "skipped",
  });
  run = resolveCoinRemoval(run, null);
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
    run = chooseCoinReward(run, fallback);
  }
  if (run.phase === "rewards" && run.pendingRewards?.skillChoiceResolved === false) {
    trace.rewards.push({
      combatIndex: completedCombatIndex,
      stage: "skill",
      options: run.pendingRewards.skillOptions.map(String),
      choice: null,
      resolution: "skipped",
    });
    run = skipSkillReward(run);
  }
  return run;
};

const makeTrace = (seed: string): HumanRunTraceLike => {
  let run = createRun(
    { contentVersion: CONTENT_VERSION, runSeed: seed, character: "warrior" as never },
    contentDb,
  );
  const trace: HumanRunTraceLike = {
    schemaVersion: 1,
    source: "human",
    runSeed: seed,
    contentVersion: CONTENT_VERSION,
    buildId: "test",
    startedAtLocal: "2026-01-01T00:00:00.000",
    maxHp: run.maxHp,
    combats: [],
    rewards: [],
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
  }

  trace.result = run.phase;
  trace.finalHp = run.currentHp;
  trace.endedAtLocal = "2026-01-01T00:10:00.000";
  return trace;
};

const runCli = (args: readonly string[]): CliResult => {
  try {
    const stdout = execFileSync(tsxBin, [humanReportEntry, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failed = error as ExecFileSyncError;
    return {
      status: failed.status ?? 1,
      stdout: failed.stdout?.toString() ?? "",
      stderr: failed.stderr?.toString() ?? "",
    };
  }
};

describe("human report CLI entrypoint", () => {
  let fixtureDir: string;
  let emptyDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "human-cli-log-"));
    emptyDir = mkdtempSync(join(tmpdir(), "human-cli-empty-"));
    writeFileSync(
      join(fixtureDir, "run.json"),
      JSON.stringify(makeTrace("human-cli-fixture")),
      "utf8",
    );
  });

  it("accepts documented pnpm-forwarded arguments", () => {
    const result = runCli(["--", "--dir", fixtureDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- N:");
    expect(result.stderr).not.toContain("unknown argument");
  });

  it("accepts direct arguments with byte-identical output", () => {
    const forwarded = runCli(["--", "--dir", fixtureDir]);
    const direct = runCli(["--dir", fixtureDir]);

    expect(direct.status).toBe(0);
    expect(direct.stdout).toBe(forwarded.stdout);
  });

  it("fails when no valid runs are found", () => {
    const result = runCli(["--dir", emptyDir]);

    expect(result.status).toBe(1);
  });

  it("fails unknown flags with usage text", () => {
    const result = runCli(["--nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown argument: --nope");
    expect(result.stderr).toContain("usage: pnpm sim:human -- --dir <path>");
  });
});
