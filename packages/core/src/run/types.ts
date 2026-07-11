import type { CharacterId, CoinDefId, SkillId } from '../ids';
import type { RunGraph } from './graph';

// v3 (2026-07-12, P4.1): combatIndex 이름은 저장 churn 최소화를 위해 유지하지만,
// 의미는 선형 전투 번호에서 "현재 런 그래프 레이어 인덱스"로 일반화한다.
export const RUN_SAVE_VERSION = 3 as const;
export const LEGACY_RUN_SAVE_VERSIONS = [1, 2] as const;

export type RunPhase = 'ready' | 'combat' | 'rewards' | 'victory' | 'defeat';

export type EquippedSkills = [SkillId, SkillId, SkillId, SkillId, SkillId, SkillId];

export interface PendingRewards {
  coinOptions: CoinDefId[];
  coinChoiceResolved: boolean;
  coinRemovalResolved: boolean;
  skillOptions: SkillId[];
  skillChoiceResolved: boolean;
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
  combatIndex: number;
  attempt: number;
  phase: RunPhase;
  pendingRewards?: PendingRewards;
}

export interface RunState extends RunSave {}

export interface CreateRunConfig {
  contentVersion: string;
  runSeed: string;
  character: CharacterId;
}
