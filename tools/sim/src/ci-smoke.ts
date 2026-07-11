import { runBulk } from "./bulk";
import { POLICY_IDS } from "./policies";
import { simulateRun } from "./run-sim";

const BASE_SEED = "1";
const GAMES_PER_POLICY = 125;
const EXPECTED_RUNS = GAMES_PER_POLICY * POLICY_IDS.length;

// P3.3 R2: 공용 보상 풀에 flame-sword/heart-of-flame/conflagration 3종을 추가하며
// seed42 보상 셔플과 fire-build 선택 결과가 의도적으로 바뀌어 재고정했다.
const SEED_42_GOLDEN = {
  seed: "42",
  result: "victory",
  combatsCompleted: 5,
  turnsPerCombat: [4, 3, 4, 5, 9],
  carriedHp: 27,
  finalBag: [
    "basic",
    "basic",
    "basic",
    "basic",
    "fire",
    "fire",
    "fire",
    "fire",
    "fire",
    "fire",
  ],
  finalEquippedSkills: [
    "conflagration",
    "guard",
    "burning-strike",
    "flame-sword",
    "ignite-sword",
    "smash",
  ],
  encounterOrder: [
    ["raider"],
    ["shaman"],
    ["gatekeeper"],
    ["raider-plus"],
    ["gatekeeper-plus"],
  ],
} as const;

const bulk = runBulk({
  baseSeed: BASE_SEED,
  games: GAMES_PER_POLICY,
  policyIds: POLICY_IDS,
});
const outcomes = bulk.report.metrics.outcomes;
const seed42Actual = simulateRun("42").summary;

const gates = {
  allRunsTerminal:
    outcomes.runs === EXPECTED_RUNS &&
    outcomes.terminalRuns === EXPECTED_RUNS,
  noCrashes: outcomes.crashRuns === 0,
  noInvariantViolations:
    outcomes.invariantViolationRuns === 0 &&
    outcomes.invariantViolationCount === 0,
  seed42GoldenUnchanged:
    JSON.stringify(seed42Actual) === JSON.stringify(SEED_42_GOLDEN),
};

const report = {
  schemaVersion: "m6-ci-smoke-v1",
  configuration: {
    baseSeed: BASE_SEED,
    gamesPerPolicy: GAMES_PER_POLICY,
    expectedRuns: EXPECTED_RUNS,
    policyIds: POLICY_IDS,
  },
  gates,
  outcomes,
  balanceReportOnly: {
    isCiGate: false,
    policyOutcomes: bulk.report.metrics.policyOutcomes,
    turns: bulk.report.metrics.turns,
    damage: bulk.report.metrics.damage,
    hpLossPerCombat: bulk.report.metrics.hpLossPerCombat,
    opportunities: bulk.report.metrics.opportunities,
    consumeVsFlip: bulk.report.metrics.consumeVsFlip,
    anomalySeedCount: bulk.report.anomalySeeds.length,
    globalAnomalyCount: bulk.report.globalAnomalies.length,
  },
  seed42: {
    expected: SEED_42_GOLDEN,
    actual: seed42Actual,
  },
};

console.log(JSON.stringify(report));

const failedGates = Object.entries(gates)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

if (failedGates.length > 0) {
  throw new Error(`M6 CI smoke failed: ${failedGates.join(", ")}`);
}
