export const M6_TRACE_SCHEMA_VERSION = "m6-trace-v1" as const;
export const M6_METRICS_REPORT_SCHEMA_VERSION = "m6-metrics-v1" as const;

export type M6RunResult = "victory" | "defeat" | "nonterminal" | "crash";
export type M6CombatResult = "victory" | "defeat" | "nonterminal";
export type M6SkillResolutionKind = "flip" | "consume";

/**
 * Mechanical output attributable to a single resolved skill command.
 * Burn stacks are kept on a separate axis because stacks are not damage until
 * they tick. The report's direct-value total is damage + block only.
 */
export interface M6DecisionValueContribution {
  readonly directDamage: number;
  readonly blockGained: number;
  readonly burnStacksApplied: number;
}

export interface M6SkillDecisionTrace {
  readonly skillId: string;
  readonly resolution: M6SkillResolutionKind;
  readonly coinCount: number;
  readonly valueContribution: M6DecisionValueContribution;
}

/** A post-command fact record. It must not contain mutable combat state. */
export interface M6DecisionTrace {
  readonly schemaVersion: typeof M6_TRACE_SCHEMA_VERSION;
  readonly decisionIndex: number;
  readonly turn: number;
  readonly commandKey: string;
  readonly commandType: string;
  readonly skill: M6SkillDecisionTrace | null;
}

/**
 * A public turn snapshot captured while the opportunity is observable.
 * Opportunity booleans must be computed from legal commands/public state by
 * the trace producer, never reconstructed by this fold.
 */
export interface M6TurnTrace {
  readonly schemaVersion: typeof M6_TRACE_SCHEMA_VERSION;
  readonly turn: number;
  readonly drawnCoinCount: number;
  readonly unusedCoinCount: number;
  readonly elementalCoinsSeen: number;
  readonly elementalCoinsFlippedHeads: number;
  readonly elementalCoinsConsumed: number;
  readonly consumeOpportunity: boolean;
  readonly multiCoinSkillOpportunity: boolean;
  readonly playerDamageDealt: number;
  readonly enemyDamageDealt: number;
  readonly burnDamageDealt: number;
  readonly decisions: readonly M6DecisionTrace[];
}

export interface M6CombatTrace {
  readonly schemaVersion: typeof M6_TRACE_SCHEMA_VERSION;
  readonly combatIndex: number;
  readonly enemyIds: readonly string[];
  readonly startingPlayerHp: number;
  readonly endingPlayerHp: number;
  readonly result: M6CombatResult;
  readonly invariantViolations: readonly string[];
  readonly turns: readonly M6TurnTrace[];
}

export interface M6CrashTrace {
  readonly code: string;
}

/**
 * Fully serializable input to the M6 fold. `episodeId` is shared by paired
 * policy/variant episodes; `traceId` is unique within one fold invocation.
 */
export interface M6RunTrace {
  readonly schemaVersion: typeof M6_TRACE_SCHEMA_VERSION;
  readonly traceId: string;
  readonly episodeId: string;
  readonly episodeIndex: number;
  readonly baseSeed: string;
  readonly runSeed: string;
  readonly contentVersion: string;
  readonly variantId: string;
  readonly policyId: string;
  readonly characterId?: string;
  readonly buildPolicyId?: string;
  readonly expectedCombatCount: number;
  readonly result: M6RunResult;
  readonly crash: M6CrashTrace | null;
  readonly invariantViolations: readonly string[];
  readonly combats: readonly M6CombatTrace[];
}

export interface M6Ratio {
  readonly numerator: number;
  readonly denominator: number;
  /** `null` means the denominator was zero; it never means zero percent. */
  readonly rate: number | null;
}

export interface M6Distribution {
  readonly count: number;
  readonly mean: number | null;
  readonly p50: number | null;
  readonly p99: number | null;
  readonly max: number | null;
}

export interface M6OutcomeMetrics {
  readonly runs: number;
  readonly terminalRuns: number;
  readonly nonterminalRuns: number;
  readonly crashRuns: number;
  readonly invariantViolationRuns: number;
  readonly invariantViolationCount: number;
  readonly wins: number;
  readonly defeats: number;
  readonly winRate: M6Ratio;
  readonly runCompletionRate: M6Ratio;
  readonly completedCombats: number;
  readonly expectedCombats: number;
  readonly combatCompletionRate: M6Ratio;
}

export interface M6EnemyTurnMetrics {
  readonly enemyId: string;
  readonly turns: M6Distribution;
}

export interface M6TurnMetrics {
  readonly overall: M6Distribution;
  readonly perEnemy: readonly M6EnemyTurnMetrics[];
}

