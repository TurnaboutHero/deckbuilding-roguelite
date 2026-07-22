import {
  M6_METRICS_REPORT_SCHEMA_VERSION,
  M6_TRACE_SCHEMA_VERSION,
  type M6AnomalyFlag,
  type M6AnomalyThresholds,
  type M6CombatTrace,
  type M6DecisionTrace,
  type M6Distribution,
  type M6InterpretationItem,
  type M6MetricsReport,
  type M6PolicyOutcome,
  type M6PolicyWinGap,
  type M6Ratio,
  type M6ResolutionValueMetrics,
  type M6RunTrace,
  type M6SkillResolutionKind,
  type M6TurnTrace,
} from "./types";

export const DEFAULT_M6_ANOMALY_THRESHOLDS: M6AnomalyThresholds = Object.freeze({
  extremeTurnCount: 25,
  extremeDamagePerTurn: 100,
  consumeDominanceUseShare: 0.75,
  consumeDominanceDirectValueShare: 0.75,
  consumeDominanceMinimumUses: 20,
  gatekeeperEnemyIds: Object.freeze(["gatekeeper", "gatekeeper-plus"]),
});

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNumber = (left: number, right: number): number => left - right;

const sum = (values: readonly number[]): number =>
  [...values].sort(compareNumber).reduce((total, value) => total + value, 0);

export const metricRatio = (numerator: number, denominator: number): M6Ratio => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

/** Deterministic nearest-rank percentile. Empty samples return `null`. */
export const nearestRankPercentile = (
  values: readonly number[],
  percentile: number,
): number | null => {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new Error(`percentile must be within [0, 1], received ${percentile}`);
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort(compareNumber);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1] ?? null;
};
export const summarizeDistribution = (values: readonly number[]): M6Distribution => ({
  count: values.length,
  mean: values.length === 0 ? null : sum(values) / values.length,
  p50: nearestRankPercentile(values, 0.5),
  p99: nearestRankPercentile(values, 0.99),
  max: values.length === 0 ? null : nearestRankPercentile(values, 1),
});

const assertNonEmpty = (value: string, path: string): void => {
  if (value.length === 0) throw new Error(`${path} must not be empty`);
};

const assertNonNegativeFinite = (value: number, path: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite non-negative number`);
  }
};

const assertNonNegativeInteger = (value: number, path: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
};

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${path} must be unique`);
};

const validateDecision = (decision: M6DecisionTrace, turn: number, path: string): void => {
  if (decision.schemaVersion !== M6_TRACE_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is unsupported`);
  }
  assertNonNegativeInteger(decision.decisionIndex, `${path}.decisionIndex`);
  assertNonNegativeInteger(decision.turn, `${path}.turn`);
  if (decision.turn !== turn) throw new Error(`${path}.turn must match its parent turn`);
  assertNonEmpty(decision.commandKey, `${path}.commandKey`);
  assertNonEmpty(decision.commandType, `${path}.commandType`);
  if (decision.skill === null) return;
  assertNonEmpty(decision.skill.skillId, `${path}.skill.skillId`);
  if (decision.skill.resolution !== "flip" && decision.skill.resolution !== "consume") {
    throw new Error(`${path}.skill.resolution is unsupported`);
  }
  if (!Number.isInteger(decision.skill.coinCount) || decision.skill.coinCount <= 0) {
    throw new Error(`${path}.skill.coinCount must be a positive integer`);
  }
  assertNonNegativeFinite(
    decision.skill.valueContribution.directDamage,
    `${path}.skill.valueContribution.directDamage`,
  );
  assertNonNegativeFinite(
    decision.skill.valueContribution.blockGained,
    `${path}.skill.valueContribution.blockGained`,
  );
  assertNonNegativeFinite(
    decision.skill.valueContribution.burnStacksApplied,
    `${path}.skill.valueContribution.burnStacksApplied`,
  );
};

const validateTurn = (turn: M6TurnTrace, path: string): void => {
  if (turn.schemaVersion !== M6_TRACE_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is unsupported`);
  }
  assertNonNegativeInteger(turn.turn, `${path}.turn`);
  for (const [field, value] of [
    ["drawnCoinCount", turn.drawnCoinCount],
    ["unusedCoinCount", turn.unusedCoinCount],
    ["elementalCoinsSeen", turn.elementalCoinsSeen],
    ["elementalCoinsFlippedHeads", turn.elementalCoinsFlippedHeads],
    ["elementalCoinsConsumed", turn.elementalCoinsConsumed],
  ] as const) {
    assertNonNegativeInteger(value, `${path}.${field}`);
  }
  for (const [field, value] of [
    ["playerDamageDealt", turn.playerDamageDealt],
    ["enemyDamageDealt", turn.enemyDamageDealt],
    ["burnDamageDealt", turn.burnDamageDealt],
  ] as const) {
    assertNonNegativeFinite(value, `${path}.${field}`);
  }
  if (turn.unusedCoinCount > turn.drawnCoinCount) {
    throw new Error(`${path}.unusedCoinCount cannot exceed drawnCoinCount`);
  }
  // Immediate/repeat resolution can transform, return, then reuse the same
  // physical elemental coin within a turn. Uses are therefore not bounded by
  // distinct coin ids seen; they must only have an observed elemental source.
  if (
    turn.elementalCoinsSeen === 0 &&
    (turn.elementalCoinsFlippedHeads > 0 || turn.elementalCoinsConsumed > 0)
  ) {
    throw new Error(`${path} elemental coin uses require an observed elemental coin`);
  }
  if (turn.burnDamageDealt > turn.playerDamageDealt) {
    throw new Error(`${path}.burnDamageDealt cannot exceed playerDamageDealt`);
  }
  assertUnique(
    turn.decisions.map((decision) => String(decision.decisionIndex)),
    `${path}.decisionIndex`,
  );
  turn.decisions.forEach((decision, index) =>
    validateDecision(decision, turn.turn, `${path}.decisions[${index}]`),
  );
};

