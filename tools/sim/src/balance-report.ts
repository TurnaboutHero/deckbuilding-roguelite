import {
  M6_CRN_REPORT_SCHEMA_VERSION,
  runBulk,
  runCrnComparison,
  runBulkWithAaIdentity,
  type M6CrnPairedOutcome,
  type M6CrnReport,
  type M6EpisodeTranscript,
  type M6BuildPolicyId,
  type SimCharacterId,
} from "./bulk";
import {
  foldM6Metrics,
  summarizeDistribution,
  type M6AnomalyFlag,
  type M6Distribution,
  type M6Ratio,
  type M6ResolutionValueMetrics,
  type M6RunTrace,
} from "./metrics";
import { POLICY_IDS, type PolicyId } from "./policies";
import { M6_BUILD_POLICIES, resolveBuildPolicy } from "./run-sim";

declare const process: {
  argv: string[];
};

export const M6_BALANCE_REPORT_SCHEMA_VERSION = "m6-balance-report-v1" as const;
export const P3_BALANCE_REPORT_SCHEMA_VERSION =
  "p3-balance-report-v1" as const;

export const DEFAULT_M6_BALANCE_REPORT_OPTIONS = Object.freeze({
  baseSeed: "1",
  gamesPerPolicy: 125,
  crnGames: 20,
});

export interface M6BalanceReportOptions {
  readonly baseSeed?: string;
  readonly gamesPerPolicy?: number;
  readonly crnGames?: number;
}

interface M6CombatResultCounts {
  readonly victories: number;
  readonly defeats: number;
  readonly nonterminal: number;
}

export interface M6PolicyEnemyRow {
  readonly variantId: string;
  readonly policyId: string;
  readonly enemyId: string;
  readonly combatCount: number;
  readonly results: M6CombatResultCounts;
  readonly turns: M6Distribution;
}

export interface P3PolicyEnemyCharacterRow extends M6PolicyEnemyRow {
  readonly characterId: SimCharacterId;
  readonly buildPolicyId: M6BuildPolicyId;
}

interface M6SeedResolutionComparison {
  readonly episodeRuns: number;
  readonly withSkillUse: number;
  readonly useFrequency: {
    readonly consumeHigher: number;
    readonly flipHigher: number;
    readonly equal: number;
  };
  readonly directValue: {
    readonly consumeHigher: number;
    readonly flipHigher: number;
    readonly equal: number;
  };
}

export interface M6PolicyResolutionRow {
  readonly variantId: string;
  readonly policyId: string;
  readonly runs: number;
  readonly flip: M6ResolutionValueMetrics;
  readonly consume: M6ResolutionValueMetrics;
  readonly consumeUseShare: M6Ratio;
  readonly consumeDirectValueShare: M6Ratio;
  readonly acrossSeeds: M6SeedResolutionComparison;
}

interface M6CountByEnemy {
  readonly enemyId: string;
  readonly occurrences: number;
}

interface M6CountByPolicySet {
  readonly policyIds: readonly string[];
  readonly occurrences: number;
}

export interface M6GatekeeperConvergenceBreakdown {
  readonly exactSequenceOccurrences: number;
  readonly uniqueEpisodes: number;
  readonly episodeIndices: readonly number[];
  readonly byEnemy: readonly M6CountByEnemy[];
  readonly byPolicySet: readonly M6CountByPolicySet[];
}

interface M6AnomalyKindCount {
  readonly kind: M6AnomalyFlag["kind"];
  readonly occurrences: number;
}

interface M6BalanceAnomalyBreakdown {
  readonly occurrenceCount: number;
  readonly anomalySeedCount: number;
  readonly globalAnomalyCount: number;
  readonly byKind: readonly M6AnomalyKindCount[];
}

interface M6CompactVariantOutcome {
  readonly variantId: string;
  readonly rewardPriority: "fire-first" | "basic-first";
  readonly terminalRuns: number;
  readonly wins: number;
  readonly defeats: number;
  readonly winRate: M6Ratio;
}

interface M6CompactCrnEvidence {
  readonly schemaVersion: typeof M6_CRN_REPORT_SCHEMA_VERSION;
  readonly policyId: string;
  readonly baseSeed: string;
  readonly games: number;
  readonly aa: M6CrnReport["aa"];
  readonly paired: M6CrnPairedOutcome;
  readonly variants: readonly [
    M6CompactVariantOutcome,
    M6CompactVariantOutcome,
  ];
  readonly anomalySeedCount: number;
  readonly isBalanceGate: false;
}

interface P3CharacterOutcome {
  readonly characterId: SimCharacterId;
  readonly buildPolicyId: M6BuildPolicyId;
  readonly terminalRuns: number;
  readonly wins: number;
  readonly defeats: number;
  readonly winRate: M6Ratio;
}

interface P3CharacterCrnEvidence {
  readonly policyId: "greedy";
  readonly variantId: "baseline";
  readonly baseSeed: string;
  readonly games: number;
  readonly aa: M6CrnReport["aa"];
  readonly paired: M6CrnPairedOutcome;
  readonly characters: readonly [P3CharacterOutcome, P3CharacterOutcome];
  readonly anomalySeedCount: number;
  readonly isBalanceGate: false;
}

interface P3GuardianSafetyMetrics {
  readonly sample: "guardian policy runs";
  readonly runs: number;
  readonly terminalRuns: number;
  readonly crashRuns: number;
  readonly invariantViolationRuns: number;
  readonly invariantViolationCount: number;
  readonly isCiGate: false;
}

