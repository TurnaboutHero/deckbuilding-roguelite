import type {
  CharacterId,
  CoinDefId,
  CoinEnchantId,
  PassiveId,
  EquipmentDefId,
  CoinUid,
  PermanentCoinUid,
  Element,
  EventDefId,
  EnemyDefId,
  Face,
  SkillId
} from './ids';

// P13 Batch B adds persistent poison stacks and a player-only healing lock.
export const STACK_STATUS_IDS = ['burn', 'poison', 'bleed'] as const;
// `frostbite` remains accepted for existing saves/content; `frost` is the
// v4.5 authored name and has the same duration semantics.
export const DURATION_STATUS_IDS = ['frostbite', 'frost', 'shock', 'healLock'] as const;
export type StatusId = (typeof STACK_STATUS_IDS)[number] | (typeof DURATION_STATUS_IDS)[number];

export const isStackStatus = (status: StatusId): status is (typeof STACK_STATUS_IDS)[number] =>
  (STACK_STATUS_IDS as readonly StatusId[]).includes(status);

export type TargetRef = { type: 'player' } | { type: 'enemy'; index: number };

// P7 D4 — 양면 속성 코인: 모든 속성 코인이 앞뒤 고유 효과를 가진다.
// 소비(플립 없음)는 어느 면 proc도 발동하지 않는다 (resolveFlip 전용).
export interface CoinDef {
  id: CoinDefId;
  element: Element | null;
  procs?: { heads?: EffectAtom[]; tails?: EffectAtom[] };
  /** Combat-only false coin; never appears in permanent reward or shop pools. */
  counterfeit?: true;
}

export const COIN_ENCHANT_IDS = [
  'sharpness',
  'heads-polish',
  'tails-polish',
  'echo',
  'pendulum'
] as const;

export type CoinEnchantMechanic = (typeof COIN_ENCHANT_IDS)[number];

export const isCoinEnchantId = (value: unknown): value is CoinEnchantId =>
  typeof value === 'string' && (COIN_ENCHANT_IDS as readonly string[]).includes(value);

export interface CoinEnchantDef {
  id: CoinEnchantId;
  name: string;
  description: string;
  mechanic: CoinEnchantMechanic;
}

interface CoinInstanceBase {
  uid: CoinUid;
  defId: CoinDefId;
  grants: Element[];
  // P11 — 보존 동전은 턴 정리에서 제외되며 실제 사용/소비 시 해제된다.
  preserved?: boolean;
  /** Combat-only false coin. It has no face, element, value, enchant, or custody eligibility. */
  counterfeit?: boolean;
  /** Combat-only degradation. Runtime only applies it to temporary instances. */
  lead?: true;
  leadSourceEnemyUid?: number;
}

export interface PermanentCoinInstance extends CoinInstanceBase {
  permanent: true;
  permanentUid: PermanentCoinUid;
  readonly enchant?: CoinEnchantId;
  /** Battle-local latch for Pendulum or Echo. Never persisted to the run save. */
  enchantUsed?: boolean;
}

export interface TemporaryCoinInstance extends CoinInstanceBase {
  permanent: false;
  permanentUid?: never;
  enchant?: never;
  enchantUsed?: never;
}

export type CoinInstance = PermanentCoinInstance | TemporaryCoinInstance;

// P6 D3 — 스킬 강화: 스킬당 정의 1종, 런당 1회 (휴식 노드에서 적용).
// patch는 선언적 — deriveUpgradedSkill이 순수 적용. 요구 5종 그대로.
export type SkillUpgradePatch =
  | { kind: 'multi'; patches: SkillUpgradePatch[] }
  | { kind: 'baseAmount'; index: number; delta: number }
  | { kind: 'ladderAmount'; tier: number; index: number; field?: 'amount' | 'stacks'; delta: number }
  | { kind: 'addFaceEffect'; face: 'heads' | 'tails'; effect: EffectAtom }
  | { kind: 'addMixedFaceEffect'; effect: EffectAtom }
  | { kind: 'setFaceMode'; face: 'heads' | 'tails'; mode: 'any' | 'per' }
  | { kind: 'replaceEffect'; section: 'base' | 'heads' | 'tails' | 'overheat' | 'onRepeatFinish'; index: number; effect: EffectAtom }
  | { kind: 'setRemiseLightningCount'; count: number }
  | { kind: 'addCoinOnUse'; coin: CoinDefId; zone: 'draw' | 'discard' | 'hand'; count: number }
  | { kind: 'costDelta'; delta: number }
  | { kind: 'removeOncePerCombat'; cooldown?: 1 | 2 | 3 | 4; costDelta?: number };

export interface SkillUpgradeDef {
  name: string;
  description: string;
  patch: SkillUpgradePatch;
}

// P6 D2 — 획득 패시브 (시작 고유 특성 trait와 데이터·표시 모두 구분).
// 중복 획득 불가, 출처: 보물(부여)/보스(3중1택)/상점(구매).
export interface PassiveDef {
  id: PassiveId;
  name: string;
  description: string;
  exclusiveTo?: CharacterId;
  element: Element | null;
  hook: 'combatStart' | 'turnStart';
  effects: EffectAtom[];
  /** Retained for save compatibility but omitted from new reward/shop offers. */
  retiredFromRewards?: boolean;
  mechanic?:
    | 'continuousMotion'
    | 'retrievalHabit'
    | 'balanceSense'
    | 'lastMove'
    | 'residualCharge'
    | 'overcurrent'
    | 'dischargeSuppression'
    | 'shieldMastery'
    | 'preparedStance'
    | 'indomitableSpirit'
    | 'combatBreathing'
    | 'ignitionInstinct'
    | 'emberBlade'
    | 'hotBarrier'
    | 'residualHeat'
    | 'previewDeployment'
    | 'inverseGuard'
    | 'crossCalculation'
    | 'residualRebuild'
    | 'commandPreservation'
    | 'manaMembrane'
    | 'blueCircuit'
    | 'armamentResonance'
    | 'coinAppraiser'
    | 'smallChangeInsurance'
    | 'doubleEntry'
    | 'maturedHand'
    | 'profitSettlement'
    | 'coldHands'
    | 'frostCompound'
    | 'refrozenLoot'
    | 'concentratedBlood'
    | 'bloodSwordDividend'
    | 'redReflux';
  price: number;
}

export interface SkillDefBase {
  id: SkillId;
  name: string;
  rarity: 'common' | 'advanced' | 'rare';
  tags: readonly ('attack' | 'defense' | 'utility' | 'ultimate')[];
  targetType: 'single-enemy' | 'all-enemies' | 'self' | 'none';
  /** The skill's authored element. Coin requirements remain a separate rule. */
  element?: Element;
  // P7/P9 — 스킬별 쿨다운: 0=반복(같은 턴 무제한), 1~4=사용 후 N-1턴 봉인.
  // 미지정 기본값 1(기존 턴당 1회 케이던스). oncePerCombat 중에는 전투당 1회
  // 잠금이 우선하며, 명시 쿨다운은 일회성 제거 강화의 복귀 주기를 문서화할 수 있다.
  cooldown?: 0 | 1 | 2 | 3 | 4;
  oncePerCombat?: boolean;
  /** Keeps a zero-cooldown flip skill to one reservation during planning. */
  nonRepeatable?: boolean;
  // P7 D5 — 과열 강화 분기: 해결 시 과열이면 기본 효과 뒤에 추가, 해결 후 과열 소비.
  overheatBonus?: EffectAtom[];
  upgrade?: SkillUpgradeDef;
  // P11 — 보존 동전으로 해결했을 때만 추가되는 효과. 기본 동전의 냉기 취급은
  // 해당 스킬 판정에만 적용되며 소비 비용에는 절대 사용되지 않는다.
  preservedBonus?: EffectAtom[];
  treatPreservedBasicAsElement?: Element;
  // Blood Spellblade contracts. `bloodSword` marks techniques that scale from
  // the run-long weapon investment; `bloodOffering` changes its effect at the
  // final stage without replacing the stable skill id in saves.
  bloodSword?: boolean;
  bloodOffering?: boolean;
  /** Retained for save compatibility but omitted from new reward/shop offers. */
  retiredFromRewards?: boolean;
  // 캐릭터 전용 스킬 — 공용 보상 풀에서 제외되고 해당 캐릭터 런에서만 노출된다.
  // 숨김 프로퍼티 같은 암묵 경계 대신 명시적 데이터로 풀 경계를 표현한다 (P3.2 결정).
  exclusiveTo?: CharacterId;
}