const validateCombat = (combat: M6CombatTrace, path: string): void => {
  if (combat.schemaVersion !== M6_TRACE_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is unsupported`);
  }
  assertNonNegativeInteger(combat.combatIndex, `${path}.combatIndex`);
  combat.enemyIds.forEach((enemyId, index) => assertNonEmpty(enemyId, `${path}.enemyIds[${index}]`));
  assertNonNegativeFinite(combat.startingPlayerHp, `${path}.startingPlayerHp`);
  assertNonNegativeFinite(combat.endingPlayerHp, `${path}.endingPlayerHp`);
  assertUnique(
    combat.turns.map((turn) => String(turn.turn)),
    `${path}.turn`,
  );
  combat.turns.forEach((turn, index) => validateTurn(turn, `${path}.turns[${index}]`));
};

const validateRun = (trace: M6RunTrace, path: string): void => {
  if (trace.schemaVersion !== M6_TRACE_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is unsupported`);
  }
  for (const [field, value] of [
    ["traceId", trace.traceId],
    ["episodeId", trace.episodeId],
    ["baseSeed", trace.baseSeed],
    ["runSeed", trace.runSeed],
    ["contentVersion", trace.contentVersion],
    ["variantId", trace.variantId],
    ["policyId", trace.policyId],
  ] as const) {
    assertNonEmpty(value, `${path}.${field}`);
  }
  if (trace.characterId !== undefined) {
    assertNonEmpty(trace.characterId, `${path}.characterId`);
  }
  if (trace.buildPolicyId !== undefined) {
    assertNonEmpty(trace.buildPolicyId, `${path}.buildPolicyId`);
  }
  assertNonNegativeInteger(trace.episodeIndex, `${path}.episodeIndex`);
  assertNonNegativeInteger(trace.expectedCombatCount, `${path}.expectedCombatCount`);
  if ((trace.result === "crash") !== (trace.crash !== null)) {
    throw new Error(`${path}.crash must be present exactly when result is crash`);
  }
  if (trace.crash !== null) assertNonEmpty(trace.crash.code, `${path}.crash.code`);
  assertUnique(
    trace.combats.map((combat) => String(combat.combatIndex)),
    `${path}.combatIndex`,
  );
  trace.combats.forEach((combat, index) => validateCombat(combat, `${path}.combats[${index}]`));
};

const canonicalDecisions = (turn: M6TurnTrace): readonly M6DecisionTrace[] =>
  [...turn.decisions].sort(
    (left, right) =>
      compareNumber(left.decisionIndex, right.decisionIndex) ||
      compareText(left.commandKey, right.commandKey),
  );

