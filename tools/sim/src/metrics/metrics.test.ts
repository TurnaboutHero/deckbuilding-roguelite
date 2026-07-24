import { describe, expect, it } from "vitest";

import {
  M6_TRACE_SCHEMA_VERSION,
  foldM6Metrics,
  metricRatio,
  nearestRankPercentile,
  type M6DecisionTrace,
  type M6RunTrace,
  type M6SkillDecisionTrace,
  type M6TurnTrace,
} from "./index";

const skill = (
  skillId: string,
  resolution: "flip" | "consume",
  coinCount: number,
  directDamage: number,
  blockGained = 0,
  burnStacksApplied = 0,
): M6SkillDecisionTrace => ({
  skillId,
  resolution,
  coinCount,
  valueContribution: { directDamage, blockGained, burnStacksApplied },
});

const decision = (
  decisionIndex: number,
  turn: number,
  commandKey: string,
  resolvedSkill: M6SkillDecisionTrace | null,
): M6DecisionTrace => ({
  schemaVersion: M6_TRACE_SCHEMA_VERSION,
  decisionIndex,
  turn,
  commandKey,
  commandType: resolvedSkill === null ? "endTurn" : `use-${resolvedSkill.resolution}`,
  skill: resolvedSkill,
});

const turn = (
  turnNumber: number,
  overrides: Partial<Omit<M6TurnTrace, "schemaVersion" | "turn">> = {},
): M6TurnTrace => ({
  schemaVersion: M6_TRACE_SCHEMA_VERSION,
  turn: turnNumber,
  drawnCoinCount: 0,
  unusedCoinCount: 0,
  elementalCoinsSeen: 0,
  elementalCoinsFlippedHeads: 0,
  elementalCoinsConsumed: 0,
  consumeOpportunity: false,
  multiCoinSkillOpportunity: false,
  playerDamageDealt: 0,
  enemyDamageDealt: 0,
  burnDamageDealt: 0,
  decisions: [],
  ...overrides,
});

const gatekeeperSequence = (
  firstSkill: M6SkillDecisionTrace,
  secondSkill: M6SkillDecisionTrace,
): readonly M6TurnTrace[] => [
  turn(1, {
    decisions: [
      decision(0, 1, "endTurn", null),
      decision(1, 1, "useImmediate:0:0", firstSkill),
    ],
  }),
  turn(2, {
    decisions: [decision(0, 2, "useConsumeSkill:2:1:0", secondSkill)],
  }),
];