export interface FlipSkillDef extends SkillDefBase {
  type: 'flip';
  cost: number;
  // 일부 플립형 스킬은 지정 속성 동전만 장전할 수 있다. 소비가 아니므로 면과 proc은 정상 판정한다.
  requiredElement?: Element;
  requiredCoin?: CoinDefId;
  /** Legacy base effects. Required for legacy flip skills and absent on success-ladder skills. */
  base?: EffectAtom[];
  heads?: { mode: 'any' | 'per'; effects: EffectAtom[] };
  tails?: { mode: 'any' | 'per'; effects: EffectAtom[] };
  mixed?: { effects: EffectAtom[] };
  // P7 D5 — 특정 속성 코인 면 보너스 (일반 면 보너스와 합산, 항상 per 면당)
  elementFaces?: { element: Element; face: Face; effects: EffectAtom[] }[];
  /** v1.2 flip model: resolve exactly one tier by the number of successful faces. */
  successFace?: Face;
  successLadder?: EffectAtom[][];
  /** Applied once after coin face procs when a matching coin succeeds. */
  resonance?: { element: Element; effects: EffectAtom[] };
  remise?: {
    onRepeatFinish?: EffectAtom[];
    /** @deprecated P13 Wave 3 stack remise ignores the old reflip model. */
    reuseOnReflipTails?: boolean;
    /** @deprecated P13 Wave 3 stack remise ignores the old reflip model. */
    returnFirstCoinOnReuse?: boolean;
    /** @deprecated P13 Wave 3 stack remise ignores the old reflip model. */
    addLightningToHandAfterReuse?: number;
  };
  returnUsedElementToDrawTop?: {
    element: Element;
    count: number;
    minimumUsed?: number;
  };
}

export const declaresSuccessLadder = (skill: FlipSkillDef): boolean =>
  skill.successFace !== undefined || skill.successLadder !== undefined || skill.resonance !== undefined;

export const isSuccessLadderFlipSkill = (
  skill: FlipSkillDef
): skill is FlipSkillDef & { successFace: Face; successLadder: EffectAtom[][] } =>
  skill.successFace !== undefined && skill.successLadder !== undefined;

/** Base/face-authored effects for choice scans. Shared bonuses stay caller-controlled. */
export const flipSkillEffects = (skill: FlipSkillDef): EffectAtom[] =>
  declaresSuccessLadder(skill)
    ? [...(skill.successLadder ?? []).flat(), ...(skill.resonance?.effects ?? [])]
    : [
        ...(skill.base ?? []),
        ...(skill.heads?.effects ?? []),
        ...(skill.tails?.effects ?? [])
      ];

// P7 D1 — 쿨다운 미지정 기본값 1 (기존 usedThisTurn=턴당 1회와 동일 케이던스).
// 전투당 1회 스킬은 usedThisCombat만으로 잠그며 쿨다운 상태를 만들지 않는다.
// 강화로 oncePerCombat이 제거되면 다시 기본 쿨다운 1을 적용한다.
export const skillCooldown = (skill: SkillDefBase): number => (skill.oncePerCombat === true ? 0 : (skill.cooldown ?? 1));

/** Shared reservation rule for flip skills that may be queued more than once. */
export const isRepeatReservationEligible = (skill: SkillDef): skill is FlipSkillDef =>
  skill.type === 'flip' &&
  skillCooldown(skill) === 0 &&
  skill.oncePerCombat !== true &&
  skill.nonRepeatable !== true;

export interface ConsumeSkillDef extends SkillDefBase {
  type: 'consume';
  consume: { element: Element; count: number; mode?: 'exact' | 'upTo' | 'all' };
  effects: EffectAtom[];
}

export type SkillDef = FlipSkillDef | ConsumeSkillDef;

export interface TurnTriggerDef {
  id: string;
  hook: 'onDamageDealt' | 'onAttackSkillResolved';
  effects: EffectAtom[];
}

export type EffectAtom =
  | { kind: 'damage'; amount: number }
  | { kind: 'coinDamage'; amount: number }
  /** Direct damage that intentionally bypasses block and attack modifiers. */
  | { kind: 'fixedDamage'; amount: number }
  /** Damage only when the selected target currently has the given status. */
  | { kind: 'damageIfTargetStatus'; status: StatusId; amount: number }
  | { kind: 'block'; amount: number }
  /** Block granted at the beginning of the player's next turn. */
  | { kind: 'nextTurnBlock'; amount: number }
  | { kind: 'selfDamage'; amount: number }
  | { kind: 'loseHp'; amount: number }
  | { kind: 'payHp'; amount: number }
  // P7 D4 — 회복 (플레이어 전용, maxHp 상한)
  | { kind: 'heal'; amount: number }
  // P7 D3 — 즉시 드로우 / 다음 턴 드로우 보너스
  | { kind: 'draw'; count: number }
  | { kind: 'drawSpecific'; coins: CoinDefId[]; count: number; preserve?: boolean }
  | { kind: 'returnDiscardCoin'; coin: CoinDefId; count: number }
  | { kind: 'nextTurnDraw'; count: number }
  | { kind: 'preserveChosenCoin'; count: number }
  | { kind: 'increasePreserveCapacity'; count: number }
  // P7 D1 — 쿨다운 감소: 해결 중인 자기 슬롯 제외, 대기 중인 다른 슬롯만
  | { kind: 'reduceCooldown'; amount: number }
  // P7 D5 — 과열 진입 (비중첩, no-op 재진입)
  | { kind: 'enterOverheat' }
  | { kind: 'scheduleOverheat' }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; to: 'target' | 'self' }
  | { kind: 'removeStatus'; status: StatusId; stacks: number; to: 'target' | 'self' }
  | { kind: 'addCoin'; coin: CoinDefId; zone: 'draw' | 'discard' | 'hand'; position?: 'top'; count: number }
  | { kind: 'grantElement'; element: Element; scope: 'allBasicInHand' | 'chooseBasicInHand' }
  | { kind: 'addTurnTrigger'; trigger: TurnTriggerDef }
  // P6 D5 — 화상 수치 참조 폭발 (스택 비소비, 격투가 화상 빌드 마무리)
  | { kind: 'damagePerTargetBurn'; amountPerStack: number }
  | { kind: 'damageByConsumed'; base: number; perCoin: number; frostbittenBonusPerCoin?: number }
  | { kind: 'damageByTargetFrostbite'; base: number; multiplier: number; cap: number }
  | { kind: 'lifesteal'; amount: number }
  | { kind: 'lifestealByConsumed'; amountPerCoin: number }
  | { kind: 'investBloodSword' }
  | { kind: 'bloodOffering' }
  | { kind: 'damageByBloodSword'; base: number; multiplier: number }
  // P6 D6 — 마력 갑주: 현재 방어 참조 피해 (방어 비소모)
  | { kind: 'damagePerBlock'; amountPerBlock: number }
  | { kind: 'blockFromCurrent'; cap: number }
  | { kind: 'damagePlusBlock'; base: number; cap: number }
  | { kind: 'echoPreheat'; amount: number }
  | { kind: 'precisionDefenseArm' }
  | { kind: 'damagePlusEcho'; base: number }
  | { kind: 'aoeDamagePlusEcho'; base: number }
  | { kind: 'prepareNextAttackDamage'; amount: number }
  | { kind: 'scheduleEndTurnBlockAoe'; cap: number }
  // P6 D6 — 소환: equipment 'chosen'은 커맨드의 chosenEquipment(기본: 정렬 첫 장비)
  | { kind: 'summonEquipment'; equipment: EquipmentDefId | 'chosen'; duration: number; durationPerTails?: number }
  // P6 D6 — 명령: 선택 소환 즉시 행동(+뒷면당 효과 보너스), 지속 -1
  | { kind: 'commandChosenSummon'; bonusPerTails: number }
  // P6 D6 — 마나 병기: 아군 소환 전체 강화 (이번 전투 지속)
  | { kind: 'empowerSummons'; amount: number }
  | { kind: 'increaseWeaponOutput'; amount: number }
  | { kind: 'extendAllSummons'; amount: number }
  | { kind: 'extendChosenSummon'; amount: number }
  | { kind: 'grantChosenSummonAoe'; uses: number; usesPerHeads?: number }
  | { kind: 'cloneChosenSummon'; duration: number; fullCapExtension: number }
  | { kind: 'virtualManaSwordVolley'; baseDamage: number; baseCount?: number }
  | { kind: 'doubleTargetShock' }
  | { kind: 'blockPerTargetShock'; base: number; cap: number }
  | { kind: 'executeOrDischargeShock' }
  | { kind: 'damageIfTargetShocked'; amount: number }
  | { kind: 'damageIfReused'; amount: number }
  | { kind: 'readyRemise'; amount?: number };

// P6 D6 — 소환 장비: 플레이어 턴 종료 시 자동 행동, 지속 1 감소, 0이면 소멸.
// 적 공격 대상에서 제외된다 (유닛이 아니라 슬롯 위젯).
export interface EquipmentDef {
  id: EquipmentDefId;
  name: string;
  description: string;
  action: { kind: 'strike'; damage: number } | { kind: 'ward'; block: number };
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  maxHp: number;
  startingBag: CoinDefId[];
  startingSkills: SkillId[];
  trait: {
    id: string;
    name: string;
    hook: 'combatStart' | 'turnStart';
    effects: EffectAtom[];
    mechanic?: 'remise' | 'preserveHand' | 'bloodSword';
  };
}

