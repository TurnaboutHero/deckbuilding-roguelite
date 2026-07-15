import type { CombatEvent, CombatState, Command } from "@game/core";

export type RunResult = "in-progress" | "victory" | "defeat";
export type RewardStage = "coin" | "removal" | "fallback-coin" | "skill";
export type RewardResolution = "selected" | "skipped" | "declined";

export type TelemetryCommand =
  | { type: "placeCoin"; coin: number; slot: number }
  | { type: "unplaceCoin"; coin: number }
  | {
      type: "useFlipSkill";
      slot: number;
      target?: number;
      chosen?: number[];
      desiredCoin?: string;
      chosenEquipment?: string;
      chosenSummon?: number;
    }
  | {
      type: "useConsumeSkill";
      slot: number;
      coins: number[];
      target?: number;
      desiredCoin?: string;
      chosenSummon?: number;
    }
  | { type: "endTurn"; preserve?: number[] };

export interface HumanDamageFact {
  target: "player" | "enemy";
  enemyIndex?: number;
  amount: number;
  blocked: number;
  source: "skill" | "burn" | "enemy" | "self";
}

export interface HumanDecisionFact {
  turn: number;
  source?: "manual" | "auto-turn-end";
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

// P6 스키마 v3 (가산): v2 필수 사실 불변 + rest/treasure/passive-reward 경로 사실과
// buy-passive 상점 행동을 추가. v1 거부 유지. v2 로그는 rest/treasure가 없는 레거시
// 그래프에서만 재생 가능하므로 그대로 수용한다 (새 그래프에서는 사실 부재 = mismatch).
export const HUMAN_RUN_SCHEMA_VERSION = 3 as const;
export type HumanRunSchemaVersion = 2 | typeof HUMAN_RUN_SCHEMA_VERSION;

export type HumanShopActionFact =
  | { kind: "buy-coin"; option: number }
  | { kind: "buy-skill"; option: number; slot: number }
  | { kind: "remove-coin"; bagIndex: number }
  // v3: 상점 패시브 구매 (P6 D2)
  | { kind: "buy-passive"; option: number }
  | { kind: "leave" };

export type HumanPathFact =
  | { layer: number; type: "choose-node"; choice: number }
  | { layer: number; type: "shop"; actions: HumanShopActionFact[] }
  | { layer: number; type: "event"; action: "accept" | "decline"; choice?: number }
  // v3 가산 사실 (P6 D1/D2) — layer는 사실 기록 시점의 run.combatIndex:
  // rest/treasure는 해당 노드 레이어, passive-reward는 보상 정산 후 진입할 다음 레이어.
  | { layer: number; type: "rest"; choice: "heal" | "upgrade"; slot?: number }
  | { layer: number; type: "treasure"; passiveId: string | null }
  | { layer: number; type: "passive-reward"; passiveId: string | null };

export interface HumanRunTraceLike {
  schemaVersion: HumanRunSchemaVersion;
  source: "human";
  runSeed: string;
  contentVersion: string;
  buildId: string;
  startedAtLocal: string;
  maxHp: number;
  combats: HumanCombatTrace[];
  rewards: HumanRewardFact[];
  path: HumanPathFact[];
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