const canonicalTurns = (combat: M6CombatTrace): readonly M6TurnTrace[] =>
  [...combat.turns].sort((left, right) => compareNumber(left.turn, right.turn));

const canonicalCombats = (trace: M6RunTrace): readonly M6CombatTrace[] =>
  [...trace.combats].sort((left, right) => compareNumber(left.combatIndex, right.combatIndex));

interface MutableResolutionValue {
  uses: number;
  directDamage: number;
  blockGained: number;
  burnStacksApplied: number;
}

const emptyResolutionValue = (): MutableResolutionValue => ({
  uses: 0,
  directDamage: 0,
  blockGained: 0,
  burnStacksApplied: 0,
});

const resolutionReport = (value: MutableResolutionValue): M6ResolutionValueMetrics => ({
  ...value,
  directValue: value.directDamage + value.blockGained,
});

interface MutablePolicyOutcome {
  variantId: string;
  policyId: string;
  runs: number;
  terminalRuns: number;
  wins: number;
}

interface GatekeeperSequence {
  episodeId: string;
  variantId: string;
  combatIndex: number;
  enemyIds: readonly string[];
  commandSequence: readonly string[];
  policyIds: Set<string>;
}

const anomalyKey = (anomaly: M6AnomalyFlag): string => JSON.stringify(anomaly);

const buildMetadata = (): M6MetricsReport["metadata"] => {
  const informational: M6InterpretationItem[] = [
    {
      id: "mechanicalMetrics",
      status: "informational",
      reason: "Bot traces report reproducible mechanical facts; target bands are not bot pass/fail gates.",
    },
    {
      id: "policyWinGaps",
      status: "informational",
      reason: "Policy win-rate gaps are a strategy-depth signal, not proof of balance or fun.",
    },
    {
      id: "consumeVsFlip",
      status: "informational",
      reason: "Direct value is damage plus block; burn stacks stay separate and dominance warnings are report-only.",
    },
    {
      id: "anomalies",
      status: "informational",
      reason: "Extreme values, sequence convergence, and dominance warnings identify seeds for review and never fail CI balance gates.",
    },
  ];
  const humanRequired: M6InterpretationItem[] = [
    {
      id: "fun",
      status: "humanRequired",
      reason: "Bots cannot determine whether play is fun.",
    },
    {
      id: "clarity",
      status: "humanRequired",
      reason: "Rule and feedback clarity require human observation.",
    },
    {
      id: "elementalCoinDesire",
      status: "humanRequired",
      reason: "Mechanical utilization cannot substitute for wanting more elemental coins.",
    },
    {
      id: "rewardAttractiveness",
      status: "humanRequired",
      reason: "Bot reward choices do not measure perceived reward attractiveness.",
    },
    {
      id: "consumeDominanceSentiment",
      status: "humanRequired",
      reason: "A mechanical dominance warning cannot decide whether consume dominance feels bad.",
    },
  ];
  return {
    percentileMethod: "nearest-rank",
    zeroDenominator: "null",
    anomalyFlagsAreCiGates: false,
    informational,
    humanRequired,
  };
};

const validateThresholds = (thresholds: M6AnomalyThresholds): void => {
  assertNonNegativeFinite(thresholds.extremeTurnCount, "thresholds.extremeTurnCount");
  assertNonNegativeFinite(thresholds.extremeDamagePerTurn, "thresholds.extremeDamagePerTurn");
  for (const [field, value] of [
    ["consumeDominanceUseShare", thresholds.consumeDominanceUseShare],
    ["consumeDominanceDirectValueShare", thresholds.consumeDominanceDirectValueShare],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`thresholds.${field} must be within [0, 1]`);
    }
  }
  assertNonNegativeInteger(
    thresholds.consumeDominanceMinimumUses,
    "thresholds.consumeDominanceMinimumUses",
  );
  assertUnique([...thresholds.gatekeeperEnemyIds], "thresholds.gatekeeperEnemyIds");
  thresholds.gatekeeperEnemyIds.forEach((enemyId, index) =>
    assertNonEmpty(enemyId, `thresholds.gatekeeperEnemyIds[${index}]`),
  );
};