export type EnemyAction =
  | { kind: 'attack'; damage: number; hits?: number; damagePerGrowthPercent?: number; ordinary?: true }
  | { kind: 'seizeCustody' }
  | { kind: 'sealRecentSkill' }
  | { kind: 'sealTriggeredSkill'; turns: number }
  | { kind: 'resetRepeatSkillPressure' }
  | { kind: 'royalTax'; degradedDamage: number }
  | { kind: 'resetRoyalTaxDefaults' }
  | { kind: 'royalVaultForeclose' }
  | { kind: 'royalVaultExactSeizure'; maxCoins: number; selection: 'handFraction' }
  | { kind: 'royalVaultBarrier'; blockPerStoredCoin: number }
  | { kind: 'leadDecree' }
  | { kind: 'returnOldestRoyalVaultCoin'; reason?: 'phaseEntry' | 'crownCancelled' | 'crownResolved' }
  | { kind: 'clearLeadCoins' }
  | { kind: 'createCounterfeit'; coin: CoinDefId; count: number }
  | { kind: 'removeCounterfeits'; count: number }
  | { kind: 'conditionalAttack'; damage: number; bonusDamage: number; condition: 'playerHpBelowHalf' }
  | { kind: 'block'; amount: number }
  | { kind: 'nextDrawPenalty'; amount: number }
  | {
      kind: 'applyStatus';
      status: StatusId;
      stacks: number;
      requiresLastAttackHpDamage?: boolean;
      requiresPlayerStatus?: { status: StatusId; atLeast: number };
    }
  | { kind: 'heal'; amount: number }
  | { kind: 'buffNextAttack'; amount: number }
  | {
      kind: 'growOnUnblockedDamage';
      amount: number;
      healOnGrow?: number;
      maxStacks?: number;
      minHpDamageFraction?: number;
      loseOnFullBlock?: boolean;
    }
  | { kind: 'healAlly'; amount: number; target: 'lowestHpAlly'; cleanse?: number }
  | { kind: 'summonEnemies'; enemy: EnemyDefId; maxCount: number }
  | { kind: 'tickHatch' }
  | { kind: 'accelerateHatching'; amount: number }
  | { kind: 'setEnemyResource'; resource: 'furnaceTemperature'; value: number; reason: EnemyFurnaceReason }
  | { kind: 'adjustEnemyResource'; resource: 'furnaceTemperature'; amount: number; reason: EnemyFurnaceReason }
  | { kind: 'removePlayerStatus'; status: StatusId; stacks: number }
  | { kind: 'reduceGrowthStacks'; amount: number };

export interface EnemyHatchDef {
  into: EnemyDefId;
  turns: number;
  delayAtHpFraction: number;
}

export interface EnemyProtectionLinkDef {
  target: 'highestThreatAlly';
  redirectFraction: number;
  durability: number;
  restoreDurability: number;
  brokenTurns: number;
  damageTakenMultiplierWhileBroken: number;
}

export interface EnemyPetrifyDef {
  damageReduction: number;
  shatterRawDamageFraction: number;
  crackedTurns: number;
  crackedDamageTakenMultiplier: number;
  cancelWindupIntentId: string;
}

export interface EnemyWarBannerDef {
  attackAuraPercent: number;
  march: { attackPercent: number; turns: number; shieldMaxHpFraction: number };
}

/** Optional bounded boss resource.  It is intentionally owned by the enemy, not an enemy ID. */
export interface EnemyFurnaceDef {
  initialTemperature: number;
  maxTemperature: number;
  actionResolvedGain?: number;
  playerBurnDamageGain?: number;
  playerBurnClearLoss?: number;
  playerDamageThreshold?: { phaseEntryHpFraction: number; loss: number };
  /** Overrides ordinary intent rotation while this bounded resource is at its cap. */
  atMaxIntent?: EnemyIntent;
}

export type EnemyFurnaceReason =
  | 'enemyActionResolved'
  | 'playerBurnDamaged'
  | 'playerBurnCleared'
  | 'playerDamageThreshold'
  | 'phaseEntered'
  | 'coronationCancelled'
  | 'coronationResolved';

export interface EnemyVassalGuardDef {
  /** Only summons from this definition can bind the guard to their source UID. */
  source: EnemyDefId;
  damageReductionPercent: number;
  maxSources: number;
}

export type EnemyCancelPredicate =
  | { kind: 'skillDamage'; threshold: number }
  | { kind: 'enemyResourceAtMost'; resource: 'furnaceTemperature'; value: number }
  | { kind: 'vaultCoinsRecovered'; count: number };

export interface EnemyIntent {
  id: string;
  actions: EnemyAction[];
  windup?: { turns: number; revealAtStart: true };
  cancelOn?: EnemyCancelPredicate | readonly EnemyCancelPredicate[];
  onCancelActions?: EnemyAction[];
  vulnerableWhileWindup?: number;
  growthBranch?: { atLeast: number; intent: EnemyIntent };
  groupMarch?: true;
  entersPetrify?: true;
}

export interface EnemyPhase {
  hpBelowFraction: number;
  intents: EnemyIntent[];
  damageTakenMultiplier?: number;
  /** Opts this phase into cancelling/skipping the previous intent before it can act. */
  transitionBeforeAction?: true;
  onEnterActions?: EnemyAction[];
  /** Bounded stacks applied once after each resolved intent in this phase. */
  growthOnActionResolved?: { amount: number; maxStacks: number };
}

// 몬스터 패시브 — 설계 가이드 §3 패시브 원칙 준용: 자동 조건 발동 최대 1개.
// 의도(intent)로 예고되지 않으므로 자기 대상 원자(heal/block/buffNextAttack)만
// 허용한다 — 플레이어 대상 원자는 "매 턴 의도 공개" 계약(§5 원칙 2)과 충돌.
export interface EnemyPassiveDef {
  id: string;
  name: string;
  description: string;
  hook: 'enemyTurnStart';
  effects: EnemyAction[];
}

export interface PlayerTurnEndPunishmentDef {
  kind: 'unusedElementalCoinsAtLeast';
  threshold: number;
  status: StatusId;
  stacks: number;
}

export interface EnemyRoundGrowthDef {
  gainPerRound: number;
  maxStacks: number;
  damageReductionPerStack: number;
  healMaxHpFractionPerStack: number;
  removeOneAtHpFraction: number;
  removeTwoAtHpFraction: number;
}

/** Data contract for an enemy that telegraphs and then holds hand coins locally. */
export interface EnemyCoinSeizureDef {
  target: 'mostNumerousPublicElementInHand';
  maxCoins: number;
  capFraction: number;
}

/** Data contract for an enemy that seals the player's recently repeated skill. */
export interface EnemySkillSealDef {
  recentPlayerTurns: number;
  turns: number;
  uniqueSkillEffectMultiplier: number;
}

/** Data-driven repeat pressure: resolution hooks observe successful player skill uses. */
export interface EnemyRepeatSkillPressureDef {
  threshold: number;
  maxZeal: number;
  sameSkillGain: number;
  differentSkillReset: number;
  singleUsableZealEveryUses: number;
  sealTurns: number;
  executionIntent: EnemyIntent;
}

/** Data-driven tax demand and its bounded counterfeit/default escalation. */
export interface EnemyRoyalTaxDef {
  denomination: number;
  deadline: 'endNextPlayerTurn';
  counterfeitCoin: CoinDefId;
  counterfeitCount: number;
  defaultShield: number;
  seizureAfterDefaults?: number;
  seizureIntent?: EnemyIntent;
  /** Optional hand-only escalation. Omitted fields preserve the existing M18 contract. */
  foreclosureAfterDefaults?: number;
  foreclosureIntent?: EnemyIntent;
  foreclosureMaxCoins?: number;
  paidNextOrdinaryAttackReduction?: number;
}

/** A source-UID-bound custody vault. It deliberately reuses normal custody semantics. */
export interface EnemyRoyalVaultDef {
  capacity: number;
  blockLostPerRecovery?: number;
  atCapacityIntent?: EnemyIntent;
  lead?: {
    generatedTemporaryElementalCount: number;
    minRemaining: number;
    maxWeakensPerTurn: number;
    maxWeakensPerWindup: number;
    damageWeakeningThreshold?: number;
  };
}

export interface EnemyDef {
  id: EnemyDefId;
  name: string;
  maxHp: number;
  intents: EnemyIntent[];
  phases?: EnemyPhase[];
  growthLabel?: string;
  passive?: EnemyPassiveDef;
  playerTurnEndPunishment?: PlayerTurnEndPunishmentDef;
  roundGrowth?: EnemyRoundGrowthDef;
  coinSeizure?: EnemyCoinSeizureDef;
  skillSeal?: EnemySkillSealDef;
  repeatSkillPressure?: EnemyRepeatSkillPressureDef;
  royalTax?: EnemyRoyalTaxDef;
  royalVault?: EnemyRoyalVaultDef;
  /** Batch C data-driven mechanics. */
  threat?: number;
  protectionLink?: EnemyProtectionLinkDef;
  petrify?: EnemyPetrifyDef;
  warBanner?: EnemyWarBannerDef;
  hatch?: EnemyHatchDef;
  furnace?: EnemyFurnaceDef;
  vassalGuard?: EnemyVassalGuardDef;
}

export type EventRisk = 'combat' | 'hp' | 'gold' | 'coin';

export type EventDef =
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'combat';
      elitePool: EnemyDefId[][];
      goldReward: number;
      rareSkillOptions: number;
    }
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'hp';
      hpCost: number;
      requireCurrentHpAbove: number;
      reward: { kind: 'signatureCoin'; count: number };
    }
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'gold';
      goldCost: number;
      transform: { from: CoinDefId; to: 'signatureCoin' };
    }
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'coin';
      sacrifice: { coin: CoinDefId; reward: 'signatureCoin'; minimumBagSize: number };
    };