const fixture = (): M6RunTrace[] => {
  const randomTurns = gatekeeperSequence(
    skill("smash", "flip", 2, 8, 2, 1),
    skill("ignite-sword", "consume", 1, 15, 0, 2),
  ).map((value, index) =>
    index === 0
      ? {
          ...value,
          drawnCoinCount: 5,
          unusedCoinCount: 2,
          elementalCoinsSeen: 2,
          elementalCoinsFlippedHeads: 1,
          consumeOpportunity: true,
          multiCoinSkillOpportunity: true,
          playerDamageDealt: 10,
          enemyDamageDealt: 4,
          burnDamageDealt: 2,
        }
      : {
          ...value,
          drawnCoinCount: 5,
          unusedCoinCount: 1,
          elementalCoinsSeen: 1,
          elementalCoinsConsumed: 1,
          consumeOpportunity: true,
          playerDamageDealt: 20,
          enemyDamageDealt: 6,
          burnDamageDealt: 5,
        },
  );
  const greedyTurns = gatekeeperSequence(
    skill("smash", "flip", 2, 5),
    skill("ignite-sword", "consume", 1, 10),
  ).map((value, index) =>
    index === 0
      ? {
          ...value,
          drawnCoinCount: 5,
          unusedCoinCount: 0,
          multiCoinSkillOpportunity: true,
          playerDamageDealt: 5,
        }
      : {
          ...value,
          drawnCoinCount: 5,
          unusedCoinCount: 4,
          elementalCoinsSeen: 1,
          elementalCoinsConsumed: 1,
          consumeOpportunity: true,
          playerDamageDealt: 10,
        },
  );

  return [
    {
      schemaVersion: M6_TRACE_SCHEMA_VERSION,
      traceId: "baseline/random/0",
      episodeId: "episode-0",
      episodeIndex: 0,
      baseSeed: "1",
      runSeed: "episode-seed-0",
      contentVersion: "0.5.0-m5",
      variantId: "baseline",
      policyId: "random",
      expectedCombatCount: 5,
      result: "defeat",
      crash: null,
      invariantViolations: [],
      combats: [
        {
          schemaVersion: M6_TRACE_SCHEMA_VERSION,
          combatIndex: 2,
          enemyIds: ["gatekeeper"],
          startingPlayerHp: 60,
          endingPlayerHp: 50,
          result: "defeat",
          invariantViolations: [],
          turns: randomTurns,
        },
      ],
    },
    {
      schemaVersion: M6_TRACE_SCHEMA_VERSION,
      traceId: "baseline/greedy/0",
      episodeId: "episode-0",
      episodeIndex: 0,
      baseSeed: "1",
      runSeed: "episode-seed-0",
      contentVersion: "0.5.0-m5",
      variantId: "baseline",
      policyId: "greedy",
      expectedCombatCount: 5,
      result: "victory",
      crash: null,
      invariantViolations: [],
      combats: [
        {
          schemaVersion: M6_TRACE_SCHEMA_VERSION,
          combatIndex: 2,
          enemyIds: ["gatekeeper"],
          startingPlayerHp: 60,
          endingPlayerHp: 55,
          result: "victory",
          invariantViolations: [],
          turns: greedyTurns,
        },
      ],
    },
    {
      schemaVersion: M6_TRACE_SCHEMA_VERSION,
      traceId: "baseline/turtle/1",
      episodeId: "episode-1",
      episodeIndex: 1,
      baseSeed: "1",
      runSeed: "episode-seed-1",
      contentVersion: "0.5.0-m5",
      variantId: "baseline",
      policyId: "turtle",
      expectedCombatCount: 5,
      result: "crash",
      crash: { code: "STEP_REJECTED" },
      invariantViolations: ["step rejected"],
      combats: [
        {
          schemaVersion: M6_TRACE_SCHEMA_VERSION,
          combatIndex: 1,
          enemyIds: ["shaman"],
          startingPlayerHp: 50,
          endingPlayerHp: 40,
          result: "nonterminal",
          invariantViolations: ["coin ledger mismatch"],
          turns: [
            turn(1, { playerDamageDealt: 25 }),
            turn(2, { enemyDamageDealt: 5 }),
            turn(3),
          ],
        },
      ],
    },
  ];
};

const reverseNested = (traces: readonly M6RunTrace[]): M6RunTrace[] =>
  [...traces]
    .reverse()
    .map((trace) => ({
      ...trace,
      combats: [...trace.combats]
        .reverse()
        .map((combat) => ({
          ...combat,
          enemyIds: [...combat.enemyIds].reverse(),
          turns: [...combat.turns]
            .reverse()
            .map((value) => ({ ...value, decisions: [...value.decisions].reverse() })),
        })),
    }));