export const foldM6Metrics = (
  input: readonly M6RunTrace[],
  thresholdOverrides: Partial<M6AnomalyThresholds> = {},
): M6MetricsReport => {
  const thresholds: M6AnomalyThresholds = {
    ...DEFAULT_M6_ANOMALY_THRESHOLDS,
    ...thresholdOverrides,
    gatekeeperEnemyIds:
      thresholdOverrides.gatekeeperEnemyIds ?? DEFAULT_M6_ANOMALY_THRESHOLDS.gatekeeperEnemyIds,
  };
  validateThresholds(thresholds);
  assertUnique(
    input.map((trace) => trace.traceId),
    "traceId",
  );
  input.forEach((trace, index) => validateRun(trace, `traces[${index}]`));
  const traces = [...input].sort((left, right) => compareText(left.traceId, right.traceId));

  let terminalRuns = 0;
  let crashRuns = 0;
  let invariantViolationRuns = 0;
  let invariantViolationCount = 0;
  let wins = 0;
  let defeats = 0;
  let completedCombats = 0;
  let expectedCombats = 0;
  let drawnCoins = 0;
  let unusedCoins = 0;
  let playerDamage = 0;
  let burnDamage = 0;
  let elementalSeen = 0;
  let elementalUsed = 0;
  let consumeOpportunityTurns = 0;
  let consumeUseTurns = 0;
  let consumeUses = 0;
  let multiCoinOpportunityTurns = 0;
  let multiCoinUseTurns = 0;
  let multiCoinUses = 0;
  const combatTurnCounts: number[] = [];
  const turnsByEnemy = new Map<string, number[]>();
  const skillsPerTurn: number[] = [];
  const playerDamagePerTurn: number[] = [];
  const enemyDamagePerTurn: number[] = [];
  const hpLossPerCombat: number[] = [];
  const resolutionValues: Record<M6SkillResolutionKind, MutableResolutionValue> = {
    flip: emptyResolutionValue(),
    consume: emptyResolutionValue(),
  };
  const policyOutcomes = new Map<string, MutablePolicyOutcome>();
  const anomalies: M6AnomalyFlag[] = [];
  const gatekeeperSequences = new Map<string, GatekeeperSequence>();
  const gatekeeperEnemyIds = new Set(thresholds.gatekeeperEnemyIds);

  for (const trace of traces) {
    const terminal = trace.result === "victory" || trace.result === "defeat";
    if (terminal) terminalRuns += 1;
    else {
      anomalies.push({
        kind: "nonterminal",
        traceId: trace.traceId,
        episodeId: trace.episodeId,
        policyId: trace.policyId,
        result: trace.result,
      });
    }
    if (trace.result === "crash") crashRuns += 1;
    if (trace.result === "victory") wins += 1;
    if (trace.result === "defeat") defeats += 1;
    expectedCombats += trace.expectedCombatCount;

    const traceViolationCount =
      trace.invariantViolations.length +
      trace.combats.reduce((count, combat) => count + combat.invariantViolations.length, 0);
    if (traceViolationCount > 0) {
      invariantViolationRuns += 1;
      invariantViolationCount += traceViolationCount;
      anomalies.push({
        kind: "invariantFailure",
        traceId: trace.traceId,
        episodeId: trace.episodeId,
        policyId: trace.policyId,
        violationCount: traceViolationCount,
      });
    }

    const policyKey = `${trace.variantId}\u0000${trace.policyId}`;
    const policy = policyOutcomes.get(policyKey) ?? {
      variantId: trace.variantId,
      policyId: trace.policyId,
      runs: 0,
      terminalRuns: 0,
      wins: 0,
    };
    policy.runs += 1;
    if (terminal) policy.terminalRuns += 1;
    if (trace.result === "victory") policy.wins += 1;
    policyOutcomes.set(policyKey, policy);

    for (const combat of canonicalCombats(trace)) {
      const turns = canonicalTurns(combat);
      const turnCount = turns.length;
      combatTurnCounts.push(turnCount);
      if (combat.result === "victory" || combat.result === "defeat") completedCombats += 1;
      hpLossPerCombat.push(Math.max(0, combat.startingPlayerHp - combat.endingPlayerHp));
      for (const enemyId of [...new Set(combat.enemyIds)].sort(compareText)) {
        const values = turnsByEnemy.get(enemyId) ?? [];
        values.push(turnCount);
        turnsByEnemy.set(enemyId, values);
      }
      if (turnCount > thresholds.extremeTurnCount) {
        anomalies.push({
          kind: "extremeTurnCount",
          traceId: trace.traceId,
          combatIndex: combat.combatIndex,
          turnCount,
          threshold: thresholds.extremeTurnCount,
        });
      }

      const isGatekeeper = combat.enemyIds.some((enemyId) => gatekeeperEnemyIds.has(enemyId));
      if (isGatekeeper) {
        const enemyIds = [...combat.enemyIds].sort(compareText);
        const commandSequence = turns.flatMap((turn) =>
          canonicalDecisions(turn).map((decision) => decision.commandKey),
        );
        const groupKey = JSON.stringify([
          trace.episodeId,
          trace.variantId,
          combat.combatIndex,
          enemyIds,
          commandSequence,
        ]);
        const sequence = gatekeeperSequences.get(groupKey) ?? {
          episodeId: trace.episodeId,
          variantId: trace.variantId,
          combatIndex: combat.combatIndex,
          enemyIds,
          commandSequence,
          policyIds: new Set<string>(),
        };
        sequence.policyIds.add(trace.policyId);
        gatekeeperSequences.set(groupKey, sequence);
      }

      for (const turn of turns) {
        const decisions = canonicalDecisions(turn);
        const skills = decisions.flatMap((decision) => (decision.skill === null ? [] : [decision.skill]));
        const consumeSkills = skills.filter((skill) => skill.resolution === "consume");
        const multiCoinSkills = skills.filter((skill) => skill.coinCount >= 2);
        skillsPerTurn.push(skills.length);
        playerDamagePerTurn.push(turn.playerDamageDealt);
        enemyDamagePerTurn.push(turn.enemyDamageDealt);
        drawnCoins += turn.drawnCoinCount;
        unusedCoins += turn.unusedCoinCount;
        playerDamage += turn.playerDamageDealt;
        burnDamage += turn.burnDamageDealt;
        elementalSeen += turn.elementalCoinsSeen;
        elementalUsed += turn.elementalCoinsFlippedHeads + turn.elementalCoinsConsumed;
        if (turn.consumeOpportunity) consumeOpportunityTurns += 1;
        if (consumeSkills.length > 0) consumeUseTurns += 1;
        consumeUses += consumeSkills.length;
        if (turn.multiCoinSkillOpportunity) multiCoinOpportunityTurns += 1;
        if (multiCoinSkills.length > 0) multiCoinUseTurns += 1;
        multiCoinUses += multiCoinSkills.length;

        if (
          turn.playerDamageDealt > thresholds.extremeDamagePerTurn ||
          turn.enemyDamageDealt > thresholds.extremeDamagePerTurn
        ) {
          anomalies.push({
            kind: "extremeDamage",
            traceId: trace.traceId,
            combatIndex: combat.combatIndex,
            turn: turn.turn,
            playerDamage: turn.playerDamageDealt,
            enemyDamage: turn.enemyDamageDealt,
            threshold: thresholds.extremeDamagePerTurn,
          });
        }

        for (const skill of skills) {
          const value = resolutionValues[skill.resolution];
          value.uses += 1;
          value.directDamage += skill.valueContribution.directDamage;
          value.blockGained += skill.valueContribution.blockGained;
          value.burnStacksApplied += skill.valueContribution.burnStacksApplied;
        }
      }
    }
  }

  for (const sequence of gatekeeperSequences.values()) {
    const policyIds = [...sequence.policyIds].sort(compareText);
    if (policyIds.length < 2) continue;
    anomalies.push({
      kind: "gatekeeperPolicySequenceConvergence",
      episodeId: sequence.episodeId,
      variantId: sequence.variantId,
      combatIndex: sequence.combatIndex,
      enemyIds: sequence.enemyIds,
      policyIds,
      commandSequence: sequence.commandSequence,
    });
  }

  const flip = resolutionReport(resolutionValues.flip);
  const consume = resolutionReport(resolutionValues.consume);
  const consumeUseShare = metricRatio(consume.uses, flip.uses + consume.uses);
  const consumeDirectValueShare = metricRatio(
    consume.directValue,
    flip.directValue + consume.directValue,
  );
  if (
    flip.uses + consume.uses >= thresholds.consumeDominanceMinimumUses &&
    ((consumeUseShare.rate ?? 0) >= thresholds.consumeDominanceUseShare ||
      (consumeDirectValueShare.rate ?? 0) >= thresholds.consumeDominanceDirectValueShare)
  ) {
    anomalies.push({
      kind: "consumeDominanceWarning",
      consumeUses: consume.uses,
      totalSkillUses: flip.uses + consume.uses,
      consumeUseShare: consumeUseShare.rate ?? 0,
      consumeDirectValueShare: consumeDirectValueShare.rate,
      useShareThreshold: thresholds.consumeDominanceUseShare,
      directValueShareThreshold: thresholds.consumeDominanceDirectValueShare,
    });
  }

  const policyOutcomeReports: M6PolicyOutcome[] = [...policyOutcomes.values()]
    .sort(
      (left, right) =>
        compareText(left.variantId, right.variantId) || compareText(left.policyId, right.policyId),
    )
    .map((policy) => ({
      ...policy,
      winRate: metricRatio(policy.wins, policy.terminalRuns),
    }));
  const policyWinGaps: M6PolicyWinGap[] = [];
  const variantIds = [...new Set(policyOutcomeReports.map((policy) => policy.variantId))].sort(compareText);
  for (const variantId of variantIds) {
    const policies = policyOutcomeReports.filter((policy) => policy.variantId === variantId);
    for (let leftIndex = 0; leftIndex < policies.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < policies.length; rightIndex += 1) {
        const left = policies[leftIndex];
        const right = policies[rightIndex];
        if (left === undefined || right === undefined) continue;
        const signedGap =
          left.winRate.rate === null || right.winRate.rate === null
            ? null
            : left.winRate.rate - right.winRate.rate;
        policyWinGaps.push({
          variantId,
          leftPolicyId: left.policyId,
          rightPolicyId: right.policyId,
          signedGap: signedGap === 0 ? 0 : signedGap,
          absoluteGap: signedGap === null ? null : Math.abs(signedGap),
        });
      }
    }
  }

  return {
    schemaVersion: M6_METRICS_REPORT_SCHEMA_VERSION,
    traceSchemaVersion: M6_TRACE_SCHEMA_VERSION,
    outcomes: {
      runs: traces.length,
      terminalRuns,
      nonterminalRuns: traces.length - terminalRuns,
      crashRuns,
      invariantViolationRuns,
      invariantViolationCount,
      wins,
      defeats,
      winRate: metricRatio(wins, terminalRuns),
      runCompletionRate: metricRatio(terminalRuns, traces.length),
      completedCombats,
      expectedCombats,
      combatCompletionRate: metricRatio(completedCombats, expectedCombats),
    },
    turns: {
      overall: summarizeDistribution(combatTurnCounts),
      perEnemy: [...turnsByEnemy.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([enemyId, values]) => ({ enemyId, turns: summarizeDistribution(values) })),
    },
    skillsPerTurn: summarizeDistribution(skillsPerTurn),
    unusedCoinRate: metricRatio(unusedCoins, drawnCoins),
    damage: {
      player: summarizeDistribution(playerDamagePerTurn),
      enemy: summarizeDistribution(enemyDamagePerTurn),
      burnContribution: metricRatio(burnDamage, playerDamage),
    },
    hpLossPerCombat: summarizeDistribution(hpLossPerCombat),
    opportunities: {
      elementalCoinUtilization: metricRatio(elementalUsed, elementalSeen),
      consume: {
        opportunityTurns: consumeOpportunityTurns,
        useTurns: consumeUseTurns,
        uses: consumeUses,
        useTurnRate: metricRatio(consumeUseTurns, consumeOpportunityTurns),
      },
      multiCoinSkill: {
        opportunityTurns: multiCoinOpportunityTurns,
        useTurns: multiCoinUseTurns,
        uses: multiCoinUses,
        useTurnRate: metricRatio(multiCoinUseTurns, multiCoinOpportunityTurns),
      },
    },
    consumeVsFlip: {
      flip,
      consume,
      consumeUseShare,
      consumeDirectValueShare,
    },
    policyOutcomes: policyOutcomeReports,
    policyWinGaps,
    anomalyThresholds: {
      ...thresholds,
      gatekeeperEnemyIds: [...thresholds.gatekeeperEnemyIds],
    },
    anomalies: anomalies.sort((left, right) => compareText(anomalyKey(left), anomalyKey(right))),
    metadata: buildMetadata(),
  };
};