export interface ContentDb {
  coins: Record<string, CoinDef>;
  enchants?: Record<string, CoinEnchantDef>;
  skills: Record<string, SkillDef>;
  enemies: Record<string, EnemyDef>;
  characters: Record<string, CharacterDef>;
  events?: Record<string, EventDef>;
  passives?: Record<string, PassiveDef>;
  equipment?: Record<string, EquipmentDef>;
  validate: () => string[];
}

const duplicateIds = <T extends { id: string | number }>(items: readonly T[], label: string): string[] => {
  const seen = new Set<string | number>();
  const errors: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      errors.push(`duplicate ${label} id: ${String(item.id)}`);
    }
    seen.add(item.id);
  }
  return errors;
};

// P7 D1/D3/D5 — 쿨다운·신규 원자 검증
const validateCooldowns = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    if (skill.cooldown !== undefined) {
      if (!Number.isInteger(skill.cooldown) || skill.cooldown < 0 || skill.cooldown > 4) {
        errors.push(`skill ${String(skill.id)}: cooldown must be an integer from 0 to 4`);
      }
    }
    if (skill.type === 'flip' && skill.elementFaces !== undefined) {
      for (const bonus of skill.elementFaces) {
        if (bonus.effects.length === 0) {
          errors.push(`skill ${String(skill.id)}: elementFaces entry must declare at least one effect`);
        }
      }
    }
  }
  return errors;
};

const validateAtomAmounts = (db: Omit<ContentDb, 'validate'>): string[] => {
  const errors: string[] = [];
  const checkAtoms = (atoms: readonly EffectAtom[], owner: string): void => {
    for (const atom of atoms) {
      if (
        (atom.kind === 'draw' ||
          atom.kind === 'drawSpecific' ||
          atom.kind === 'nextTurnDraw' ||
          atom.kind === 'preserveChosenCoin' ||
          atom.kind === 'increasePreserveCapacity') &&
        (!Number.isInteger(atom.count) || atom.count <= 0)
      ) {
        errors.push(`${owner}: ${atom.kind} count must be a positive integer`);
      }
      if (
        (atom.kind === 'heal' || atom.kind === 'payHp' || atom.kind === 'lifesteal' || atom.kind === 'reduceCooldown' || atom.kind === 'fixedDamage' || atom.kind === 'damageIfTargetStatus' || atom.kind === 'nextTurnBlock') &&
        (!Number.isInteger(atom.amount) || atom.amount <= 0)
      ) {
        errors.push(`${owner}: ${atom.kind} amount must be a positive integer`);
      }
      if (atom.kind === 'echoPreheat' && (!Number.isInteger(atom.amount) || atom.amount <= 0)) {
        errors.push(`${owner}: echoPreheat amount must be a positive integer`);
      }
      if ((atom.kind === 'damagePlusEcho' || atom.kind === 'aoeDamagePlusEcho') && (!Number.isInteger(atom.base) || atom.base < 0)) {
        errors.push(`${owner}: ${atom.kind} base must be a non-negative integer`);
      }
      if (atom.kind === 'returnDiscardCoin' && (!Number.isInteger(atom.count) || atom.count <= 0)) {
        errors.push(`${owner}: returnDiscardCoin count must be a positive integer`);
      }
    }
  };
  for (const skill of Object.values(db.skills)) {
    const owner = `skill ${String(skill.id)}`;
    if (skill.type === 'consume') {
      checkAtoms(skill.effects, owner);
    } else {
      if (declaresSuccessLadder(skill)) {
        for (const tier of skill.successLadder ?? []) checkAtoms(tier, owner);
        if (skill.resonance) checkAtoms(skill.resonance.effects, owner);
      } else {
        checkAtoms(skill.base ?? [], owner);
        if (skill.heads) checkAtoms(skill.heads.effects, owner);
        if (skill.tails) checkAtoms(skill.tails.effects, owner);
        if (skill.mixed) checkAtoms(skill.mixed.effects, owner);
        for (const bonus of skill.elementFaces ?? []) checkAtoms(bonus.effects, owner);
      }
    }
    checkAtoms(skill.overheatBonus ?? [], owner);
    checkAtoms(skill.preservedBonus ?? [], owner);
  }
  return errors;
};

// P7 D4 — 양면 코인 검증: 속성 코인은 앞뒤 모두 1+ 효과, proc은 안전 원자만
const COIN_PROC_ATOMS = new Set(['damage', 'coinDamage', 'fixedDamage', 'damageIfTargetStatus', 'block', 'nextTurnBlock', 'heal', 'loseHp', 'applyStatus', 'addCoin', 'nextTurnDraw']);

const validateCoinProcs = (coins: Record<string, CoinDef>): string[] => {
  const errors: string[] = [];
  for (const coin of Object.values(coins)) {
    const owner = `coin ${String(coin.id)}`;
    if (coin.procs === undefined) continue;
    if ((coin.procs?.heads?.length ?? 0) === 0 || (coin.procs?.tails?.length ?? 0) === 0) {
      errors.push(`${owner}: coin with procs must declare both heads and tails effects`);
      continue;
    }
    for (const face of ['heads', 'tails'] as const) {
      for (const atom of coin.procs?.[face] ?? []) {
        if (!COIN_PROC_ATOMS.has(atom.kind)) {
          errors.push(`${owner}: proc atom ${atom.kind} is not allowed on a coin face`);
        }
      }
    }
  }
  return errors;
};

const validateSkillCosts = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];

  for (const skill of skills) {
    if (skill.type === 'consume') {
      const maximum = skill.bloodOffering === true ? 5 : 3;
      if (!Number.isInteger(skill.consume.count) || skill.consume.count < 1 || skill.consume.count > maximum) {
        errors.push(`skill ${String(skill.id)}: consume count must be an integer from 1 to ${maximum}`);
      }
      if (skill.consume.mode !== undefined && !['exact', 'upTo', 'all'].includes(skill.consume.mode)) {
        errors.push(`skill ${String(skill.id)}: unknown consume mode ${String(skill.consume.mode)}`);
      }
      continue;
    }

    const hpPaidZeroCost = skill.cost === 0 && (skill.base ?? []).some((atom) => atom.kind === 'payHp');
    if (!Number.isInteger(skill.cost) || skill.cost < 0 || (skill.cost === 0 && !hpPaidZeroCost)) {
      errors.push(`skill ${String(skill.id)}: flip cost must be a positive integer`);
      continue;
    }

    if (skill.cost > 5) {
      errors.push(`skill ${String(skill.id)}: flip cost ${skill.cost} exceeds the maximum of 5`);
      continue;
    }

    const isExceptionalCost = skill.rarity === 'rare' && (skill.oncePerCombat === true || skill.tags.includes('ultimate'));
    if (skill.cost === 5 && !isExceptionalCost) {
      errors.push(`skill ${String(skill.id)}: flip cost 5 requires rare rarity and oncePerCombat or ultimate`);
    }
  }

  return errors;
};

const validateFlipModels = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    if (skill.type !== 'flip') continue;
    const owner = `skill ${String(skill.id)}`;
    const ladderDeclared = declaresSuccessLadder(skill);
    if (!ladderDeclared) {
      if (skill.base === undefined) errors.push(`${owner}: legacy flip skill must declare base effects`);
      continue;
    }

    const legacyFields =
      skill.base !== undefined || [skill.heads, skill.tails, skill.mixed, skill.elementFaces].some((value) => value !== undefined);
    if (legacyFields) errors.push(`${owner}: success-ladder skill cannot mix legacy flip fields`);
    if (skill.remise !== undefined || (skill.overheatBonus?.length ?? 0) > 0) {
      errors.push(`${owner}: success-ladder skill cannot mix legacy remise or overheat behavior`);
    }
    if (skill.successFace !== 'heads' && skill.successFace !== 'tails') {
      errors.push(`${owner}: successFace must be heads or tails`);
    }
    if (skill.successLadder === undefined) {
      errors.push(`${owner}: successLadder is required`);
    } else {
      if (skill.successLadder.length !== skill.cost + 1) {
        errors.push(`${owner}: successLadder must contain exactly cost + 1 entries`);
      }
    }
    if (skill.resonance !== undefined) {
      if (skill.element === undefined || skill.resonance.element !== skill.element) {
        errors.push(`${owner}: resonance element must match the skill element`);
      }
      if (skill.resonance.effects.length === 0) {
        errors.push(`${owner}: resonance must declare at least one effect`);
      }
    }
  }
  return errors;
};

// addTurnTrigger 재귀 검증 — 잘못된 id/hook/빈 효과, 그리고 트리거 효과 안의
// 중첩 addTurnTrigger(순환 폭주 표면)를 콘텐츠 단계에서 거부한다 (P3.3 감사).
const TURN_TRIGGER_HOOKS = ['onDamageDealt', 'onAttackSkillResolved'] as const;