describe("M6 metric primitives", () => {
  it("locks nearest-rank percentiles and null zero-denominator behavior", () => {
    expect(nearestRankPercentile([], 0.5)).toBeNull();
    expect(nearestRankPercentile([9, 1, 3, 2], 0.5)).toBe(2);
    expect(nearestRankPercentile([9, 1, 3, 2], 0.99)).toBe(9);
    expect(nearestRankPercentile([9, 1, 3, 2], 1)).toBe(9);
    expect(() => nearestRankPercentile([1], 1.01)).toThrow("within [0, 1]");
    expect(metricRatio(0, 0)).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(metricRatio(0, 4)).toEqual({ numerator: 0, denominator: 4, rate: 0 });
  });

  it("returns a serializable empty report without inventing pass results", () => {
    const report = foldM6Metrics([]);

    expect(report.outcomes.winRate.rate).toBeNull();
    expect(report.turns.overall).toEqual({ count: 0, mean: null, p50: null, p99: null, max: null });
    expect(report.metadata.anomalyFlagsAreCiGates).toBe(false);
    expect(report.metadata.humanRequired.map((item) => item.id)).toEqual([
      "fun",
      "clarity",
      "elementalCoinDesire",
      "rewardAttractiveness",
      "consumeDominanceSentiment",
    ]);
    expect(report.metadata.humanRequired.every((item) => item.status === "humanRequired")).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("foldM6Metrics", () => {
  const thresholds = {
    extremeTurnCount: 2,
    extremeDamagePerTurn: 20,
    consumeDominanceUseShare: 0.9,
    consumeDominanceDirectValueShare: 0.6,
    consumeDominanceMinimumUses: 4,
  } as const;

  it("folds the mechanical and instrumented opportunity metrics exactly", () => {
    const report = foldM6Metrics(fixture(), thresholds);

    expect(report.outcomes).toEqual({
      runs: 3,
      terminalRuns: 2,
      nonterminalRuns: 1,
      crashRuns: 1,
      invariantViolationRuns: 1,
      invariantViolationCount: 2,
      wins: 1,
      defeats: 1,
      winRate: { numerator: 1, denominator: 2, rate: 0.5 },
      runCompletionRate: { numerator: 2, denominator: 3, rate: 2 / 3 },
      completedCombats: 2,
      expectedCombats: 15,
      combatCompletionRate: { numerator: 2, denominator: 15, rate: 2 / 15 },
    });
    expect(report.turns.overall).toEqual({ count: 3, mean: 7 / 3, p50: 2, p99: 3, max: 3 });
    expect(report.turns.perEnemy).toEqual([
      { enemyId: "gatekeeper", turns: { count: 2, mean: 2, p50: 2, p99: 2, max: 2 } },
      { enemyId: "shaman", turns: { count: 1, mean: 3, p50: 3, p99: 3, max: 3 } },
    ]);
    expect(report.skillsPerTurn).toEqual({ count: 7, mean: 4 / 7, p50: 1, p99: 1, max: 1 });
    expect(report.unusedCoinRate).toEqual({ numerator: 7, denominator: 20, rate: 0.35 });
    expect(report.damage.player).toEqual({ count: 7, mean: 10, p50: 10, p99: 25, max: 25 });
    expect(report.damage.enemy).toEqual({ count: 7, mean: 15 / 7, p50: 0, p99: 6, max: 6 });
    expect(report.damage.burnContribution).toEqual({ numerator: 7, denominator: 70, rate: 0.1 });
    expect(report.hpLossPerCombat).toEqual({ count: 3, mean: 25 / 3, p50: 10, p99: 10, max: 10 });
    expect(report.opportunities).toEqual({
      elementalCoinUtilization: { numerator: 3, denominator: 4, rate: 0.75 },
      consume: {
        opportunityTurns: 3,
        useTurns: 2,
        uses: 2,
        useTurnRate: { numerator: 2, denominator: 3, rate: 2 / 3 },
      },
      multiCoinSkill: {
        opportunityTurns: 2,
        useTurns: 2,
        uses: 2,
        useTurnRate: { numerator: 2, denominator: 2, rate: 1 },
      },
    });
    expect(report.consumeVsFlip).toEqual({
      flip: {
        uses: 2,
        directDamage: 13,
        blockGained: 2,
        burnStacksApplied: 1,
        directValue: 15,
      },
      consume: {
        uses: 2,
        directDamage: 25,
        blockGained: 0,
        burnStacksApplied: 2,
        directValue: 25,
      },
      consumeUseShare: { numerator: 2, denominator: 4, rate: 0.5 },
      consumeDirectValueShare: { numerator: 25, denominator: 40, rate: 0.625 },
    });
  });

  it("computes sorted policy gaps and report-only anomaly classifications", () => {
    const report = foldM6Metrics(fixture(), thresholds);

    expect(report.policyOutcomes).toEqual([
      {
        variantId: "baseline",
        policyId: "greedy",
        runs: 1,
        terminalRuns: 1,
        wins: 1,
        winRate: { numerator: 1, denominator: 1, rate: 1 },
      },
      {
        variantId: "baseline",
        policyId: "random",
        runs: 1,
        terminalRuns: 1,
        wins: 0,
        winRate: { numerator: 0, denominator: 1, rate: 0 },
      },
      {
        variantId: "baseline",
        policyId: "turtle",
        runs: 1,
        terminalRuns: 0,
        wins: 0,
        winRate: { numerator: 0, denominator: 0, rate: null },
      },
    ]);
    expect(report.policyWinGaps).toEqual([
      {
        variantId: "baseline",
        leftPolicyId: "greedy",
        rightPolicyId: "random",
        signedGap: 1,
        absoluteGap: 1,
      },
      {
        variantId: "baseline",
        leftPolicyId: "greedy",
        rightPolicyId: "turtle",
        signedGap: null,
        absoluteGap: null,
      },
      {
        variantId: "baseline",
        leftPolicyId: "random",
        rightPolicyId: "turtle",
        signedGap: null,
        absoluteGap: null,
      },
    ]);
    expect(report.anomalies.map((anomaly) => anomaly.kind).sort()).toEqual([
      "consumeDominanceWarning",
      "extremeDamage",
      "extremeTurnCount",
      "gatekeeperPolicySequenceConvergence",
      "invariantFailure",
      "nonterminal",
    ]);
    const convergence = report.anomalies.find(
      (anomaly) => anomaly.kind === "gatekeeperPolicySequenceConvergence",
    );
    expect(convergence).toMatchObject({
      episodeId: "episode-0",
      variantId: "baseline",
      combatIndex: 2,
      policyIds: ["greedy", "random"],
      commandSequence: ["endTurn", "useImmediate:0:0", "useConsumeSkill:2:1:0"],
    });
    expect(report.metadata.informational.find((item) => item.id === "anomalies")?.status).toBe(
      "informational",
    );
  });

  it("is independent of run, combat, turn, decision, and enemy input order", () => {
    const traces = fixture();
    const before = JSON.stringify(traces);
    const forward = foldM6Metrics(traces, thresholds);
    const reversed = foldM6Metrics(reverseNested(traces), thresholds);

    expect(reversed).toEqual(forward);
    expect(JSON.stringify(traces)).toBe(before);
    expect(JSON.parse(JSON.stringify(forward))).toEqual(forward);
  });

  it("rejects unsupported or internally inconsistent snapshots", () => {
    const [trace] = fixture();
    expect(trace).toBeDefined();
    expect(() =>
      foldM6Metrics([{ ...(trace as M6RunTrace), schemaVersion: "future" as never }]),
    ).toThrow("schemaVersion is unsupported");
    expect(() =>
      foldM6Metrics([
        trace as M6RunTrace,
        { ...(trace as M6RunTrace), policyId: "greedy" },
      ]),
    ).toThrow("traceId must be unique");
    expect(() =>
      foldM6Metrics([
        {
          ...(trace as M6RunTrace),
          combats: [
            {
              ...(trace as M6RunTrace).combats[0]!,
              turns: [turn(1, { drawnCoinCount: 1, unusedCoinCount: 2 })],
            },
          ],
        },
      ]),
    ).toThrow("unusedCoinCount cannot exceed drawnCoinCount");
  });
});
