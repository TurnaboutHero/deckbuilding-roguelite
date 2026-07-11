import type { CharacterId, CoinDefId, SkillId } from '../ids';

// v2 (2026-07-11, P3.2): 캐릭터 선택·exclusiveTo 인지 검증 시대 표시 — 형태 변경은 없고
// 증거 계약 §2에 따라 검증 규칙 변경(전용 풀 경계)을 버전으로 명시한다. v1은 명시적
// 마이그레이션으로 로드하며(전부 warrior 시대 저장), 미지의 미래 버전은 거부한다.
export const RUN_SAVE_VERSION = 2 as const;
export const LEGACY_RUN_SAVE_VERSIONS = [1] as const;

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