const validateTriggerAtoms = (atoms: readonly EffectAtom[], owner: string, insideTrigger: boolean, errors: string[]): void => {
  for (const atom of atoms) {
    if (atom.kind !== 'addTurnTrigger') continue;
    if (insideTrigger) {
      errors.push(`${owner}: nested addTurnTrigger inside a trigger is not allowed`);
      continue;
    }
    const trigger = atom.trigger;
    if (typeof trigger.id !== 'string' || trigger.id.length === 0) {
      errors.push(`${owner}: turn trigger id must be a non-empty string`);
    }
    if (!TURN_TRIGGER_HOOKS.includes(trigger.hook)) {
      errors.push(`${owner}: unknown turn trigger hook ${String(trigger.hook)}`);
    }
    if (!Array.isArray(trigger.effects) || trigger.effects.length === 0) {
      errors.push(`${owner}: turn trigger ${trigger.id} must declare at least one effect`);
    } else {
      validateTriggerAtoms(trigger.effects, `${owner} trigger ${trigger.id}`, true, errors);
    }
  }
};

// attack 태그 스킬이 self/none 대상을 갖으면 onAttackSkillResolved류 트리거가
// 플레이어를 대상으로 발동하는 셀프 피해 함정이 된다 — 구조적으로 금지 (P3.3 감사)
const validateAttackTargets = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    if (skill.tags.includes('attack') && skill.targetType !== 'single-enemy' && skill.targetType !== 'all-enemies') {
      errors.push(`skill ${String(skill.id)}: attack tag requires an enemy targetType (got ${skill.targetType})`);
    }
  }
  return errors;
};

const validateTurnTriggers = (db: Omit<ContentDb, 'validate'>): string[] => {
  const errors: string[] = [];
  for (const skill of Object.values(db.skills)) {
    const owner = `skill ${String(skill.id)}`;
    if (skill.type === 'consume') {
      validateTriggerAtoms(skill.effects, owner, false, errors);
    } else if (declaresSuccessLadder(skill)) {
      for (const tier of skill.successLadder ?? []) validateTriggerAtoms(tier, owner, false, errors);
      if (skill.resonance) validateTriggerAtoms(skill.resonance.effects, owner, false, errors);
    } else {
      validateTriggerAtoms(skill.base ?? [], owner, false, errors);
      if (skill.heads) validateTriggerAtoms(skill.heads.effects, owner, false, errors);
      if (skill.tails) validateTriggerAtoms(skill.tails.effects, owner, false, errors);
      if (skill.mixed) validateTriggerAtoms(skill.mixed.effects, owner, false, errors);
    }
  }
  for (const character of Object.values(db.characters)) {
    validateTriggerAtoms(character.trait.effects, `character ${String(character.id)}`, false, errors);
  }
  return errors;
};

const validateEvents = (events: readonly EventDef[], enemies: Record<string, EnemyDef>): string[] => {
  const errors: string[] = [];
  for (const event of events) {
    if (event.risk !== 'combat') continue;
    if (event.elitePool.length === 0) {
      errors.push(`event ${String(event.id)}: elitePool must not be empty`);
    }
    for (const encounter of event.elitePool) {
      if (encounter.length === 0) {
        errors.push(`event ${String(event.id)}: elitePool encounter must not be empty`);
      }
      for (const enemyId of encounter) {
        if (enemies[String(enemyId)] === undefined) {
          errors.push(`event ${String(event.id)}: unknown enemy ${String(enemyId)}`);
        }
      }
    }
  }
  return errors;
};

const validateEnemyPassives = (enemies: Record<string, EnemyDef>): string[] => {
  const errors: string[] = [];
  const SELF_ONLY = new Set(['heal', 'block', 'buffNextAttack']);
  for (const enemy of Object.values(enemies)) {
    const passive = enemy.passive;
    if (passive === undefined) continue;
    const owner = `enemy ${String(enemy.id)} passive ${passive.id}`;
    if (passive.effects.length === 0) errors.push(`${owner}: must declare at least one effect`);
    for (const action of passive.effects) {
      if (!SELF_ONLY.has(action.kind)) {
        errors.push(`${owner}: only self-target actions are allowed (got ${action.kind})`);
      } else if ('amount' in action && (!Number.isInteger(action.amount) || action.amount <= 0)) {
        errors.push(`${owner}: ${action.kind} amount must be a positive integer`);
      }
    }
  }
  return errors;
};

