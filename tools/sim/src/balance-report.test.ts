import { describe, expect, it } from "vitest";

import {
  aggregateGatekeeperConvergence,
  aggregatePolicyEnemyCharacterRows,
  aggregatePolicyEnemyRows,
  aggregatePolicyResolutionRows,
  buildM6BalanceReport,
  P3_BALANCE_REPORT_SCHEMA_VERSION,
} from "./balance-report";
import {
  M6_TRACE_SCHEMA_VERSION,
  foldM6Metrics,
  type M6RunTrace,
  type M6SkillResolutionKind,
} from "./metrics";

const trace = (
  policyId: string,
  resolution: M6SkillResolutionKind,
  directDamage: number,
  result: "victory" | "defeat",
): M6RunTrace => ({
  schemaVersion: M6_TRACE_SCHEMA_VERSION,
  traceId: `baseline/${policyId}/00000000`,
  episodeId: "episode-0",
  episodeIndex: 0,
  baseSeed: "1",
  runSeed: "run-0",
  contentVersion: "test",
  variantId: "baseline",
  policyId,
  expectedCombatCount: 1,
  result,
  crash: null,
  invariantViolations: [],
  combats: [
    {
      schemaVersion: M6_TRACE_SCHEMA_VERSION,
      combatIndex: 0,
      enemyIds: ["gatekeeper"],
      startingPlayerHp: 70,
      endingPlayerHp: result === "victory" ? 65 : 0,
      result,
      invariantViolations: [],
      turns: [
        {
          schemaVersion: M6_TRACE_SCHEMA_VERSION,
          turn: 1,
          drawnCoinCount: 1,
          unusedCoinCount: 0,
          elementalCoinsSeen: 1,
          elementalCoinsFlippedHeads: resolution === "flip" ? 1 : 0,
          elementalCoinsConsumed: resolution === "consume" ? 1 : 0,
          consumeOpportunity: true,
          multiCoinSkillOpportunity: false,
          playerDamageDealt: directDamage,
          enemyDamageDealt: 0,
          burnDamageDealt: 0,
          decisions: [
            {
              schemaVersion: M6_TRACE_SCHEMA_VERSION,
              decisionIndex: 0,
              turn: 1,
              commandKey: "skill:shared-sequence",
              commandType: "useSkill",
              skill: {
                skillId: "test-skill",
                resolution,
                coinCount: 1,
                valueContribution: {
                  directDamage,
                  blockGained: 0,
                  burnStacksApplied: 0,
                },
              },
            },
          ],
        },
      ],
    },
  ],
});