interface P3CharacterSafetyMetrics {
  readonly characterId: SimCharacterId;
  readonly buildPolicyId: M6BuildPolicyId;
  readonly sample: string;
  readonly runs: number;
  readonly terminalRuns: number;
  readonly crashRuns: number;
  readonly invariantViolationRuns: number;
  readonly invariantViolationCount: number;
  readonly isCiGate: false;
}

interface P3RewardSelectionFlag {
  readonly characterId?: SimCharacterId;
  readonly buildPolicyId?: M6BuildPolicyId;
  readonly optionType: "coin" | "skill";
  readonly optionId: string;
  readonly offered: number;
  readonly selected: number;
  readonly selectionRate: number | null;
  readonly flag: "always-selected" | "never-selected";
  readonly isGate: false;
}

interface P3RewardSelectionReport {
  readonly thresholds: {
    readonly alwaysSelectedExclusive: 0.95;
    readonly neverSelectedExclusive: 0.02;
  };
  readonly flags: readonly P3RewardSelectionFlag[];
  readonly byCharacterBuild: readonly P3RewardSelectionFlag[];
}

interface P3BuildPolicyRow {
  readonly buildPolicyId: M6BuildPolicyId;
  readonly defaultCharacters: readonly SimCharacterId[];
  readonly coinRewardPriority: readonly string[];
  readonly skillRewardPriority: readonly string[];
}

interface P3RewardSelectionDistributionRow {
  readonly characterId: SimCharacterId;
  readonly buildPolicyId: M6BuildPolicyId;
  readonly optionType: "coin" | "skill";
  readonly optionId: string;
  readonly offered: number;
  readonly selected: number;
  readonly selectionRate: number | null;
}

interface P3RewardSelectionAuditRow extends P3RewardSelectionDistributionRow {
  readonly flag: P3RewardSelectionFlag["flag"] | "not-offered" | null;
  readonly observation: string;
}

interface M6InformationalTargetBand {
  readonly id: string;
  readonly sample: string;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly observed: number | null;
  readonly withinBand: boolean | null;
  readonly isGate: false;
}

interface M6Warning {
  readonly id: string;
  readonly active: boolean;
  readonly observation: string;
  readonly isGate: false;
}

interface M6HumanQuestion {
  readonly id: string;
  readonly question: string;
  readonly status: "pending";
}

export interface M6BalanceReport {
  readonly schemaVersion: typeof P3_BALANCE_REPORT_SCHEMA_VERSION;
  readonly configuration: {
    readonly baseSeed: string;
    readonly gamesPerPolicy: number;
    readonly totalPolicyRuns: number;
    readonly policyIds: readonly PolicyId[];
    readonly variantId: "baseline";
    readonly crnGames: number;
  };
  readonly tuningDecision: {
    readonly numericContentChange: "none";
    readonly reason: string;
  };
  readonly mechanicalFacts: {
    readonly outcomes: ReturnType<typeof foldM6Metrics>["outcomes"];
    readonly policyEnemy: readonly M6PolicyEnemyRow[];
    readonly policyConsumeVsFlip: readonly M6PolicyResolutionRow[];
    readonly gatekeeperConvergence: M6GatekeeperConvergenceBreakdown;
    readonly anomalies: M6BalanceAnomalyBreakdown;
    readonly crn: M6CompactCrnEvidence;
    readonly policyEnemyCharacter: readonly P3PolicyEnemyCharacterRow[];
    readonly guardianSafety500: P3GuardianSafetyMetrics;
    readonly characterSafety500: readonly P3CharacterSafetyMetrics[];
    readonly rewardSelectionDominance: P3RewardSelectionReport;
    readonly buildPolicies: readonly P3BuildPolicyRow[];
    readonly rewardSelectionByCharacterBuild: readonly P3RewardSelectionDistributionRow[];
    readonly rewardSelectionAudit: readonly P3RewardSelectionAuditRow[];
    readonly characterCrn: P3CharacterCrnEvidence;
    readonly frostCharacterCrn: P3CharacterCrnEvidence;
  };
  readonly informationalTargetBands: readonly M6InformationalTargetBand[];
  readonly warnings: readonly M6Warning[];
  readonly humanRequiredQuestions: readonly M6HumanQuestion[];
  readonly phase3: {
    readonly conclusionLabels: readonly [
      "engineering-safe",
      "balance-provisional",
      "experience-unverified",
    ];
    readonly overrideReference: "PHASE1_HOLDS.md";
    readonly reason: string;
  };
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNumbers = (left: number, right: number): number => left - right;

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
};

const defaultBuildPolicyIdForCharacter = (
  characterId: SimCharacterId,
): M6BuildPolicyId => resolveBuildPolicy(characterId, "baseline").id;

const normalizedOptions = (
  options: M6BalanceReportOptions,
): Required<M6BalanceReportOptions> => {
  const normalized = {
    baseSeed: options.baseSeed ?? DEFAULT_M6_BALANCE_REPORT_OPTIONS.baseSeed,
    gamesPerPolicy:
      options.gamesPerPolicy ??
      DEFAULT_M6_BALANCE_REPORT_OPTIONS.gamesPerPolicy,
    crnGames: options.crnGames ?? DEFAULT_M6_BALANCE_REPORT_OPTIONS.crnGames,
  };
  if (normalized.baseSeed.length === 0) throw new Error("baseSeed is required");
  assertPositiveInteger(normalized.gamesPerPolicy, "gamesPerPolicy");
  assertPositiveInteger(normalized.crnGames, "crnGames");
  return normalized;
};

interface MutablePolicyEnemyRow {
  variantId: string;
  policyId: string;
  enemyId: string;
  victories: number;
  defeats: number;
  nonterminal: number;
  turns: number[];
}