const validateEnemyIntents = (enemies: Record<string, EnemyDef>, coins: Record<string, CoinDef>): string[] => {
  const errors: string[] = [];
  const validateIntent = (intent: EnemyIntent, owner: string): void => {
    if (intent.windup !== undefined) {
      if (!Number.isInteger(intent.windup.turns) || intent.windup.turns < 1 || intent.windup.turns > 3) {
        errors.push(`${owner}: windup turns must be an integer from 1 to 3`);
      }
      if (intent.windup.revealAtStart !== true) errors.push(`${owner}: windup revealAtStart must be true`);
    }
    for (const predicate of intent.cancelOn === undefined ? [] : Array.isArray(intent.cancelOn) ? intent.cancelOn : [intent.cancelOn]) {
      if (predicate.kind === 'skillDamage') {
        if (!Number.isInteger(predicate.threshold) || predicate.threshold <= 0) errors.push(`${owner}: cancelOn skillDamage threshold must be a positive integer`);
      } else if (predicate.kind === 'enemyResourceAtMost' && predicate.resource === 'furnaceTemperature') {
        if (!Number.isInteger(predicate.value) || predicate.value < 0) errors.push(`${owner}: cancelOn furnace temperature must be a non-negative integer`);
      } else if (predicate.kind === 'vaultCoinsRecovered') {
        if (!Number.isInteger(predicate.count) || predicate.count <= 0) errors.push(`${owner}: cancelOn vault recovery count must be a positive integer`);
      } else {
        errors.push(`${owner}: cancelOn must use a discriminated predicate`);
      }
    }
    for (const action of intent.onCancelActions ?? []) {
      if (action.kind !== 'setEnemyResource' && action.kind !== 'adjustEnemyResource' && action.kind !== 'reduceGrowthStacks' && action.kind !== 'returnOldestRoyalVaultCoin') {
        errors.push(`${owner}: onCancelActions only support enemy resource mutation or growth reduction`);
      }
    }
    if (
      intent.vulnerableWhileWindup !== undefined &&
      (!Number.isFinite(intent.vulnerableWhileWindup) || intent.vulnerableWhileWindup <= 1 || intent.vulnerableWhileWindup > 2)
    ) {
      errors.push(`${owner}: vulnerableWhileWindup must be greater than 1 and at most 2`);
    }
    for (const action of intent.actions) {
      if ('amount' in action && (!Number.isInteger(action.amount) || action.amount <= 0)) {
        errors.push(`${owner}: ${action.kind} amount must be a positive integer`);
      }
      if (action.kind === 'attack') {
        if (!Number.isInteger(action.damage) || action.damage <= 0) errors.push(`${owner}: attack damage must be a positive integer`);
        if (action.hits !== undefined && (!Number.isInteger(action.hits) || action.hits <= 0)) {
          errors.push(`${owner}: attack hits must be a positive integer`);
        }
        if (
          action.damagePerGrowthPercent !== undefined &&
          (!Number.isFinite(action.damagePerGrowthPercent) || action.damagePerGrowthPercent <= 0 || action.damagePerGrowthPercent > 1)
        ) {
          errors.push(`${owner}: attack damagePerGrowthPercent must be greater than 0 and at most 1`);
        }
      } else if (action.kind === 'conditionalAttack') {
        if (!Number.isInteger(action.damage) || action.damage <= 0) errors.push(`${owner}: conditionalAttack damage must be a positive integer`);
        if (!Number.isInteger(action.bonusDamage) || action.bonusDamage < 0) {
          errors.push(`${owner}: conditionalAttack bonusDamage must be a non-negative integer`);
        }
      } else if (action.kind === 'applyStatus') {
        if (!Number.isInteger(action.stacks) || action.stacks <= 0) {
          errors.push(`${owner}: applyStatus stacks must be a positive integer`);
        }
        if (
          action.requiresPlayerStatus !== undefined &&
          (!Number.isInteger(action.requiresPlayerStatus.atLeast) || action.requiresPlayerStatus.atLeast <= 0)
        ) {
          errors.push(`${owner}: applyStatus requiresPlayerStatus atLeast must be a positive integer`);
        }
      } else if (action.kind === 'growOnUnblockedDamage') {
        if (action.healOnGrow !== undefined && (!Number.isInteger(action.healOnGrow) || action.healOnGrow <= 0)) {
          errors.push(`${owner}: healOnGrow must be a positive integer`);
        }
        if (action.maxStacks !== undefined && (!Number.isInteger(action.maxStacks) || action.maxStacks <= 0)) {
          errors.push(`${owner}: maxStacks must be a positive integer`);
        }
        if (
          action.minHpDamageFraction !== undefined &&
          (!Number.isFinite(action.minHpDamageFraction) || action.minHpDamageFraction < 0 || action.minHpDamageFraction >= 1)
        ) {
          errors.push(`${owner}: minHpDamageFraction must be at least 0 and less than 1`);
        }
      } else if (action.kind === 'healAlly' && action.cleanse !== undefined) {
        if (!Number.isInteger(action.cleanse) || action.cleanse <= 0 || action.cleanse > 3) {
          errors.push(`${owner}: healAlly cleanse must be an integer from 1 to 3`);
        }
      } else if (action.kind === 'summonEnemies') {
        if (enemies[String(action.enemy)] === undefined) errors.push(`${owner}: summon enemy must exist`);
        if (!Number.isInteger(action.maxCount) || action.maxCount <= 0 || action.maxCount > 2) {
          errors.push(`${owner}: summon maxCount must be an integer from 1 to 2`);
        }
      } else if (action.kind === 'accelerateHatching' && (!Number.isInteger(action.amount) || action.amount <= 0)) {
        errors.push(`${owner}: accelerate hatching amount must be a positive integer`);
      } else if (action.kind === 'setEnemyResource') {
        if (!Number.isInteger(action.value) || action.value < 0) errors.push(`${owner}: set enemy resource value must be a non-negative integer`);
        if (action.reason.trim().length === 0) errors.push(`${owner}: set enemy resource reason must not be empty`);
      } else if (action.kind === 'adjustEnemyResource') {
        if (!Number.isInteger(action.amount) || action.amount === 0) errors.push(`${owner}: adjust enemy resource amount must be a non-zero integer`);
        if (action.reason.trim().length === 0) errors.push(`${owner}: adjust enemy resource reason must not be empty`);
      } else if (action.kind === 'removePlayerStatus' && (!Number.isInteger(action.stacks) || action.stacks <= 0)) {
        errors.push(`${owner}: remove player status stacks must be a positive integer`);
      } else if (action.kind === 'reduceGrowthStacks' && (!Number.isInteger(action.amount) || action.amount <= 0)) {
        errors.push(`${owner}: reduce growth stacks amount must be a positive integer`);
      } else if (action.kind === 'sealTriggeredSkill' && (!Number.isInteger(action.turns) || action.turns <= 0)) {
        errors.push(`${owner}: sealTriggeredSkill turns must be a positive integer`);
      } else if (action.kind === 'royalTax' && (!Number.isInteger(action.degradedDamage) || action.degradedDamage <= 0)) {
        errors.push(`${owner}: royalTax degradedDamage must be a positive integer`);
      }
    }
    if (intent.growthBranch !== undefined) {
      if (!Number.isInteger(intent.growthBranch.atLeast) || intent.growthBranch.atLeast <= 0) {
        errors.push(`${owner}: growthBranch atLeast must be a positive integer`);
      }
      validateIntent(intent.growthBranch.intent, `${owner} growth branch ${intent.growthBranch.intent.id}`);
    }
  };
  for (const enemy of Object.values(enemies)) {
    if (enemy.intents.length === 0) errors.push(`enemy ${String(enemy.id)}: must declare at least one intent`);
    const owner = `enemy ${String(enemy.id)}`;
    if (enemy.threat !== undefined && (!Number.isFinite(enemy.threat) || enemy.threat < 0)) errors.push(`${owner}: threat must be non-negative`);
    if (enemy.protectionLink !== undefined) {
      const link = enemy.protectionLink;
      if (link.target !== 'highestThreatAlly') errors.push(`${owner}: protection target must be highestThreatAlly`);
      if (!Number.isFinite(link.redirectFraction) || link.redirectFraction <= 0 || link.redirectFraction >= 1) errors.push(`${owner}: protection redirectFraction must be between 0 and 1`);
      if (!Number.isInteger(link.durability) || link.durability <= 0) errors.push(`${owner}: protection durability must be a positive integer`);
      if (!Number.isInteger(link.restoreDurability) || link.restoreDurability <= 0 || link.restoreDurability > link.durability) errors.push(`${owner}: protection restoreDurability must be a positive integer no greater than durability`);
      if (!Number.isInteger(link.brokenTurns) || link.brokenTurns <= 0) errors.push(`${owner}: protection brokenTurns must be a positive integer`);
      if (!Number.isFinite(link.damageTakenMultiplierWhileBroken) || link.damageTakenMultiplierWhileBroken <= 1) errors.push(`${owner}: protection broken multiplier must be greater than 1`);
    }
    if (enemy.petrify !== undefined) {
      const petrify = enemy.petrify;
      if (!Number.isFinite(petrify.damageReduction) || petrify.damageReduction <= 0 || petrify.damageReduction >= 1) errors.push(`${owner}: petrify damageReduction must be between 0 and 1`);
      if (!Number.isFinite(petrify.shatterRawDamageFraction) || petrify.shatterRawDamageFraction <= 0 || petrify.shatterRawDamageFraction > 1) errors.push(`${owner}: petrify shatter fraction must be in (0, 1]`);
      if (!Number.isInteger(petrify.crackedTurns) || petrify.crackedTurns <= 0) errors.push(`${owner}: petrify crackedTurns must be a positive integer`);
      if (!Number.isFinite(petrify.crackedDamageTakenMultiplier) || petrify.crackedDamageTakenMultiplier <= 1) errors.push(`${owner}: petrify cracked multiplier must be greater than 1`);
      const cancelIntent = enemy.intents.find((intent) => intent.id === petrify.cancelWindupIntentId);
      if (cancelIntent === undefined) errors.push(`${owner}: petrify cancelWindupIntentId must reference an intent`);
      else if (cancelIntent.windup === undefined) errors.push(`${owner}: petrify cancel intent must have a windup`);
    }
    if (enemy.warBanner !== undefined) {
      const banner = enemy.warBanner;
      if (!Number.isFinite(banner.attackAuraPercent) || banner.attackAuraPercent <= 0 || banner.attackAuraPercent > 1) errors.push(`${owner}: banner aura must be in (0, 1]`);
      if (!Number.isFinite(banner.march.attackPercent) || banner.march.attackPercent <= 0 || banner.march.attackPercent > 1) errors.push(`${owner}: banner march attack must be in (0, 1]`);
      if (!Number.isInteger(banner.march.turns) || banner.march.turns <= 0) errors.push(`${owner}: banner march turns must be a positive integer`);
      if (!Number.isFinite(banner.march.shieldMaxHpFraction) || banner.march.shieldMaxHpFraction <= 0 || banner.march.shieldMaxHpFraction > 1) errors.push(`${owner}: banner march shield must be in (0, 1]`);
    }
    if (enemy.hatch !== undefined) {
      const hatch = enemy.hatch;
      if (enemies[String(hatch.into)] === undefined) errors.push(`${owner}: hatch target must exist`);
      if (!Number.isInteger(hatch.turns) || hatch.turns <= 0) errors.push(`${owner}: hatch turns must be a positive integer`);
      if (!Number.isFinite(hatch.delayAtHpFraction) || hatch.delayAtHpFraction <= 0 || hatch.delayAtHpFraction >= 1) {
        errors.push(`${owner}: hatch delay fraction must be between 0 and 1`);
      }
    }
    if (enemy.furnace !== undefined) {
      const furnace = enemy.furnace;
      if (furnace.maxTemperature !== 6) errors.push(`${owner}: furnace maxTemperature must be exactly 6`);
      if (!Number.isInteger(furnace.initialTemperature) || furnace.initialTemperature < 0 || furnace.initialTemperature > furnace.maxTemperature) {
        errors.push(`${owner}: furnace initialTemperature must be from 0 through maxTemperature`);
      }
      for (const [label, value] of [['actionResolvedGain', furnace.actionResolvedGain], ['playerBurnDamageGain', furnace.playerBurnDamageGain], ['playerBurnClearLoss', furnace.playerBurnClearLoss]] as const) {
        if (value !== undefined && (!Number.isInteger(value) || value <= 0)) errors.push(`${owner}: furnace ${label} must be a positive integer`);
      }
      const threshold = furnace.playerDamageThreshold;
      if (threshold !== undefined && (!Number.isFinite(threshold.phaseEntryHpFraction) || threshold.phaseEntryHpFraction <= 0 || threshold.phaseEntryHpFraction > 1 || !Number.isInteger(threshold.loss) || threshold.loss <= 0)) {
        errors.push(`${owner}: furnace player damage threshold must have fraction in (0, 1] and positive integer loss`);
      }
      if (furnace.atMaxIntent !== undefined) {
        validateIntent(furnace.atMaxIntent, `${owner}: furnace atMaxIntent ${furnace.atMaxIntent.id}`);
        if (furnace.atMaxIntent.windup === undefined) errors.push(`${owner}: furnace atMaxIntent must wind up`);
      }
    }
    if (enemy.vassalGuard !== undefined) {
      const guard = enemy.vassalGuard;
      if (enemies[String(guard.source)] === undefined) errors.push(`${owner}: vassal guard source must exist`);
      if (!Number.isFinite(guard.damageReductionPercent) || guard.damageReductionPercent <= 0 || guard.damageReductionPercent >= 1) errors.push(`${owner}: vassal guard reduction must be in (0, 1)`);
      if (!Number.isInteger(guard.maxSources) || guard.maxSources < 1 || guard.maxSources > 2) errors.push(`${owner}: vassal guard maxSources must be an integer from 1 to 2`);
    }
    if (enemy.repeatSkillPressure !== undefined) {
      const pressure = enemy.repeatSkillPressure;
      if (!Number.isInteger(pressure.threshold) || pressure.threshold <= 0) errors.push(`${owner}: repeat pressure threshold must be a positive integer`);
      if (!Number.isInteger(pressure.maxZeal) || pressure.maxZeal < pressure.threshold) errors.push(`${owner}: repeat pressure maxZeal must be at least threshold`);
      if (!Number.isInteger(pressure.sameSkillGain) || pressure.sameSkillGain <= 0) errors.push(`${owner}: repeat pressure sameSkillGain must be a positive integer`);
      if (!Number.isInteger(pressure.differentSkillReset) || pressure.differentSkillReset < 0) errors.push(`${owner}: repeat pressure differentSkillReset must be non-negative`);
      if (!Number.isInteger(pressure.singleUsableZealEveryUses) || pressure.singleUsableZealEveryUses <= 0) errors.push(`${owner}: repeat pressure zeal cadence must be a positive integer`);
      if (!Number.isInteger(pressure.sealTurns) || pressure.sealTurns <= 0) errors.push(`${owner}: repeat pressure seal turns must be a positive integer`);
      validateIntent(pressure.executionIntent, `${owner} repeat pressure execution ${pressure.executionIntent.id}`);
      if (pressure.executionIntent.windup === undefined) errors.push(`${owner}: repeat pressure execution must wind up`);
    }
    if (enemy.royalTax !== undefined) {
      const tax = enemy.royalTax;
      if (!Number.isInteger(tax.denomination) || tax.denomination <= 0) errors.push(`${owner}: royal tax denomination must be a positive integer`);
      if (tax.deadline !== 'endNextPlayerTurn') errors.push(`${owner}: royal tax deadline must be endNextPlayerTurn`);
      const counterfeit = coins[String(tax.counterfeitCoin)];
      if (counterfeit === undefined) errors.push(`${owner}: royal tax counterfeitCoin must exist`);
      else if (counterfeit.counterfeit !== true || counterfeit.element !== null || counterfeit.procs !== undefined) errors.push(`${owner}: royal tax counterfeitCoin must be combat-only, elementless, and have no procs`);
      if (!Number.isInteger(tax.counterfeitCount) || tax.counterfeitCount <= 0) errors.push(`${owner}: royal tax counterfeitCount must be a positive integer`);
      if (!Number.isInteger(tax.defaultShield) || tax.defaultShield < 0) errors.push(`${owner}: royal tax defaultShield must be a non-negative integer`);
      if (tax.foreclosureAfterDefaults === undefined) {
        const legacySeizureAfterDefaults = tax.seizureAfterDefaults;
        if (typeof legacySeizureAfterDefaults !== 'number' || !Number.isInteger(legacySeizureAfterDefaults) || legacySeizureAfterDefaults <= 0) errors.push(`${owner}: royal tax seizureAfterDefaults must be a positive integer`);
        if (tax.seizureIntent === undefined) errors.push(`${owner}: royal tax seizureIntent is required without foreclosure`);
      }
      if (tax.seizureIntent !== undefined) {
        validateIntent(tax.seizureIntent, `${owner} royal tax seizure ${tax.seizureIntent.id}`);
        if (tax.seizureIntent.windup === undefined) errors.push(`${owner}: royal tax seizure must wind up`);
      }
      if (tax.foreclosureAfterDefaults !== undefined && (!Number.isInteger(tax.foreclosureAfterDefaults) || tax.foreclosureAfterDefaults <= 0)) errors.push(`${owner}: royal tax foreclosureAfterDefaults must be a positive integer`);
      if (tax.foreclosureIntent !== undefined) validateIntent(tax.foreclosureIntent, `${owner} royal tax foreclosure ${tax.foreclosureIntent.id}`);
      if (tax.foreclosureAfterDefaults !== undefined && tax.foreclosureIntent === undefined) errors.push(`${owner}: royal tax foreclosureIntent is required with foreclosureAfterDefaults`);
      if (tax.foreclosureMaxCoins !== undefined && (!Number.isInteger(tax.foreclosureMaxCoins) || tax.foreclosureMaxCoins <= 0)) errors.push(`${owner}: royal tax foreclosureMaxCoins must be a positive integer`);
      if (tax.paidNextOrdinaryAttackReduction !== undefined && (!Number.isInteger(tax.paidNextOrdinaryAttackReduction) || tax.paidNextOrdinaryAttackReduction <= 0)) errors.push(`${owner}: royal tax paid reduction must be a positive integer`);
    }
    if (enemy.royalVault !== undefined) {
      const vault = enemy.royalVault;
      if (!Number.isInteger(vault.capacity) || vault.capacity <= 0) errors.push(`${owner}: royal vault capacity must be a positive integer`);
      if (vault.blockLostPerRecovery !== undefined && (!Number.isInteger(vault.blockLostPerRecovery) || vault.blockLostPerRecovery < 0)) errors.push(`${owner}: royal vault block loss must be non-negative`);
      if (vault.atCapacityIntent !== undefined) validateIntent(vault.atCapacityIntent, `${owner}: royal vault at-cap ${vault.atCapacityIntent.id}`);
      if (vault.lead !== undefined) {
        const lead = vault.lead;
        for (const [label, value] of Object.entries(lead)) if (value !== undefined && (!Number.isInteger(value) || value <= 0)) errors.push(`${owner}: royal vault lead ${label} must be a positive integer`);
      }
    }
    enemy.intents.forEach((intent, index) => validateIntent(intent, `enemy ${String(enemy.id)} intent ${intent.id || index}`));
    for (const [index, phase] of (enemy.phases ?? []).entries()) {
      const owner = `enemy ${String(enemy.id)} phase ${index}`;
      if (!Number.isFinite(phase.hpBelowFraction) || phase.hpBelowFraction <= 0 || phase.hpBelowFraction >= 1) {
        errors.push(`${owner}: hpBelowFraction must be greater than 0 and less than 1`);
      }
      if (phase.intents.length === 0) errors.push(`${owner}: must declare at least one intent`);
      if (phase.transitionBeforeAction !== undefined && phase.transitionBeforeAction !== true) {
        errors.push(`${owner}: transitionBeforeAction must be true when declared`);
      }
      if (phase.growthOnActionResolved !== undefined) {
        const growth = phase.growthOnActionResolved;
        if (!Number.isInteger(growth.amount) || growth.amount <= 0 || !Number.isInteger(growth.maxStacks) || growth.maxStacks < growth.amount) {
          errors.push(`${owner}: growthOnActionResolved requires positive integer amount and maxStacks at least amount`);
        }
      }
      for (const action of phase.onEnterActions ?? []) {
        // Reuse the intent action validator without implying a phase has a turn intent.
        validateIntent({ id: `${owner}-on-enter`, actions: [action] }, owner);
        if (action.kind !== 'setEnemyResource' && action.kind !== 'adjustEnemyResource' && action.kind !== 'removePlayerStatus' && action.kind !== 'summonEnemies' && action.kind !== 'returnOldestRoyalVaultCoin' && action.kind !== 'clearLeadCoins' && action.kind !== 'removeCounterfeits') {
          errors.push(`${owner}: onEnterActions only support resource mutation, player status removal, or summons`);
        }
      }
      if (
        phase.damageTakenMultiplier !== undefined &&
        (!Number.isFinite(phase.damageTakenMultiplier) || phase.damageTakenMultiplier <= 1 || phase.damageTakenMultiplier > 2)
      ) {
        errors.push(`${owner}: damageTakenMultiplier must be greater than 1 and at most 2`);
      }
      phase.intents.forEach((intent, intentIndex) => validateIntent(intent, `${owner} intent ${intent.id || intentIndex}`));
    }
    if (enemy.growthLabel !== undefined && enemy.growthLabel.trim().length === 0) {
      errors.push(`enemy ${String(enemy.id)}: growthLabel must not be empty`);
    }
    const punishment = enemy.playerTurnEndPunishment;
    if (punishment !== undefined) {
      const owner = `enemy ${String(enemy.id)} playerTurnEndPunishment`;
      if (!Number.isInteger(punishment.threshold) || punishment.threshold <= 0) {
        errors.push(`${owner}: threshold must be a positive integer`);
      }
      if (!Number.isInteger(punishment.stacks) || punishment.stacks <= 0) {
        errors.push(`${owner}: stacks must be a positive integer`);
      }
    }
    const growth = enemy.roundGrowth;
    if (growth !== undefined) {
      const owner = `enemy ${String(enemy.id)} roundGrowth`;
      if (!Number.isInteger(growth.gainPerRound) || growth.gainPerRound <= 0) {
        errors.push(`${owner}: gainPerRound must be a positive integer`);
      }
      if (!Number.isInteger(growth.maxStacks) || growth.maxStacks <= 0) {
        errors.push(`${owner}: maxStacks must be a positive integer`);
      }
      if (
        !Number.isFinite(growth.damageReductionPerStack) ||
        growth.damageReductionPerStack <= 0 ||
        growth.damageReductionPerStack >= 1 ||
        growth.damageReductionPerStack * growth.maxStacks >= 1
      ) {
        errors.push(`${owner}: damageReductionPerStack must keep total reduction below 1`);
      }
      if (!Number.isFinite(growth.healMaxHpFractionPerStack) || growth.healMaxHpFractionPerStack <= 0 || growth.healMaxHpFractionPerStack >= 1) {
        errors.push(`${owner}: healMaxHpFractionPerStack must be greater than 0 and less than 1`);
      }
      if (!Number.isFinite(growth.removeOneAtHpFraction) || growth.removeOneAtHpFraction <= 0 || growth.removeOneAtHpFraction >= 1) {
        errors.push(`${owner}: removeOneAtHpFraction must be greater than 0 and less than 1`);
      }
      if (
        !Number.isFinite(growth.removeTwoAtHpFraction) ||
        growth.removeTwoAtHpFraction <= growth.removeOneAtHpFraction ||
        growth.removeTwoAtHpFraction >= 1
      ) {
        errors.push(`${owner}: removeTwoAtHpFraction must be greater than removeOneAtHpFraction and less than 1`);
      }
    }
  }
  return errors;
};