describe("M6 balance report aggregation", () => {
  const traces = [
    trace("aggro", "flip", 4, "victory"),
    trace("greedy", "consume", 7, "defeat"),
  ];

  it("folds policy x enemy combat results and deterministic turn distributions", () => {
    expect(aggregatePolicyEnemyRows(traces)).toEqual([
      {
        variantId: "baseline",
        policyId: "aggro",
        enemyId: "gatekeeper",
        combatCount: 1,
        results: { victories: 1, defeats: 0, nonterminal: 0 },
        turns: { count: 1, mean: 1, p50: 1, p99: 1, max: 1 },
      },
      {
        variantId: "baseline",
        policyId: "greedy",
        enemyId: "gatekeeper",
        combatCount: 1,
        results: { victories: 0, defeats: 1, nonterminal: 0 },
        turns: { count: 1, mean: 1, p50: 1, p99: 1, max: 1 },
      },
    ]);
  });

  it("keeps flip and consume value separate and compares every policy seed", () => {
    const rows = aggregatePolicyResolutionRows(traces);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      policyId: "aggro",
      flip: { uses: 1, directDamage: 4, directValue: 4 },
      consume: { uses: 0, directDamage: 0, directValue: 0 },
      acrossSeeds: {
        episodeRuns: 1,
        withSkillUse: 1,
        useFrequency: { consumeHigher: 0, flipHigher: 1, equal: 0 },
        directValue: { consumeHigher: 0, flipHigher: 1, equal: 0 },
      },
    });
    expect(rows[1]).toMatchObject({
      policyId: "greedy",
      flip: { uses: 0, directDamage: 0, directValue: 0 },
      consume: { uses: 1, directDamage: 7, directValue: 7 },
      acrossSeeds: {
        episodeRuns: 1,
        withSkillUse: 1,
        useFrequency: { consumeHigher: 1, flipHigher: 0, equal: 0 },
        directValue: { consumeHigher: 1, flipHigher: 0, equal: 0 },
      },
    });
  });

  it("counts only exact cross-policy Gatekeeper command-sequence convergence", () => {
    const metrics = foldM6Metrics(traces);
    expect(aggregateGatekeeperConvergence(traces, metrics.anomalies)).toEqual({
      exactSequenceOccurrences: 1,
      uniqueEpisodes: 1,
      episodeIndices: [0],
      byEnemy: [{ enemyId: "gatekeeper", occurrences: 1 }],
      byPolicySet: [{ policyIds: ["aggro", "greedy"], occurrences: 1 }],
    });
  });

  it("adds deterministic policy x enemy x character rows", () => {
    expect(
      aggregatePolicyEnemyCharacterRows([
        traces[0] as M6RunTrace,
        { ...(traces[1] as M6RunTrace), characterId: "arcanist" },
      ]),
    ).toEqual([
      {
        variantId: "baseline",
        policyId: "aggro",
        enemyId: "gatekeeper",
        characterId: "warrior",
        buildPolicyId: "fire-build",
        combatCount: 1,
        results: { victories: 1, defeats: 0, nonterminal: 0 },
        turns: { count: 1, mean: 1, p50: 1, p99: 1, max: 1 },
      },
      {
        variantId: "baseline",
        policyId: "greedy",
        enemyId: "gatekeeper",
        characterId: "arcanist",
        buildPolicyId: "mana-build",
        combatCount: 1,
        results: { victories: 0, defeats: 1, nonterminal: 0 },
        turns: { count: 1, mean: 1, p50: 1, p99: 1, max: 1 },
      },
    ]);
  });

  it("builds compact deterministic report-only evidence", () => {
    const options = { baseSeed: "1", gamesPerPolicy: 1, crnGames: 1 };
    const first = buildM6BalanceReport(options);
    const second = buildM6BalanceReport(options);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.schemaVersion).toBe(P3_BALANCE_REPORT_SCHEMA_VERSION);
    expect(first.configuration.totalPolicyRuns).toBe(4);
    expect(first.tuningDecision.numericContentChange).toBe("none");
    expect(first.mechanicalFacts.crn.aa.identical).toBe(true);
    expect(first.mechanicalFacts.crn.isBalanceGate).toBe(false);
    expect(first.mechanicalFacts.arcanistSafety500.isCiGate).toBe(false);
    expect(first.mechanicalFacts.characterSafety500).toEqual([
      expect.objectContaining({
        characterId: "sorcerer",
        buildPolicyId: "lightning-build",
        isCiGate: false,
      }),
      expect.objectContaining({
        characterId: "frost-knight",
        buildPolicyId: "frost-build",
        isCiGate: false,
      }),
    ]);
    expect(first.mechanicalFacts.characterCrn.isBalanceGate).toBe(false);
    expect(first.mechanicalFacts.frostCharacterCrn.isBalanceGate).toBe(false);
    expect(first.mechanicalFacts.policyEnemyCharacter.length).toBeGreaterThan(0);
    // P13 reward-pool opening (basic+signature → all-element weighted) — 의도된 재앵커.
    expect(first.mechanicalFacts.buildPolicies).toEqual([
      expect.objectContaining({
        buildPolicyId: "fire-build",
        coinRewardPriority: ["fire", "mana", "basic", "lightning", "frost", "blood"],
      }),
      expect.objectContaining({
        buildPolicyId: "mana-build",
        coinRewardPriority: ["mana", "basic", "fire", "frost", "lightning", "blood"],
      }),
      expect.objectContaining({
        buildPolicyId: "frost-build",
        coinRewardPriority: ["frost", "basic", "mana", "fire", "lightning", "blood"],
      }),
      expect.objectContaining({
        buildPolicyId: "lightning-build",
        coinRewardPriority: ["lightning", "basic", "mana", "fire", "frost", "blood"],
      }),
    ]);
    expect(
      first.mechanicalFacts.rewardSelectionByCharacterBuild.length,
    ).toBeGreaterThan(0);
    expect(first.mechanicalFacts.rewardSelectionAudit).toContainEqual(
      expect.objectContaining({
        characterId: "arcanist",
        buildPolicyId: "mana-build",
        optionType: "skill",
        optionId: "arcane-command",
      }),
    );
    expect(first.mechanicalFacts.characterCrn.characters).toEqual([
      expect.objectContaining({
        characterId: "warrior",
        buildPolicyId: "fire-build",
      }),
      expect.objectContaining({
        characterId: "arcanist",
        buildPolicyId: "mana-build",
      }),
    ]);
    expect(first.mechanicalFacts.frostCharacterCrn.characters).toEqual([
      expect.objectContaining({
        characterId: "warrior",
        buildPolicyId: "fire-build",
      }),
      expect.objectContaining({
        characterId: "frost-knight",
        buildPolicyId: "frost-build",
      }),
    ]);
    expect(first.informationalTargetBands.every((band) => !band.isGate)).toBe(
      true,
    );
    expect(first.phase3.conclusionLabels).toEqual([
      "engineering-safe",
      "balance-provisional",
      "experience-unverified",
    ]);
    expect(JSON.stringify(first)).not.toContain('"status":"blocked"');
    expect(JSON.stringify(first)).not.toContain('"episodes":');
    expect(JSON.stringify(first)).not.toContain('"transcripts":');
  });
});