export const aggregatePolicyEnemyRows = (
  traces: readonly M6RunTrace[],
): readonly M6PolicyEnemyRow[] => {
  const rows = new Map<string, MutablePolicyEnemyRow>();
  for (const trace of traces) {
    for (const combat of trace.combats) {
      for (const enemyId of [...new Set(combat.enemyIds)].sort(compareText)) {
        const key = JSON.stringify([trace.variantId, trace.policyId, enemyId]);
        const row = rows.get(key) ?? {
          variantId: trace.variantId,
          policyId: trace.policyId,
          enemyId,
          victories: 0,
          defeats: 0,
          nonterminal: 0,
          turns: [],
        };
        if (combat.result === "victory") row.victories += 1;
        else if (combat.result === "defeat") row.defeats += 1;
        else row.nonterminal += 1;
        row.turns.push(combat.turns.length);
        rows.set(key, row);
      }
    }
  }

  return [...rows.values()]
    .sort(
      (left, right) =>
        compareText(left.variantId, right.variantId) ||
        compareText(left.policyId, right.policyId) ||
        compareText(left.enemyId, right.enemyId),
    )
    .map((row) => ({
      variantId: row.variantId,
      policyId: row.policyId,
      enemyId: row.enemyId,
      combatCount: row.turns.length,
      results: {
        victories: row.victories,
        defeats: row.defeats,
        nonterminal: row.nonterminal,
      },
      turns: summarizeDistribution(row.turns),
    }));
};

export const aggregatePolicyEnemyCharacterRows = (
  traces: readonly M6RunTrace[],
): readonly P3PolicyEnemyCharacterRow[] => {
  const rows = new Map<
    string,
    MutablePolicyEnemyRow & {
      characterId: SimCharacterId;
      buildPolicyId: M6BuildPolicyId;
    }
  >();
  for (const trace of traces) {
    const characterId = (trace.characterId ?? "warrior") as SimCharacterId;
    const buildPolicyId = (trace.buildPolicyId ??
      defaultBuildPolicyIdForCharacter(characterId)) as M6BuildPolicyId;
    for (const combat of trace.combats) {
      for (const enemyId of [...new Set(combat.enemyIds)].sort(compareText)) {
        const key = JSON.stringify([
          trace.variantId,
          trace.policyId,
          enemyId,
          characterId,
          buildPolicyId,
        ]);
        const row = rows.get(key) ?? {
          variantId: trace.variantId,
          policyId: trace.policyId,
          enemyId,
          characterId,
          buildPolicyId,
          victories: 0,
          defeats: 0,
          nonterminal: 0,
          turns: [],
        };
        if (combat.result === "victory") row.victories += 1;
        else if (combat.result === "defeat") row.defeats += 1;
        else row.nonterminal += 1;
        row.turns.push(combat.turns.length);
        rows.set(key, row);
      }
    }
  }

  return [...rows.values()]
    .sort(
      (left, right) =>
        compareText(left.variantId, right.variantId) ||
        compareText(left.policyId, right.policyId) ||
        compareText(left.enemyId, right.enemyId) ||
        compareText(left.characterId, right.characterId) ||
        compareText(left.buildPolicyId, right.buildPolicyId),
    )
    .map((row) => ({
      variantId: row.variantId,
      policyId: row.policyId,
      enemyId: row.enemyId,
      characterId: row.characterId,
      buildPolicyId: row.buildPolicyId,
      combatCount: row.turns.length,
      results: {
        victories: row.victories,
        defeats: row.defeats,
        nonterminal: row.nonterminal,
      },
      turns: summarizeDistribution(row.turns),
    }));
};

const compareMetric = (
  left: number,
  right: number,
  counts: { consumeHigher: number; flipHigher: number; equal: number },
): void => {
  if (left > right) counts.consumeHigher += 1;
  else if (right > left) counts.flipHigher += 1;
  else counts.equal += 1;
};

const compareResolutionAcrossSeeds = (
  traces: readonly M6RunTrace[],
): M6SeedResolutionComparison => {
  const useFrequency = { consumeHigher: 0, flipHigher: 0, equal: 0 };
  const directValue = { consumeHigher: 0, flipHigher: 0, equal: 0 };
  let withSkillUse = 0;

  for (const trace of traces) {
    const comparison = foldM6Metrics([trace]).consumeVsFlip;
    if (comparison.consume.uses + comparison.flip.uses > 0) withSkillUse += 1;
    compareMetric(comparison.consume.uses, comparison.flip.uses, useFrequency);
    compareMetric(
      comparison.consume.directValue,
      comparison.flip.directValue,
      directValue,
    );
  }

  return {
    episodeRuns: traces.length,
    withSkillUse,
    useFrequency,
    directValue,
  };
};

