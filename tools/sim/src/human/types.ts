import type { CombatEvent, CombatState, Command } from "@game/core";

export type RunResult = "in-progress" | "victory" | "defeat";
export type RewardStage = "coin" | "removal" | "fallback-coin" | "skill";
export type RewardResolution = "selected" | "skipped" | "declined";

export type TelemetryCommand =
  | { type: "placeCoin"; coin: number; slot: number }
  | { type: "unplaceCoin"; coin: number }
  | { type: "useFlipSkill"; slot: number; target?: number }
  | { type: "useConsumeSkill"; slot: number; coins: number[]; target?: number }
  | { type: "endTurn" };

export interface HumanDamageFact {
  target: "player" | "enemy";
  enemyIndex?: number;
  amount: number;
  blocked: number;
  source: "skill" | "burn" | "enemy" | "self";
}

export interface HumanDecisionFact {
  turn: number;
  commands: TelemetryCommand[];
  skills: Array<{ slot: number; skill: string; kind: "flip" | "consume" }>;
  flips: Array<{ coin: number; face: "heads" | "tails" }>;
  damage: HumanDamageFact[];
  hp: {
    playerBefore: number;
    playerAfter: number;
    enemiesBefore: number[];
    enemiesAfter: number[];
  };
}

export interface HumanCombatTrace {
  combatIndex: number;
  attempt: number;
  enemyIds: string[];
  startingHp: number;
  maxHp: number;
  decisions: HumanDecisionFact[];
  outcome?: {
    result: "victory" | "defeat";
    turns: number;
    playerHp: number;
    enemyHp: number[];
  };
}

export interface HumanRewardFact {
  combatIndex: number;
  stage: RewardStage;
  options: string[];
  choice: string | null;
  resolution: RewardResolution;
  bagIndex?: number;
  replacedSlot?: number;
}

export interface HumanRunTraceLike {
  schemaVersion: 1;
  source: "human";
  runSeed: string;
  contentVersion: string;
  buildId: string;
  startedAtLocal: string;
  maxHp: number;
  combats: HumanCombatTrace[];
  rewards: HumanRewardFact[];
  result: RunResult;
  endedAtLocal?: string;
  finalHp?: number;
}

export interface ReplayedDecision {
  combatIndex: number;
  enemyIds: string[];
  decision: HumanDecisionFact;
  before: CombatState;
  after: CombatState;
  events: CombatEvent[];
  commands: Command[];
}

export interface VerifiedHumanRun {
  filename?: string;
  trace: HumanRunTraceLike;
  decisions: ReplayedDecision[];
  combats: Array<{
    combatIndex: number;
    enemyIds: string[];
    turns: number;
    result: "victory" | "defeat";
    playerHp: number;
  }>;
}

export interface RatioMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface RewardStageSummary {
  selected: number;
  skipped: number;
  declined: number;
  chosen: Record<string, number>;
}

export interface HumanReport {
  schemaVersion: "human-report-v1";
  note: "이 리포트는 지표 계산 도구이며 게이트 판정을 대신하지 않는다";
  generatedFrom: {
    contentVersion: string;
    runCount: number;
    rejectedCount: number;
  };
  aggregate: {
    runs: number;
    victories: number;
    defeats: number;
    finalHpAverage: number | null;
    combatsCompletedAverage: number | null;
    averageTurns: number | null;
    averageTurnsByEnemy: Record<string, number>;
    skillsPerTurn: RatioMetric;
    coinWasteRate: RatioMetric;
    fireCoinUtilization: RatioMetric;
    consumeUsage: RatioMetric;
    multiCoinSkillUsage: RatioMetric;
    invalidActionTagsComputableSubset: {
      fullySurplusBlockTurns: RatioMetric;
      zeroTickBurnApplications: RatioMetric;
      omitted: string[];
    };
    rewards: Record<RewardStage, RewardStageSummary>;
  };
  runs: Array<{
    filename?: string;
    runSeed: string;
    result: RunResult;
    finalHp: number | null;
    combatsCompleted: number;
    averageTurns: number | null;
    averageTurnsByEnemy: Record<string, number>;
    skillsPerTurn: RatioMetric;
    coinWasteRate: RatioMetric;
    fireCoinUtilization: RatioMetric;
    consumeUsage: RatioMetric;
    multiCoinSkillUsage: RatioMetric;
    invalidActionTagsComputableSubset: {
      fullySurplusBlockTurns: RatioMetric;
      zeroTickBurnApplications: RatioMetric;
    };
    rewards: Record<RewardStage, RewardStageSummary>;
  }>;
  rejected: Array<{ filename: string; reason: string }>;
}
