import type { CharacterId, CoinDefId, EventDefId, PassiveId, SkillId } from '../ids';
import type { RunGraph } from './graph';

// v6 (P6 D1~D3): 3막 그래프(acts 메타)·휴식/보물 노드·획득 패시브·스킬 강화.
// v5 저장은 기존 graph를 단일 레거시 막으로 감싸고 신규 필드를 기본값으로 마이그레이션.
export const RUN_SAVE_VERSION = 6 as const;
export const LEGACY_RUN_SAVE_VERSIONS = [1, 2, 3, 4, 5] as const;

export type RunPhase =
  | 'ready'
  | 'choose-node'
  | 'combat'
  | 'rewards'
  | 'shop'
  | 'event'
  | 'rest'
  | 'treasure'
  | 'victory'
  | 'defeat';

export type EquippedSkills = [SkillId, SkillId, SkillId, SkillId, SkillId, SkillId];
export type UpgradedSlots = [boolean, boolean, boolean, boolean, boolean, boolean];

export interface PendingRewards {
  coinOptions: CoinDefId[];
  coinChoiceResolved: boolean;
  // P6 신스펙(D1)에서 제거 단계는 상점 전용으로 회귀 — 필드는 v5 저장 호환을 위해
  // 유지하고 신규 보상은 항상 true로 생성한다.
  coinRemovalResolved: boolean;
  skillOptions: SkillId[];
  skillChoiceResolved: boolean;
  passiveOptions?: PassiveId[];
  passiveChoiceResolved?: boolean;
}

export interface PendingShop {
  coinOptions: CoinDefId[];
  coinPrices: number[];
  skillOptions: SkillId[];
  skillPrices: number[];
  passiveOptions?: PassiveId[];
  passivePrices?: number[];
}

export interface PendingEvent {
  eventId: EventDefId;
}

export interface PendingEventCombat {
  eventId: EventDefId;
}

// 보물: passive-<layer> 스트림으로 결정론 롤 — 풀 소진 시 null(금화만).
export interface PendingTreasure {
  passiveOption: PassiveId | null;
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
  upgradedSlots: UpgradedSlots;
  acquiredPassives: PassiveId[];
  gold: number;
  graph: RunGraph;
  nodeChoices: number[];
  shopRemovals: number;
  shopPurchasedCoins: number;
  shopPurchasedSkills: number;
  shopPurchasedPassives: number;
  eventCombats: number;
  eventCoinGains: number;
  eventCoinLosses: number;
  treasureOpened: number;
  restHeals: number;
  restUpgrades: number;
  combatIndex: number;
  attempt: number;
  phase: RunPhase;
  pendingRewards?: PendingRewards;
  pendingShop?: PendingShop;
  pendingEvent?: PendingEvent;
  pendingEventCombat?: PendingEventCombat;
  pendingTreasure?: PendingTreasure;
}

export interface RunState extends RunSave {}

export interface CreateRunConfig {
  contentVersion: string;
  runSeed: string;
  character: CharacterId;
}