export const aggregatePolicyResolutionRows = (
  traces: readonly M6RunTrace[],
): readonly M6PolicyResolutionRow[] => {
  const groups = new Map<string, M6RunTrace[]>();
  for (const trace of traces) {
    const key = JSON.stringify([trace.variantId, trace.policyId]);
    const group = groups.get(key) ?? [];
    group.push(trace);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((left, right) => {
      const a = left[0];
      const b = right[0];
      if (a === undefined || b === undefined) return left.length - right.length;
      return (
        compareText(a.variantId, b.variantId) ||
        compareText(a.policyId, b.policyId)
      );
    })
    .map((group) => {
      const first = group[0];
      if (first === undefined) throw new Error("empty policy trace group");
      const metrics = foldM6Metrics(group).consumeVsFlip;
      return {
        variantId: first.variantId,
        policyId: first.policyId,
        runs: group.length,
        flip: metrics.flip,
        consume: metrics.consume,
        consumeUseShare: metrics.consumeUseShare,
        consumeDirectValueShare: metrics.consumeDirectValueShare,
        acrossSeeds: compareResolutionAcrossSeeds(group),
      };
    });
};

export const aggregateGatekeeperConvergence = (
  traces: readonly M6RunTrace[],
  anomalies: readonly M6AnomalyFlag[],
): M6GatekeeperConvergenceBreakdown => {
  const traceEpisodeIndexes = new Map(
    traces.map((trace) => [trace.episodeId, trace.episodeIndex]),
  );
  const episodeIndices = new Set<number>();
  const byEnemy = new Map<string, number>();
  const byPolicySet = new Map<string, { policyIds: string[]; count: number }>();
  let exactSequenceOccurrences = 0;

  for (const anomaly of anomalies) {
    if (anomaly.kind !== "gatekeeperPolicySequenceConvergence") continue;
    exactSequenceOccurrences += 1;
    const episodeIndex = traceEpisodeIndexes.get(anomaly.episodeId);
    if (episodeIndex !== undefined) episodeIndices.add(episodeIndex);
    for (const enemyId of [...new Set(anomaly.enemyIds)].sort(compareText)) {
      byEnemy.set(enemyId, (byEnemy.get(enemyId) ?? 0) + 1);
    }
    const policyIds = [...anomaly.policyIds].sort(compareText);
    const key = JSON.stringify(policyIds);
    const current = byPolicySet.get(key) ?? { policyIds, count: 0 };
    current.count += 1;
    byPolicySet.set(key, current);
  }

  return {
    exactSequenceOccurrences,
    uniqueEpisodes: episodeIndices.size,
    episodeIndices: [...episodeIndices].sort(compareNumbers),
    byEnemy: [...byEnemy.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([enemyId, occurrences]) => ({ enemyId, occurrences })),
    byPolicySet: [...byPolicySet.values()]
      .sort((left, right) =>
        compareText(
          JSON.stringify(left.policyIds),
          JSON.stringify(right.policyIds),
        ),
      )
      .map((entry) => ({
        policyIds: entry.policyIds,
        occurrences: entry.count,
      })),
  };
};

const compactCrnEvidence = (report: M6CrnReport): M6CompactCrnEvidence => {
  const outcome = (
    variant: M6CrnReport["a"] | M6CrnReport["b"],
    rewardPriority: M6CompactVariantOutcome["rewardPriority"],
  ): M6CompactVariantOutcome => ({
    variantId: variant.variantIds[0] ?? "unknown",
    rewardPriority,
    terminalRuns: variant.metrics.outcomes.terminalRuns,
    wins: variant.metrics.outcomes.wins,
    defeats: variant.metrics.outcomes.defeats,
    winRate: variant.metrics.outcomes.winRate,
  });

  return {
    schemaVersion: report.schemaVersion,
    policyId: report.policyId,
    baseSeed: report.baseSeed,
    games: report.games,
    aa: report.aa,
    paired: report.paired,
    variants: [
      outcome(report.a, "fire-first"),
      outcome(report.b, "basic-first"),
    ],
    anomalySeedCount: report.anomalySeeds.length,
    isBalanceGate: false,
  };
};

const ratio = (numerator: number, denominator: number): M6Ratio => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

const endingHp = (trace: M6RunTrace): number =>
  trace.combats.at(-1)?.endingPlayerHp ?? 70;

const completedCombats = (trace: M6RunTrace): number =>
  trace.combats.filter(
    (combat) => combat.result === "victory" || combat.result === "defeat",
  ).length;

const pairedOutcomes = (
  a: readonly M6RunTrace[],
  b: readonly M6RunTrace[],
): M6CrnPairedOutcome => {
  const byEpisodeB = new Map(b.map((trace) => [trace.episodeId, trace]));
  let sameResult = 0;
  let aOnlyWins = 0;
  let bOnlyWins = 0;
  let bothWin = 0;
  let bothDefeat = 0;
  let nonterminalPairs = 0;
  let hpDelta = 0;
  let completedCombatDelta = 0;
  let terminalPairs = 0;

  for (const left of a) {
    const right = byEpisodeB.get(left.episodeId);
    if (right === undefined) throw new Error(`missing CRN pair for ${left.episodeId}`);
    if (left.runSeed !== right.runSeed) {
      throw new Error(`CRN run seed mismatch for ${left.episodeId}`);
    }
    if (left.result === right.result) sameResult += 1;
    if (left.result === "victory" && right.result === "victory") bothWin += 1;
    if (left.result === "defeat" && right.result === "defeat") bothDefeat += 1;
    if (left.result === "victory" && right.result !== "victory") aOnlyWins += 1;
    if (right.result === "victory" && left.result !== "victory") bOnlyWins += 1;
    const terminal =
      (left.result === "victory" || left.result === "defeat") &&
      (right.result === "victory" || right.result === "defeat");
    if (!terminal) {
      nonterminalPairs += 1;
      continue;
    }
    terminalPairs += 1;
    hpDelta += endingHp(right) - endingHp(left);
    completedCombatDelta += completedCombats(right) - completedCombats(left);
  }

  return {
    pairs: a.length,
    sameResult,
    aOnlyWins,
    bOnlyWins,
    bothWin,
    bothDefeat,
    nonterminalPairs,
    meanCarriedHpDeltaBMinusA:
      terminalPairs === 0 ? null : hpDelta / terminalPairs,
    meanCompletedCombatDeltaBMinusA:
      terminalPairs === 0 ? null : completedCombatDelta / terminalPairs,
  };
};

const characterOutcome = (
  characterId: SimCharacterId,
  buildPolicyId: M6BuildPolicyId,
  traces: readonly M6RunTrace[],
): P3CharacterOutcome => {
  const terminal = traces.filter(
    (trace) => trace.result === "victory" || trace.result === "defeat",
  );
  const wins = traces.filter((trace) => trace.result === "victory").length;
  const defeats = traces.filter((trace) => trace.result === "defeat").length;
  return {
    characterId,
    buildPolicyId,
    terminalRuns: terminal.length,
    wins,
    defeats,
    winRate: ratio(wins, terminal.length),
  };
};

const compactCharacterCrnEvidence = (
  baseSeed: string,
  games: number,
  aa: M6CrnReport["aa"],
  left: {
    readonly characterId: SimCharacterId;
    readonly buildPolicyId: M6BuildPolicyId;
    readonly traces: readonly M6RunTrace[];
  },
  right: {
    readonly characterId: SimCharacterId;
    readonly buildPolicyId: M6BuildPolicyId;
    readonly traces: readonly M6RunTrace[];
  },
  anomalySeedCount: number,
): P3CharacterCrnEvidence => ({
  policyId: "greedy",
  variantId: "baseline",
  baseSeed,
  games,
  aa,
  paired: pairedOutcomes(left.traces, right.traces),
  characters: [
    characterOutcome(left.characterId, left.buildPolicyId, left.traces),
    characterOutcome(right.characterId, right.buildPolicyId, right.traces),
  ],
  anomalySeedCount,
  isBalanceGate: false,
});

const guardianSafetyMetrics = (
  traces: readonly M6RunTrace[],
): P3GuardianSafetyMetrics => {
  const outcomes = foldM6Metrics(traces).outcomes;
  return {
    sample: "guardian policy runs",
    runs: outcomes.runs,
    terminalRuns: outcomes.terminalRuns,
    crashRuns: outcomes.crashRuns,
    invariantViolationRuns: outcomes.invariantViolationRuns,
    invariantViolationCount: outcomes.invariantViolationCount,
    isCiGate: false,
  };
};

const characterSafetyMetrics = (
  characterId: SimCharacterId,
  buildPolicyId: M6BuildPolicyId,
  traces: readonly M6RunTrace[],
): P3CharacterSafetyMetrics => {
  const outcomes = foldM6Metrics(traces).outcomes;
  return {
    characterId,
    buildPolicyId,
    sample: `${characterId} ${buildPolicyId} policy runs`,
    runs: outcomes.runs,
    terminalRuns: outcomes.terminalRuns,
    crashRuns: outcomes.crashRuns,
    invariantViolationRuns: outcomes.invariantViolationRuns,
    invariantViolationCount: outcomes.invariantViolationCount,
    isCiGate: false,
  };
};

interface MutableRewardSelection {
  characterId?: SimCharacterId;
  buildPolicyId?: M6BuildPolicyId;
  optionType: "coin" | "skill";
  optionId: string;
  offered: number;
  selected: number;
}

const addRewardOffer = (
  rows: Map<string, MutableRewardSelection>,
  optionType: "coin" | "skill",
  optionId: string,
  selected: string | null,
  characterId?: SimCharacterId,
  buildPolicyId?: M6BuildPolicyId,
): void => {
  const key = JSON.stringify([
    characterId ?? null,
    buildPolicyId ?? null,
    optionType,
    optionId,
  ]);
  const row = rows.get(key) ?? {
    characterId,
    buildPolicyId,
    optionType,
    optionId,
    offered: 0,
    selected: 0,
  };
  row.offered += 1;
  if (selected === optionId) row.selected += 1;
  rows.set(key, row);
};

const rewardSelectionRows = (
  transcripts: readonly M6EpisodeTranscript[],
  scoped: boolean,
): readonly P3RewardSelectionDistributionRow[] => {
  const rows = new Map<string, MutableRewardSelection>();
  for (const transcript of transcripts) {
    const characterId = (transcript.characterId ?? "warrior") as SimCharacterId;
    const buildPolicyId = (transcript.buildPolicyId ??
      defaultBuildPolicyIdForCharacter(characterId)) as M6BuildPolicyId;
    for (const reward of transcript.rewards) {
      for (const option of reward.coinOptions) {
        addRewardOffer(
          rows,
          "coin",
          option,
          reward.selectedCoin,
          scoped ? characterId : undefined,
          scoped ? buildPolicyId : undefined,
        );
      }
      for (const option of reward.fallbackCoinOptions) {
        addRewardOffer(
          rows,
          "coin",
          option,
          reward.selectedFallbackCoin,
          scoped ? characterId : undefined,
          scoped ? buildPolicyId : undefined,
        );
      }
      for (const option of reward.skillOptions) {
        addRewardOffer(
          rows,
          "skill",
          option,
          reward.selectedSkill,
          scoped ? characterId : undefined,
          scoped ? buildPolicyId : undefined,
        );
      }
    }
  }

  return [...rows.values()]
    .sort(
      (left, right) =>
        compareText(left.characterId ?? "", right.characterId ?? "") ||
        compareText(left.buildPolicyId ?? "", right.buildPolicyId ?? "") ||
        compareText(left.optionType, right.optionType) ||
        compareText(left.optionId, right.optionId),
    )
    .map((row) => ({
      characterId: row.characterId ?? "warrior",
      buildPolicyId:
        row.buildPolicyId ?? defaultBuildPolicyIdForCharacter("warrior"),
      optionType: row.optionType,
      optionId: row.optionId,
      offered: row.offered,
      selected: row.selected,
      selectionRate: row.offered === 0 ? null : row.selected / row.offered,
    }));
};

const flagRewardSelection = (
  rows: readonly P3RewardSelectionDistributionRow[],
  includeScope: boolean,
): readonly P3RewardSelectionFlag[] =>
  rows
    .map((row): P3RewardSelectionFlag | null => {
      if (row.selectionRate !== null && row.selectionRate > 0.95) {
        return {
          ...(includeScope
            ? {
                characterId: row.characterId,
                buildPolicyId: row.buildPolicyId,
              }
            : {}),
          optionType: row.optionType,
          optionId: row.optionId,
          offered: row.offered,
          selected: row.selected,
          selectionRate: row.selectionRate,
          flag: "always-selected",
          isGate: false,
        };
      }
      if (row.selectionRate !== null && row.selectionRate < 0.02) {
        return {
          ...(includeScope
            ? {
                characterId: row.characterId,
                buildPolicyId: row.buildPolicyId,
              }
            : {}),
          optionType: row.optionType,
          optionId: row.optionId,
          offered: row.offered,
          selected: row.selected,
          selectionRate: row.selectionRate,
          flag: "never-selected",
          isGate: false,
        };
      }
      return null;
    })
    .filter((flag): flag is P3RewardSelectionFlag => flag !== null)
    .sort(
      (left, right) =>
        compareText(left.characterId ?? "", right.characterId ?? "") ||
        compareText(left.buildPolicyId ?? "", right.buildPolicyId ?? "") ||
        compareText(left.optionType, right.optionType) ||
        compareText(left.optionId, right.optionId),
    );

const globalConsistentFlags = (
  scopedFlags: readonly P3RewardSelectionFlag[],
  scopedRows: readonly P3RewardSelectionDistributionRow[],
): readonly P3RewardSelectionFlag[] => {
  const scopes = new Set(
    scopedRows.map((row) =>
      JSON.stringify([row.characterId, row.buildPolicyId]),
    ),
  );
  const grouped = new Map<string, P3RewardSelectionFlag[]>();
  for (const flag of scopedFlags) {
    const key = JSON.stringify([flag.optionType, flag.optionId, flag.flag]);
    const group = grouped.get(key) ?? [];
    group.push(flag);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .filter((group) => {
      const scopeKeys = new Set(
        group.map((flag) =>
          JSON.stringify([flag.characterId, flag.buildPolicyId]),
        ),
      );
      return scopes.size > 0 && scopeKeys.size === scopes.size;
    })
    .map((group) => {
      const first = group[0];
      if (first === undefined) throw new Error("empty reward flag group");
      const offered = group.reduce((total, flag) => total + flag.offered, 0);
      const selected = group.reduce((total, flag) => total + flag.selected, 0);
      return {
        optionType: first.optionType,
        optionId: first.optionId,
        offered,
        selected,
        selectionRate: offered === 0 ? null : selected / offered,
        flag: first.flag,
        isGate: false as const,
      };
    })
    .sort(
      (left, right) =>
        compareText(left.optionType, right.optionType) ||
        compareText(left.optionId, right.optionId) ||
        compareText(left.flag, right.flag),
    );
};

const rewardSelectionReport = (
  transcripts: readonly M6EpisodeTranscript[],
): P3RewardSelectionReport => {
  const scopedRows = rewardSelectionRows(transcripts, true);
  const scopedFlags = flagRewardSelection(scopedRows, true);
  return {
    thresholds: {
      alwaysSelectedExclusive: 0.95,
      neverSelectedExclusive: 0.02,
    },
    flags: globalConsistentFlags(scopedFlags, scopedRows),
    byCharacterBuild: scopedFlags,
  };
};

const buildPolicyRows = (): readonly P3BuildPolicyRow[] =>
  (
    [
      ["fire-build", ["warrior"]],
      ["mana-build", ["guardian"]],
      ["frost-build", ["frost-knight"]],
      ["lightning-build", ["sorcerer"]],
    ] as const
  ).map(([buildPolicyId, defaultCharacters]) => ({
    buildPolicyId,
    defaultCharacters,
    coinRewardPriority: M6_BUILD_POLICIES[buildPolicyId].coinRewardPriority,
    skillRewardPriority: M6_BUILD_POLICIES[buildPolicyId].skillRewardPriority,
  }));

const rewardSelectionAuditRows = (
  rows: readonly P3RewardSelectionDistributionRow[],
): readonly P3RewardSelectionAuditRow[] => {
  const required = [
    {
      characterId: "guardian" as const,
      buildPolicyId: "mana-build" as const,
      optionType: "skill" as const,
      optionId: "mana-well",
    },
    {
      characterId: "sorcerer" as const,
      buildPolicyId: "lightning-build" as const,
      optionType: "skill" as const,
      optionId: "spark-strike",
    },
    {
      characterId: "frost-knight" as const,
      buildPolicyId: "frost-build" as const,
      optionType: "skill" as const,
      optionId: "freeze-dry",
    },
  ];
  return required
    .map((item): P3RewardSelectionAuditRow => {
      const row = rows.find(
        (candidate) =>
          candidate.characterId === item.characterId &&
          candidate.buildPolicyId === item.buildPolicyId &&
          candidate.optionType === item.optionType &&
          candidate.optionId === item.optionId,
      ) ?? {
        ...item,
        offered: 0,
        selected: 0,
        selectionRate: null,
      };
      return {
        ...row,
        flag:
          row.offered === 0
            ? "not-offered"
            : row.selectionRate !== null && row.selectionRate > 0.95
              ? "always-selected"
              : row.selectionRate !== null && row.selectionRate < 0.02
                ? "never-selected"
                : null,
        observation:
          row.offered === 0
            ? `${item.optionId} was not offered under ${item.characterId}/${item.buildPolicyId} in this sweep`
            : `${item.optionId} selected ${row.selected}/${row.offered} when offered under ${item.characterId}/${item.buildPolicyId}`,
      };
    })
    .sort(
      (left, right) =>
        compareText(left.characterId, right.characterId) ||
        compareText(left.buildPolicyId, right.buildPolicyId) ||
        compareText(left.optionType, right.optionType) ||
        compareText(left.optionId, right.optionId),
    );
};

const withinBand = (
  observed: number | null,
  minimum: number | null,
  maximum: number | null,
): boolean | null => {
  if (observed === null) return null;
  return (
    (minimum === null || observed >= minimum) &&
    (maximum === null || observed <= maximum)
  );
};

const targetBand = (
  id: string,
  sample: string,
  observed: number | null,
  minimum: number | null,
  maximum: number | null,
): M6InformationalTargetBand => ({
  id,
  sample,
  minimum,
  maximum,
  observed,
  withinBand: withinBand(observed, minimum, maximum),
  isGate: false,
});

const informationalTargetBands = (
  metrics: ReturnType<typeof foldM6Metrics>,
): readonly M6InformationalTargetBand[] => [
  targetBand(
    "overallTurns",
    "all completed bot combats",
    metrics.turns.overall.mean,
    4,
    7,
  ),
  ...metrics.turns.perEnemy.map((enemy) =>
    targetBand(
      `enemyTurns:${enemy.enemyId}`,
      enemy.enemyId,
      enemy.turns.mean,
      3,
      7.5,
    ),
  ),
  targetBand(
    "elementalCoinUtilization",
    "all bot turns",
    metrics.opportunities.elementalCoinUtilization.rate,
    0.6,
    null,
  ),
  targetBand(
    "burnDamageContribution",
    "all bot player damage",
    metrics.damage.burnContribution.rate,
    0.15,
    0.35,
  ),
];

const anomalyBreakdown = (
  anomalies: readonly M6AnomalyFlag[],
  anomalySeedCount: number,
  globalAnomalyCount: number,
): M6BalanceAnomalyBreakdown => {
  const byKind = new Map<M6AnomalyFlag["kind"], number>();
  for (const anomaly of anomalies) {
    byKind.set(anomaly.kind, (byKind.get(anomaly.kind) ?? 0) + 1);
  }
  return {
    occurrenceCount: anomalies.length,
    anomalySeedCount,
    globalAnomalyCount,
    byKind: [...byKind.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([kind, occurrences]) => ({ kind, occurrences })),
  };
};

const warningItems = (
  metrics: ReturnType<typeof foldM6Metrics>,
  gatekeeper: M6GatekeeperConvergenceBreakdown,
  crn: M6CompactCrnEvidence,
): readonly M6Warning[] => {
  const consume = metrics.consumeVsFlip;
  const policy = new Map(
    metrics.policyOutcomes.map((outcome) => [outcome.policyId, outcome]),
  );
  const aggro = policy.get("aggro")?.winRate.rate ?? null;
  const greedy = policy.get("greedy")?.winRate.rate ?? null;
  const hpDelta = crn.paired.meanCarriedHpDeltaBMinusA;
  return [
    {
      id: "consumeVsFlipDominance",
      active:
        consume.consume.uses > consume.flip.uses ||
        consume.consume.directValue > consume.flip.directValue,
      observation: `consume uses/direct=${consume.consume.uses}/${consume.consume.directValue}; flip uses/direct=${consume.flip.uses}/${consume.flip.directValue}`,
      isGate: false,
    },
    {
      id: "gatekeeperSequenceConvergence",
      active: gatekeeper.exactSequenceOccurrences > 0,
      observation: `${gatekeeper.exactSequenceOccurrences} exact sequence convergences across ${gatekeeper.uniqueEpisodes} episodes`,
      isGate: false,
    },
    {
      id: "aggroWinRateGap",
      active: aggro !== null && greedy !== null && aggro < greedy,
      observation: `aggro=${aggro === null ? "null" : aggro}; greedy=${greedy === null ? "null" : greedy}`,
      isGate: false,
    },
    {
      id: "basicFirstEndingHp",
      active: hpDelta !== null && hpDelta < 0,
      observation: `mean carried HP delta basic-first minus fire-first=${hpDelta === null ? "null" : hpDelta}`,
      isGate: false,
    },
  ];
};

const humanQuestions = (): readonly M6HumanQuestion[] => [
  {
    id: "m2M4M5HumanValidation",
    question:
      "M2/M4/M5의 손맛·갈등·런 보상이 실제 플레이에서 의도대로 느껴지는가?",
    status: "pending",
  },
  {
    id: "n5HumanMetrics",
    question: "사람 N≥5 로그에서도 §8.3 지표와 정성 반응이 수용 가능한가?",
    status: "pending",
  },
  {
    id: "consumeVsFlipFeel",
    question: "소비가 플립보다 강제되거나 우월하다고 느껴지는가?",
    status: "pending",
  },
  {
    id: "gatekeeperRepetitionFeel",
    question: "문지기 전투의 반복 행동 시퀀스가 단조롭게 느껴지는가?",
    status: "pending",
  },
  {
    id: "humanTargetBands",
    question:
      "봇 참고 대역이 아니라 사람 로그 기준으로 목표 대역을 확정할 수 있는가?",
    status: "pending",
  },
];

export const buildM6BalanceReport = (
  options: M6BalanceReportOptions = {},
): M6BalanceReport => {
  const config = normalizedOptions(options);
  const bulk = runBulk({
    baseSeed: config.baseSeed,
    games: config.gamesPerPolicy,
    policyIds: POLICY_IDS,
    variantIds: ["baseline"],
    captureTranscripts: true,
  });
  const characterBulk = runBulk({
    baseSeed: config.baseSeed,
    games: config.gamesPerPolicy,
    policyIds: POLICY_IDS,
    variantIds: ["baseline"],
    characterIds: ["guardian", "sorcerer", "frost-knight"],
    captureTranscripts: true,
  });
  const crnReport = runCrnComparison({
    baseSeed: config.baseSeed,
    games: config.crnGames,
    policyId: "greedy",
    variantA: "baseline",
    variantB: "basic-first",
  });
  const crn = compactCrnEvidence(crnReport);
  const guardianCrn = runBulk({
    baseSeed: config.baseSeed,
    games: config.crnGames,
    policyIds: ["greedy"],
    variantIds: ["baseline"],
    characterIds: ["guardian"],
    buildPolicyIds: ["mana-build"],
  });
  // 신규 캐릭터 결정론은 자기 자신의 A=A로 증명한다 — warrior aa 재사용은 거짓 증명 (감시자 반려)
  const frostKnightCrn = runBulkWithAaIdentity({
    baseSeed: config.baseSeed,
    games: config.crnGames,
    policyIds: ["greedy"],
    variantIds: ["baseline"],
    characterIds: ["frost-knight"],
    buildPolicyIds: ["frost-build"],
  });
  const metrics = bulk.report.metrics;
  const gatekeeper = aggregateGatekeeperConvergence(
    bulk.traces,
    metrics.anomalies,
  );
  const characterAa = runBulkWithAaIdentity({
    baseSeed: config.baseSeed,
    games: config.crnGames,
    policyIds: ["greedy"],
    variantIds: ["baseline"],
    buildPolicyIds: ["fire-build"],
  });
  const rewardTranscripts = [...bulk.transcripts, ...characterBulk.transcripts];
  const rewardRows = rewardSelectionRows(rewardTranscripts, true);
  const characterTraces = (characterId: SimCharacterId): readonly M6RunTrace[] =>
    characterBulk.traces.filter((trace) => trace.characterId === characterId);

  return {
    schemaVersion: P3_BALANCE_REPORT_SCHEMA_VERSION,
    configuration: {
      baseSeed: config.baseSeed,
      gamesPerPolicy: config.gamesPerPolicy,
      totalPolicyRuns: config.gamesPerPolicy * POLICY_IDS.length,
      policyIds: POLICY_IDS,
      variantId: "baseline",
      crnGames: config.crnGames,
    },
    tuningDecision: {
      numericContentChange: "none",
      reason:
        "Bot evidence does not identify a directional numeric knob; tuning waits for human evidence.",
    },
    mechanicalFacts: {
      outcomes: metrics.outcomes,
      policyEnemy: aggregatePolicyEnemyRows(bulk.traces),
      policyConsumeVsFlip: aggregatePolicyResolutionRows(bulk.traces),
      gatekeeperConvergence: gatekeeper,
      anomalies: anomalyBreakdown(
        metrics.anomalies,
        bulk.report.anomalySeeds.length,
        bulk.report.globalAnomalies.length,
      ),
      crn,
      policyEnemyCharacter: aggregatePolicyEnemyCharacterRows([
        ...bulk.traces,
        ...characterBulk.traces,
      ]),
      guardianSafety500: guardianSafetyMetrics(characterTraces("guardian")),
      characterSafety500: [
        characterSafetyMetrics(
          "sorcerer",
          "lightning-build",
          characterTraces("sorcerer"),
        ),
        characterSafetyMetrics(
          "frost-knight",
          "frost-build",
          characterTraces("frost-knight"),
        ),
      ],
      rewardSelectionDominance: rewardSelectionReport(rewardTranscripts),
      buildPolicies: buildPolicyRows(),
      rewardSelectionByCharacterBuild: rewardRows,
      rewardSelectionAudit: rewardSelectionAuditRows(rewardRows),
      characterCrn: compactCharacterCrnEvidence(
        config.baseSeed,
        config.crnGames,
        characterAa.aa,
        {
          characterId: "warrior",
          buildPolicyId: "fire-build",
          traces: characterAa.result.traces,
        },
        {
          characterId: "guardian",
          buildPolicyId: "mana-build",
          traces: guardianCrn.traces,
        },
        guardianCrn.report.anomalySeeds.length,
      ),
      frostCharacterCrn: compactCharacterCrnEvidence(
        config.baseSeed,
        config.crnGames,
        frostKnightCrn.aa,
        {
          characterId: "warrior",
          buildPolicyId: "fire-build",
          traces: characterAa.result.traces,
        },
        {
          characterId: "frost-knight",
          buildPolicyId: "frost-build",
          traces: frostKnightCrn.result.traces,
        },
        frostKnightCrn.result.report.anomalySeeds.length,
      ),
    },
    informationalTargetBands: informationalTargetBands(metrics),
    warnings: warningItems(metrics, gatekeeper, crn),
    humanRequiredQuestions: humanQuestions(),
    phase3: {
      conclusionLabels: [
        "engineering-safe",
        "balance-provisional",
        "experience-unverified",
      ],
      overrideReference: "PHASE1_HOLDS.md",
      reason:
        "PHASE1_HOLDS owner override leaves human feel evidence open; automated facts are split into engineering-safe, balance-provisional, and experience-unverified axes.",
    },
  };
};

const cliArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

const cliPositiveInteger = (name: string): number | undefined => {
  const raw = cliArg(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  assertPositiveInteger(value, name);
  return value;
};

const isDirectExecution =
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/tools/sim/src/balance-report.ts") ?? false;

if (isDirectExecution) {
  const report = buildM6BalanceReport({
    baseSeed: cliArg("--seed"),
    gamesPerPolicy: cliPositiveInteger("--games-per-policy"),
    crnGames: cliPositiveInteger("--crn-games"),
  });
  console.log(JSON.stringify(report));
}