// P6 D2 — 획득 패시브 검증: 플레이어 훅에서 안전한 원자만 (applyStatus/damage류는
// runHook의 player 타깃 문맥에서 자기 오염이 되므로 콘텐츠 단계에서 차단).
const PASSIVE_SAFE_ATOMS = new Set(['block', 'addCoin', 'addTurnTrigger', 'empowerSummons', 'summonEquipment', 'grantElement']);

const validatePassives = (passives: Record<string, PassiveDef> | undefined): string[] => {
  const errors: string[] = [];
  for (const passive of Object.values(passives ?? {})) {
    const owner = `passive ${String(passive.id)}`;
    if (passive.description.length === 0) errors.push(`${owner}: description is required`);
    if (!Number.isInteger(passive.price) || passive.price <= 0) errors.push(`${owner}: price must be a positive integer`);
    if (passive.effects.length === 0 && passive.mechanic === undefined) errors.push(`${owner}: must declare at least one effect or mechanic`);
    for (const atom of passive.effects) {
      if (!PASSIVE_SAFE_ATOMS.has(atom.kind)) errors.push(`${owner}: atom ${atom.kind} is not allowed in a passive`);
      if (atom.kind === 'summonEquipment' && atom.equipment === 'chosen') errors.push(`${owner}: passive summon must name a concrete equipment`);
    }
    validateTriggerAtoms(passive.effects, owner, false, errors);
  }
  return errors;
};

