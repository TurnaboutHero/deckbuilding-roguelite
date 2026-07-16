import type { CharacterId, CoinDefId, EventDefId, PassiveId, SkillId } from '../ids';
import type { RunGraph } from './graph';

// v7 (P7 D2): 장착 슬롯 6→8 일반화, 빈 슬롯 null, 시작 4스킬.
// v6 저장은 equippedSkills/upgradedSlots를 null/false로 8까지 패딩.
// v6 (P6 D1~D3): 3막 그래프(acts 메타)·휴식/보물 노드·획득 패시브·스킬 강화.
// v9 (P13 W5c): guardian saves are retired instead of loaded.
// v8 (P12): persist the Blood Spellblade's run-long Blood Sword investment.
export const RUN_SAVE_VERSION = 9 as const;
export const LEGACY_RUN_SAVE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// P7 D2 — 기본 최대 장착 슬롯 (10 확장은 이 상수 + 세이브 버전 승격 경로만).
// 단일 정본은 combat/state의 MAX_SKILL_SLOTS — 런 계층 별칭만 제공한다.
export { MAX_SKILL_SLOTS as MAX_EQUIPPED_SKILLS } from '../combat/state';

export type RunPhase = 'ready' | 'choose-node' | 'combat' | 'rewards' | 'shop' | 'event' | 'rest' | 'treasure' | 'victory' | 'defeat';

// P7 D2 — 길이 MAX_EQUIPPED_SKILLS 고정, null = 빈 슬롯
export type EquippedSkills = (SkillId | null)[];
export type UpgradedSlots = boolean[];

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
  /** Run-long Blood Sword investment. Present only for the Blood Spellblade. */
  bloodSwordInvestment?: number;
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
