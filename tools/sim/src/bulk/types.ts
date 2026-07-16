import type { Command, CombatEvent, RngSnapshot } from "@game/core";

import type { M6AnomalyFlag, M6MetricsReport, M6RunTrace } from "../metrics";
import type { PolicyId } from "../policies";

export const M6_BULK_REPORT_SCHEMA_VERSION = "m6-bulk-v1" as const;
export const M6_CRN_REPORT_SCHEMA_VERSION = "m6-crn-v1" as const;
export const M6_TRANSCRIPT_SCHEMA_VERSION = "m6-transcript-v1" as const;
export const SIM_CHARACTER_IDS = [
  "warrior",
  "sorcerer",
  "frost-knight",
  "arcanist",
] as const;
export type SimCharacterId = (typeof SIM_CHARACTER_IDS)[number];

export const M6_VARIANT_IDS = ["baseline", "basic-first"] as const;
export type M6VariantId = (typeof M6_VARIANT_IDS)[number];

export const M6_BUILD_POLICY_IDS = [
  "fire-build",
  "mana-build",
  "frost-build",
  "lightning-build",
] as const;
export type M6BuildPolicyId = (typeof M6_BUILD_POLICY_IDS)[number];

export interface M6VariantConfig {
  readonly id: M6VariantId;
  readonly coinRewardPriority: readonly string[];
}

export interface M6BuildPolicyConfig {
  readonly id: M6BuildPolicyId;
  readonly coinRewardPriority: readonly string[];
  readonly skillRewardPriority: readonly string[];
  readonly replacementPriority: readonly string[];
}

export interface M6OpportunitySnapshot {
  readonly schemaVersion: typeof M6_TRANSCRIPT_SCHEMA_VERSION;
  readonly combatIndex: number;
  readonly turn: number;
  readonly decisionIndex: number;
  readonly legalCommandKeys: readonly string[];
  readonly handCoinUids: readonly number[];
  readonly placedCoinUids: readonly number[];
  readonly consumeOpportunity: boolean;
  readonly multiCoinSkillOpportunity: boolean;
}

export interface M6CommandEventTrace {
  readonly schemaVersion: typeof M6_TRANSCRIPT_SCHEMA_VERSION;
  readonly combatIndex: number;
  readonly turn: number;
  readonly decisionIndex: number;
  readonly commandKey: string;
  readonly command: Command;
  readonly events: readonly CombatEvent[];
}

export interface M6CombatTranscript {
  readonly schemaVersion: typeof M6_TRANSCRIPT_SCHEMA_VERSION;
  readonly combatIndex: number;
  readonly initialRng: {
    readonly flip: RngSnapshot;
    readonly shuffle: RngSnapshot;
    readonly ai: RngSnapshot;
  };
  readonly initialEvents: readonly CombatEvent[];
  readonly opportunities: readonly M6OpportunitySnapshot[];
  readonly commands: readonly M6CommandEventTrace[];
}

export interface M6RewardDecisionTrace {
  readonly schemaVersion: typeof M6_TRANSCRIPT_SCHEMA_VERSION;
  readonly completedCombatIndex: number;
  readonly coinOptions: readonly string[];
  readonly selectedCoin: string | null;
  readonly removedBagIndex: number | null;
  readonly removedCoin: string | null;
  readonly skillOptions: readonly string[];
  readonly selectedSkill: string | null;
  readonly replacedSlot: number | null;
  readonly fallbackCoinOptions: readonly string[];
  readonly selectedFallbackCoin: string | null;
}

export interface M6EpisodeTranscript {
  readonly schemaVersion: typeof M6_TRANSCRIPT_SCHEMA_VERSION;
  readonly traceId: string;
  readonly episodeId: string;
  readonly baseSeed: string;
  readonly runSeed: string;
  readonly episodeIndex: number;
  readonly policyId: PolicyId;
  readonly variantId: M6VariantId;
  readonly characterId?: SimCharacterId;
  readonly buildPolicyId?: M6BuildPolicyId;
  readonly combats: readonly M6CombatTranscript[];
  readonly rewards: readonly M6RewardDecisionTrace[];
}

export interface M6EpisodeFingerprint {
  readonly episodeIndex: number;
  readonly episodeId: string;
  readonly runSeed: string;
  readonly traceId: string;
  readonly result: M6RunTrace["result"];
  readonly fingerprint: string;
  readonly combatStreams: readonly {
    readonly flip: RngSnapshot;
    readonly shuffle: RngSnapshot;
    readonly ai: RngSnapshot;
  }[];
  readonly rewardOffers: readonly {
    readonly coinOptions: readonly string[];
    readonly skillOptions: readonly string[];
    readonly fallbackCoinOptions: readonly string[];
  }[];
}

export interface M6AnomalySeed {
  readonly episodeIndex: number;
  readonly episodeId: string;
  readonly runSeed: string;
  readonly traceIds: readonly string[];
  readonly reasons: readonly string[];
}

export interface M6BulkReport {
  readonly schemaVersion: typeof M6_BULK_REPORT_SCHEMA_VERSION;
  readonly baseSeed: string;
  readonly games: number;
  readonly policyIds: readonly PolicyId[];
  readonly variantIds: readonly M6VariantId[];
  readonly metrics: M6MetricsReport;
  readonly anomalySeeds: readonly M6AnomalySeed[];
  readonly globalAnomalies: readonly M6AnomalyFlag[];
  readonly episodes: readonly M6EpisodeFingerprint[];
  readonly tracesIncluded: false;
}

export interface M6BulkResult {
  readonly report: M6BulkReport;
  readonly traces: readonly M6RunTrace[];
  readonly transcripts: readonly M6EpisodeTranscript[];
}

export interface M6BulkOptions {
  readonly baseSeed: string;
  readonly games: number;
  readonly policyIds: readonly PolicyId[];
  readonly variantIds?: readonly M6VariantId[];
  readonly characterIds?: readonly SimCharacterId[];
  readonly buildPolicyIds?: readonly M6BuildPolicyId[];
  /** Raw command/event transcripts are opt-in for large CLI matrices. */
  readonly captureTranscripts?: boolean;
}

export interface M6AaIdentityProof {
  readonly identical: true;
  readonly byteLength: number;
  readonly fingerprint: string;
}

export interface M6CrnPairedOutcome {
  readonly pairs: number;
  readonly sameResult: number;
  readonly aOnlyWins: number;
  readonly bOnlyWins: number;
  readonly bothWin: number;
  readonly bothDefeat: number;
  readonly nonterminalPairs: number;
  readonly meanCarriedHpDeltaBMinusA: number | null;
  readonly meanCompletedCombatDeltaBMinusA: number | null;
}

export interface M6CrnReport {
  readonly schemaVersion: typeof M6_CRN_REPORT_SCHEMA_VERSION;
  readonly baseSeed: string;
  readonly games: number;
  readonly policyId: PolicyId;
  readonly variantA: M6VariantId;
  readonly variantB: M6VariantId;
  readonly aa: M6AaIdentityProof;
  readonly paired: M6CrnPairedOutcome;
  readonly a: M6BulkReport;
  readonly b: M6BulkReport;
  readonly anomalySeeds: readonly M6AnomalySeed[];
}