const validateEquipment = (equipment: Record<string, EquipmentDef> | undefined): string[] => {
  const errors: string[] = [];
  for (const def of Object.values(equipment ?? {})) {
    const owner = `equipment ${String(def.id)}`;
    const amount = def.action.kind === 'strike' ? def.action.damage : def.action.block;
    if (!Number.isInteger(amount) || amount <= 0) errors.push(`${owner}: action amount must be a positive integer`);
  }
  return errors;
};

// P6 D3 — 강화 patch 정합: baseAmount는 amount 보유 원자만, addFaceEffect는 flip만,
// costDelta는 비용 규칙 유지, removeOncePerCombat는 oncePerCombat 스킬만.
const validateSkillUpgrades = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    const upgrade = skill.upgrade;
    if (upgrade === undefined) continue;
    const owner = `skill ${String(skill.id)} upgrade`;
    const patch = upgrade.patch;
    const ladderSkill = skill.type === 'flip' && declaresSuccessLadder(skill);
    if (ladderSkill && patch.kind !== 'multi' && patch.kind !== 'ladderAmount') {
      errors.push(`${owner}: success-ladder skill only supports ladderAmount patches`);
      continue;
    }
    if (patch.kind === 'multi') {
      if (patch.patches.length < 2) errors.push(`${owner}: multi requires at least two patches`);
      for (const child of patch.patches) {
        const nested = {
          ...skill,
          upgrade: { ...upgrade, patch: child }
        } as SkillDef;
        errors.push(...validateSkillUpgrades([nested]));
      }
    } else if (patch.kind === 'ladderAmount') {
      if (skill.type !== 'flip' || !isSuccessLadderFlipSkill(skill)) {
        errors.push(`${owner}: ladderAmount requires a success-ladder flip skill`);
        continue;
      }
      if (!Number.isInteger(patch.tier) || skill.successLadder[patch.tier] === undefined) {
        errors.push(`${owner}: ladderAmount tier ${patch.tier} does not exist`);
      } else if (!Number.isInteger(patch.index)) {
        errors.push(`${owner}: ladderAmount index ${patch.index} does not exist`);
      } else {
        const atom = skill.successLadder[patch.tier]?.[patch.index];
        const field = patch.field ?? 'amount';
        if (atom === undefined || !(field in atom) || typeof atom[field as keyof typeof atom] !== 'number') {
          errors.push(`${owner}: ladderAmount index ${patch.index} has no ${field}`);
        }
      }
      if (!Number.isInteger(patch.delta) || patch.delta === 0) {
        errors.push(`${owner}: ladderAmount delta must be a nonzero integer`);
      }
    } else if (patch.kind === 'baseAmount') {
      const atoms = skill.type === 'flip' ? (skill.base ?? []) : skill.effects;
      const atom = atoms[patch.index];
      if (atom === undefined || !('amount' in atom) || typeof atom.amount !== 'number') errors.push(`${owner}: baseAmount index ${patch.index} has no amount`);
      if (!Number.isInteger(patch.delta) || patch.delta === 0) errors.push(`${owner}: baseAmount delta must be a nonzero integer`);
    } else if (patch.kind === 'addFaceEffect' || patch.kind === 'addMixedFaceEffect') {
      if (skill.type !== 'flip') errors.push(`${owner}: addFaceEffect requires a flip skill`);
    } else if (patch.kind === 'setFaceMode') {
      if (skill.type !== 'flip' || skill[patch.face] === undefined) errors.push(`${owner}: setFaceMode requires an existing flip face`);
    } else if (patch.kind === 'replaceEffect') {
      if (patch.section !== 'base' && skill.type !== 'flip') errors.push(`${owner}: replaceEffect ${patch.section} requires a flip skill`);
      const atoms =
        patch.section === 'base'
          ? skill.type === 'flip'
            ? (skill.base ?? [])
            : skill.effects
          : patch.section === 'onRepeatFinish'
            ? skill.type === 'flip'
              ? skill.remise?.onRepeatFinish
              : undefined
          : patch.section === 'overheat'
            ? skill.overheatBonus
            : skill.type === 'flip'
              ? skill[patch.section]?.effects
              : undefined;
      if (atoms?.[patch.index] === undefined) errors.push(`${owner}: replaceEffect index ${patch.index} does not exist`);
    } else if (patch.kind === 'setRemiseLightningCount') {
      if (skill.type !== 'flip' || skill.remise === undefined || !Number.isInteger(patch.count) || patch.count <= 0)
        errors.push(`${owner}: setRemiseLightningCount requires a remise flip skill and positive count`);
    } else if (patch.kind === 'costDelta') {
      if (skill.type === 'flip') {
        const cost = skill.cost + patch.delta;
        if (cost < 0 || cost > 5) errors.push(`${owner}: costDelta leaves cost out of range`);
      } else {
        const count = skill.consume.count + patch.delta;
        const maximum = skill.bloodOffering === true ? 5 : 3;
        if (count < 1 || count > maximum) errors.push(`${owner}: costDelta leaves consume count out of range`);
      }
    } else if (patch.kind === 'removeOncePerCombat') {
      if (skill.oncePerCombat !== true) errors.push(`${owner}: removeOncePerCombat requires a oncePerCombat skill`);
    } else if (patch.kind === 'addCoinOnUse') {
      if (!Number.isInteger(patch.count) || patch.count <= 0) errors.push(`${owner}: addCoinOnUse count must be a positive integer`);
    }
  }
  return errors;
};

const validateEnchantDefs = (enchants: ContentDb['enchants']): string[] => {
  const errors: string[] = [];
  const allowed = new Set<string>(COIN_ENCHANT_IDS);
  for (const [key, enchant] of Object.entries(enchants ?? {})) {
    if (String(enchant.id) !== key) errors.push(`enchant ${key}: record key must match id`);
    if (!allowed.has(enchant.mechanic)) errors.push(`enchant ${key}: unknown mechanic ${String(enchant.mechanic)}`);
    if (enchant.name.trim().length === 0) errors.push(`enchant ${key}: name is required`);
    if (enchant.description.trim().length === 0) errors.push(`enchant ${key}: description is required`);
  }
  return errors;
};

export const validateContentDb = (db: Omit<ContentDb, 'validate'>): string[] => [
  ...duplicateIds(Object.values(db.coins), 'coin'),
  ...duplicateIds(Object.values(db.enchants ?? {}), 'enchant'),
  ...duplicateIds(Object.values(db.skills), 'skill'),
  ...duplicateIds(Object.values(db.enemies), 'enemy'),
  ...duplicateIds(Object.values(db.characters), 'character'),
  ...duplicateIds(Object.values(db.events ?? {}), 'event'),
  ...validateCoinProcs(db.coins),
  ...validateFlipModels(Object.values(db.skills)),
  ...validateSkillCosts(Object.values(db.skills)),
  ...validateCooldowns(Object.values(db.skills)),
  ...validateAtomAmounts(db),
  ...validateTurnTriggers(db),
  ...validateAttackTargets(Object.values(db.skills)),
  ...validateEvents(Object.values(db.events ?? {}), db.enemies),
  ...validateEnemyIntents(db.enemies, db.coins),
  ...validateEnemyPassives(db.enemies),
  ...validatePassives(db.passives),
  ...validateEquipment(db.equipment),
  ...validateSkillUpgrades(Object.values(db.skills)),
  ...validateEnchantDefs(db.enchants)
];

export const effectiveElements = (coin: CoinInstance, db: ContentDb): Element[] => {
  if (coin.lead === true) return [];
  const def = db.coins[String(coin.defId)];
  const elements = new Set<Element>(coin.grants);
  if (def?.element != null) {
    elements.add(def.element);
  }
  return [...elements];
};