export interface M6DamageMetrics {
  /** Per-player-turn damage to enemies, including burn ticks. */
  readonly player: M6Distribution;
  /** Per-player-turn HP damage dealt by enemies after block. */
  readonly enemy: M6Distribution;
  readonly burnContribution: M6Ratio;
}

export interface M6OpportunityMetric {
  readonly opportunityTurns: number;
  readonly useTurns: number;
  readonly uses: number;
  readonly useTurnRate: M6Ratio;
}

export interface M6OpportunityMetrics {
  readonly elementalCoinUtilization: M6Ratio;
  readonly consume: M6OpportunityMetric;
  readonly multiCoinSkill: M6OpportunityMetric;
}

export interface M6ResolutionValueMetrics {
  readonly uses: number;
  readonly directDamage: number;
  readonly blockGained: number;
  readonly burnStacksApplied: number;
  readonly directValue: number;
}

export interface M6ConsumeVsFlipMetrics {
  readonly flip: M6ResolutionValueMetrics;
  readonly consume: M6ResolutionValueMetrics;
  readonly consumeUseShare: M6Ratio;
  readonly consumeDirectValueShare: M6Ratio;
}

export interface M6PolicyOutcome {
  readonly variantId: string;
  readonly policyId: string;
  readonly runs: number;
  readonly terminalRuns: number;
  readonly wins: number;
  readonly winRate: M6Ratio;
}

export interface M6PolicyWinGap {
  readonly variantId: string;
  readonly leftPolicyId: string;
  readonly rightPolicyId: string;
  /** left win rate minus right win rate; `null` if either has no terminal run. */
  readonly signedGap: number | null;
  readonly absoluteGap: number | null;
}

export type M6AnomalyFlag =
  | {
      readonly kind: "nonterminal";
      readonly traceId: string;
      readonly episodeId: string;
      readonly policyId: string;
      readonly result: M6RunResult;
    }
  | {
      readonly kind: "invariantFailure";
      readonly traceId: string;
      readonly episodeId: string;
      readonly policyId: string;
      readonly violationCount: number;
    }
  | {
      readonly kind: "extremeTurnCount";
      readonly traceId: string;
      readonly combatIndex: number;
      readonly turnCount: number;
      readonly threshold: number;
    }
  | {
      readonly kind: "extremeDamage";
      readonly traceId: string;
      readonly combatIndex: number;
      readonly turn: number;
      readonly playerDamage: number;
      readonly enemyDamage: number;
      readonly threshold: number;
    }
  | {
      readonly kind: "gatekeeperPolicySequenceConvergence";
      readonly episodeId: string;
      readonly variantId: string;
      readonly combatIndex: number;
      readonly enemyIds: readonly string[];
      readonly policyIds: readonly string[];
      readonly commandSequence: readonly string[];
    }
  | {
      readonly kind: "consumeDominanceWarning";
      readonly consumeUses: number;
      readonly totalSkillUses: number;
      readonly consumeUseShare: number;
      readonly consumeDirectValueShare: number | null;
      readonly useShareThreshold: number;
      readonly directValueShareThreshold: number;
    };

export interface M6InterpretationItem {
  readonly id: string;
  readonly status: "informational" | "humanRequired";
  readonly reason: string;
}

export interface M6MetricsMetadata {
  readonly percentileMethod: "nearest-rank";
  readonly zeroDenominator: "null";
  readonly anomalyFlagsAreCiGates: false;
  readonly informational: readonly M6InterpretationItem[];
  readonly humanRequired: readonly M6InterpretationItem[];
}

export interface M6MetricsReport {
  readonly schemaVersion: typeof M6_METRICS_REPORT_SCHEMA_VERSION;
  readonly traceSchemaVersion: typeof M6_TRACE_SCHEMA_VERSION;
  readonly outcomes: M6OutcomeMetrics;
  readonly turns: M6TurnMetrics;
  readonly skillsPerTurn: M6Distribution;
  readonly unusedCoinRate: M6Ratio;
  readonly damage: M6DamageMetrics;
  readonly hpLossPerCombat: M6Distribution;
  readonly opportunities: M6OpportunityMetrics;
  readonly consumeVsFlip: M6ConsumeVsFlipMetrics;
  readonly policyOutcomes: readonly M6PolicyOutcome[];
  readonly policyWinGaps: readonly M6PolicyWinGap[];
  readonly anomalyThresholds: M6AnomalyThresholds;
  readonly anomalies: readonly M6AnomalyFlag[];
  readonly metadata: M6MetricsMetadata;
}

export interface M6AnomalyThresholds {
  readonly extremeTurnCount: number;
  readonly extremeDamagePerTurn: number;
  readonly consumeDominanceUseShare: number;
  readonly consumeDominanceDirectValueShare: number;
  readonly consumeDominanceMinimumUses: number;
  readonly gatekeeperEnemyIds: readonly string[];
}
