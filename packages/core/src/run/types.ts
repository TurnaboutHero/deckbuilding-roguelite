import type { CharacterId, CoinDefId, SkillId } from '../ids';
import type { RunGraph } from './graph';

// v4 (2026-07-12, P4.3): combatIndex 이름은 저장 churn 최소화를 위해 유지하지만,
// 의미는 선형 전투 번호에서 "현재 런 그래프 레이어 인덱스"로 일반화한다.
export const RUN_SAVE_VERSION = 4 as const;
export const LEGACY_RUN_SAVE_VERSIONS = [1, 2, 3] as const;

export type RunPhase =
  | 'ready'
  | 'choose-node'
  | 'combat'
  | 'rewards'
  | 'shop'
  | 'victory'
  | 'defeat';

export type EquippedSkills = [SkillId, SkillId, SkillId, SkillId, SkillId, SkillId];

export interface PendingRewards {
  coinOptions: CoinDefId[];
  coinChoiceResolved: boolean;
  coinRemovalResolved: boolean;
  skillOptions: SkillId[];
  skillChoiceResolved: boolean;
}

export interface PendingShop {
  coinOptions: CoinDefId[];
  coinPrices: number[];
  skillOptions: SkillId[];
  skillPrices: number[];
}

export interface RunSave {
  version: typeof RUN_SAVE_VERSION;
  contentVersion: string;
  runSeed: string;
  character: CharacterId;
  currentHp: number;
  maxHp: number;
  bag: CoinDefId[];
  equippedSkills: EquippedSkills;
  gold: number;
  graph: RunGraph;
  nodeChoices: number[];
  shopRemovals: number;
  shopPurchasedCoins: number;
  shopPurchasedSkills: number;
  combatIndex: number;
  attempt: number;
  phase: RunPhase;
  pendingRewards?: PendingRewards;
  pendingShop?: PendingShop;
}

export interface RunState extends RunSave {}

export interface CreateRunConfig {
  contentVersion: string;
  runSeed: string;
  character: CharacterId;
}
