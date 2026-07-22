import type { CoinInstance, EnemyIntent, EnemyRoundGrowthDef, StatusId, TurnTriggerDef } from '../content-types';
import type { CharacterId, PassiveId, EquipmentDefId, CoinUid, Element, EnemyDefId, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import type { CombatEvent } from './events';

// P7 D2 — 기본 최대 장착 슬롯 (단일 정본 — reducer/run/types/저장 검증이 모두 이 상수를 쓴다)
export const MAX_SKILL_SLOTS = 8;
// P11 — 자동/직접/턴 종료 보존이 모두 공유하는 전투 중 절대 상한.
export const MAX_PRESERVED_COINS = 3;

export const bloodSwordPowerFor = (investment: number): number => {
  if (investment >= 30) return 5;
  if (investment >= 25) return 4;
  if (investment >= 15) return 3;
  if (investment >= 10) return 2;
  if (investment >= 5) return 1;
  return 0;
};

export type StatusState = { kind: 'stack'; stacks: number } | { kind: 'duration'; turns: number };

export const statusStacks = (statuses: Partial<Record<StatusId, StatusState>>, id: StatusId): number => {
  const status = statuses[id];
  return status?.kind === 'stack' ? status.stacks : 0;
};

export const statusTurns = (statuses: Partial<Record<StatusId, StatusState>>, id: StatusId): number => {
  const status = statuses[id];
  return status?.kind === 'duration' ? status.turns : 0;
};

export interface UnitState {
  hp: number;
  maxHp: number;
  block: number;
  statuses: Partial<Record<StatusId, StatusState>>;
}

export interface PlayerState extends UnitState {
  nextDrawPenalty: number;
  // P7 D3 — 다음 턴 드로우 보너스 (턴 시작 총 드로우는 [0,8] 클램프)
  nextDrawBonus: number;
  /** v4.5 frost reservation: block granted at the start of the next player turn. */
  nextTurnBlock: number;
  // P7 D5 — 과열: 비중첩 불리언, 턴 넘어 지속, 과열 강화 스킬 해결 후 소비
  overheat: boolean;
  pendingOverheat: boolean;
  weaponOutput: number;
  nextAttackDamageBonus: number;
  endTurnBlockAoeCap: number;
  firstDamageReducedThisTurn: boolean;
  combatBreathingUsed: boolean;
  firstBurnBoostUsedThisTurn: boolean;
  burnAppliedThisTurn: boolean;
  previewDeploymentUsed: boolean;
  inverseGuardUsedThisTurn: boolean;
  crossCalculationUsedThisTurn: boolean;
  residualRebuildStored: boolean;
  commandPreservationUsedThisTurn: boolean;
  manaMembraneBlockThisTurn: number;
  blueCircuitUsedThisTurn: boolean;
  manaConsumedForResonance: number;
  remiseCharges: number;
  continuousMotionUsed: boolean;
  retrievalHabitUsed: boolean;
  balanceSenseUsed: boolean;
  lastMoveUsed: boolean;
  residualChargeUsed: boolean;
  overcurrentUsed: boolean;
  additionalPreserveThisTurn: number;
  smallChangeInsuranceUsed: boolean;
  headsSeenThisTurn: boolean;
  tailsSeenThisTurn: boolean;
  doubleEntryUsedThisTurn: boolean;
  maturedHandUsedThisTurn: boolean;
  profitSettlementUsedThisTurn: boolean;
  coldHandsUsedThisTurn: boolean;
  frostCompoundUsedThisTurn: boolean;
  refrozenLootUsedThisTurn: boolean;
  shieldMasteryUsedThisTurn: boolean;
  attackSkillUsedThisTurn: boolean;
  bloodSwordInvestment: number;
  bloodSwordPower: number;
  bloodSwordReleaseBonus: number;
  bloodSwordFirstSkillBlockUsedThisTurn: boolean;
  bloodSwordKillCoinUsedThisTurn: boolean;
  bloodSwordDiscountUsedThisTurn: boolean;
  concentratedBloodUsedThisTurn: boolean;
  redRefluxUsedThisTurn: boolean;
  residualHeatUsed: boolean;
  armorEcho: number;
  armorEchoAvailable: boolean;
  armorEchoAbsorbedThisEnemyTurn: number;
  echoPreheat: number;
  precisionDefenseArmed: boolean;
  precisionDefenseSatisfied: boolean;
  /** Skill uses from the current and immediately preceding player turn. */
  recentSkillUses: Array<{ turn: number; slot: SlotId }>;
  skillSeals: Partial<Record<number, SkillSealState>>;
  /** Coins returned from placements during this turn, keyed by slot for seal narration. */
  pendingPlacedReturns: Partial<Record<number, CoinUid[]>>;
  /** Slots with a legal player command immediately before the enemy phase. */
  usableSkillSlotsAtTurnEnd: SlotId[];
}

export interface SkillSealOwner {
  turns: number;
  effectMultiplier?: number;
  fallback?: boolean;
  sourceEnemy?: number;
}

export interface SkillSealState extends SkillSealOwner {
  /** Independent ownership prevents one sealer from replacing another. */
  owners?: SkillSealOwner[];
}

export interface CoinCustody {
  sourceEnemy: number;
  sourceEnemyUid?: number;
  coins: CoinUid[];
  element: Element;
  seizureOrder: number;
  /** A royal vault remains normal custody, with this label used for recovery UI/events. */
  kind?: 'royalVault';
}

export interface CoinSeizureTelegraph {
  element: Element;
  nominated: CoinUid[];
  handCountAtTelegraph: number;
  cap: number;
  quantity: number;
}

export interface RepeatSkillPressureState {
  lastSkillId?: SkillId;
  /** The exact equipped slot whose use armed the pending execution. */
  triggeringSlot?: SlotId;
  zeal: number;
  singleUsableResolvedUses: number;
}

export interface RoyalTaxPendingState {
  element: Element;
  paid: number;
  deadlineTurn: number;
}

export interface RoyalVaultSeizureState {
  nominated: CoinUid[];
  capacity: number;
}

export interface LeadDecreeState {
  initial: number;
  remaining: number;
  active?: true;
  weakenedThisTurn: number;
  weakenedTotal: number;
  distinctWeakenedTurn?: number;
  damageWeakenedTurn?: number;
  damageThisTurn?: number;
  damageTurn?: number;
}

export interface EnemyState extends UnitState {
  defId: EnemyDefId;
  enemyUid: number;
  slot: number;
  summonSick?: boolean;
  hatch?: { into?: EnemyDefId; turnsRemaining: number; delayed: boolean; delayAtHpFraction?: number };
  intent: EnemyIntent;
  intentIndex: number;
  nextAttackBonus: number;
  windup?: {
    intent: EnemyIntent;
    turnsLeft: number;
    startHp: number;
    cancelThreshold?: number;
    boundHealAlly?: number;
  };
  phaseIndex?: number;
  damageTakenMultiplier?: number;
  growthStacks?: number;
  roundGrowth?: EnemyRoundGrowthDef;
  damageTakenThisRound?: number;
  boundHealAlly?: number;
  cancelledWindupIntentId?: string;
  protectionLink?: { target: number; durability: number; restoreDurability: number; active: boolean; turnsUntilRestore: number; redirectFraction: number; brokenTurns: number; brokenDamageTakenMultiplier: number };
  petrifyRawDamage?: number;
  petrifyActive?: boolean;
  crackedTurns?: number;
  petrifyDamageReduction?: number;
  petrifyShatterRawDamageFraction?: number;
  petrifyCrackedDamageTakenMultiplier?: number;
  petrifyCrackedTurns?: number;
  petrifyCancelIntentId?: string;
  marchTurns?: number;
  marchShield?: number;
  marchAttackPercent?: number;
  marchSource?: number;
  warBannerAuraPercent?: number;
  deathCleanupComplete?: boolean;
  coinSeizure?: CoinSeizureTelegraph;
  repeatSkillPressure?: RepeatSkillPressureState;
  royalTaxPending?: RoyalTaxPendingState;
  royalTaxDefaultStreak?: number;
  royalTaxForeclosureElement?: Element;
  royalTaxPaidAttackReduction?: number;
  royalVaultSeizure?: RoyalVaultSeizureState;
  royalVaultRecoveredThisWindup?: number;
  leadDecree?: LeadDecreeState;
  furnaceTemperature?: number;
  furnaceMaxTemperature?: number;
  furnaceActionResolvedGain?: number;
  furnacePlayerBurnDamageGain?: number;
  furnacePlayerBurnClearLoss?: number;
  furnacePlayerDamageThreshold?: { phaseEntryHpFraction: number; loss: number };
  /** HP cap frozen at combat start and every entered phase for furnace burst thresholds. */
  furnacePhaseEntryHp?: number;
  furnaceActionResolvedTurn?: number;
  furnacePlayerBurnDamageTurn?: number;
  furnacePlayerBurnClearTurn?: number;
  furnacePlayerDamageThresholdTurn?: number;
  furnacePlayerDamageTurn?: number;
  furnacePlayerDamageThisTurn?: number;
  vassalGuard?: { sourceEnemyUid: number; damageReductionPercent: number; maxSources: number };
}

// P7 D1/D2 — usedThisTurn(턴당 1회) 폐지 → cooldownRemaining(0=가용, 턴 시작 감소).
// skillId null = 빈 슬롯 (기본 최대 8슬롯, 시작 4스킬).
export interface SlotState {
  skillId: SkillId | null;
  cooldownRemaining: number;
  usedThisCombat: boolean;
}

export interface TurnTriggerInstance {
  uid: number;
  trigger: TurnTriggerDef;
}

export interface CombatZones {
  draw: CoinUid[];
  hand: CoinUid[];
  placed: Record<SlotId, CoinUid[]>;
  discard: CoinUid[];
  exhausted: CoinUid[];
}

/** A completed flip package whose identity survives later draft changes. */
export interface FlipReservation {
  id: string;
  slot: SlotId;
  coinUids: CoinUid[];
}

export interface CombatState {
  turn: number;
  phase: 'player' | 'enemy' | 'victory' | 'defeat';
  player: PlayerState;
  enemies: EnemyState[];
  coins: Record<number, CoinInstance>;
  zones: CombatZones;
  flipReservations: FlipReservation[];
  nextFlipReservationId: number;
  slots: SlotState[];
  turnTriggers: TurnTriggerInstance[];
  rng: { flip: RngSnapshot; shuffle: RngSnapshot; ai: RngSnapshot };
  rngImpl?: { flip?: Rng; shuffle?: Rng; ai?: Rng };
  nextUid: number;
  nextTurnTriggerUid: number;
  // P6 — 훅 실행 컨텍스트(리듀서가 매 턴 참조)와 막별 적 스케일. 전투는 저장 대상이
  // 아니며 런 상태에서 결정론 재구성된다.
  characterId: CharacterId;
  passives: PassiveId[];
  enemyScale: number;
  // Battle-only targeting memory. Discharge suppression uses it to break ties
  // without introducing another persistent run-state field.
  lastTargetedEnemy: number | null;
  // P6 D6 — 소환 장비 슬롯 (최대 3, 배열 순서 = 소환 순서 = 행동 순서)
  summons: SummonState[];
  nextSummonUid: number;
  events: CombatEvent[];
  /** A combat-only coin zone. Every custody coin is absent from ordinary zones. */
  custody: CoinCustody[];
}

export const activeSkillSeal = (state: CombatState, slot: SlotId): SkillSealState | undefined => {
  const seal = state.player.skillSeals[Number(slot)];
  return seal !== undefined && seal.turns > 0 ? seal : undefined;
};

export const skillSealOwners = (seal: SkillSealState): SkillSealOwner[] =>
  seal.owners === undefined ? [{ turns: seal.turns, effectMultiplier: seal.effectMultiplier, fallback: seal.fallback, sourceEnemy: seal.sourceEnemy }] : seal.owners;

export const aggregateSkillSeal = (owners: readonly SkillSealOwner[]): SkillSealState | undefined => {
  const active = owners.filter((owner) => owner.turns > 0).map((owner) => ({ ...owner }));
  if (active.length === 0) return undefined;
  const allReduced = active.every((owner) => owner.effectMultiplier !== undefined);
  const sourceEnemy = active.length === 1 ? active[0]?.sourceEnemy : undefined;
  return {
    turns: Math.max(...active.map((owner) => owner.turns)),
    ...(allReduced ? { effectMultiplier: Math.min(...active.map((owner) => owner.effectMultiplier ?? 1)), fallback: true } : {}),
    ...(sourceEnemy === undefined ? {} : { sourceEnemy }),
    owners: active
  };
};

export const isSkillCommandSealed = (state: CombatState, slot: SlotId): boolean => {
  const seal = activeSkillSeal(state, slot);
  return seal !== undefined && seal.effectMultiplier === undefined;
};

export const recordRecentSkillUse = (state: CombatState, slot: SlotId): CombatState => {
  const recentSkillUses = [...state.player.recentSkillUses.filter((use) => use.turn >= state.turn - 1), { turn: state.turn, slot }];
  return {
    ...state,
    player: { ...state.player, recentSkillUses }
  };
};

export interface SummonState {
  uid: number;
  defId: EquipmentDefId;
  duration: number;
  enhance: number;
  aoeUses: number;
}

export const clonePlaced = (placed: Record<SlotId, CoinUid[]>): Record<SlotId, CoinUid[]> => {
  const result: Partial<Record<SlotId, CoinUid[]>> = {};
  for (const [key, coins] of Object.entries(placed)) {
    result[Number(key) as SlotId] = [...coins];
  }
  return result as Record<SlotId, CoinUid[]>;
};

export const cloneState = (state: CombatState): CombatState => ({
  ...state,
  player: {
    ...state.player,
    statuses: { ...state.player.statuses },
    recentSkillUses: state.player.recentSkillUses.map((use) => ({ ...use })),
    skillSeals: Object.fromEntries(
      Object.entries(state.player.skillSeals).map(([slot, seal]) => [
        slot,
        seal === undefined ? seal : { ...seal, owners: seal.owners?.map((owner) => ({ ...owner })) }
      ])
    ),
    pendingPlacedReturns: Object.fromEntries(
      Object.entries(state.player.pendingPlacedReturns).map(([slot, coins]) => [slot, [...(coins ?? [])]])
    ),
    usableSkillSlotsAtTurnEnd: [...state.player.usableSkillSlotsAtTurnEnd]
  },
  enemies: state.enemies.map((enemy) => ({
    ...enemy,
    statuses: { ...enemy.statuses },
    windup: enemy.windup === undefined ? undefined : { ...enemy.windup },
    protectionLink: enemy.protectionLink === undefined ? undefined : { ...enemy.protectionLink }
  })),
  coins: Object.fromEntries(Object.entries(state.coins).map(([uid, coin]) => [uid, { ...coin, grants: [...coin.grants] }])),
  zones: {
    draw: [...state.zones.draw],
    hand: [...state.zones.hand],
    placed: clonePlaced(state.zones.placed),
    discard: [...state.zones.discard],
    exhausted: [...state.zones.exhausted]
  },
  flipReservations: state.flipReservations.map((reservation) => ({ ...reservation, coinUids: [...reservation.coinUids] })),
  slots: state.slots.map((slot) => ({ ...slot })),
  turnTriggers: state.turnTriggers.map((trigger) => ({
    ...trigger,
    trigger: { ...trigger.trigger, effects: [...trigger.trigger.effects] }
  })),
  rng: {
    flip: { s: [...state.rng.flip.s] as [number, number, number, number] },
    shuffle: { s: [...state.rng.shuffle.s] as [number, number, number, number] },
    ai: { s: [...state.rng.ai.s] as [number, number, number, number] }
  },
  rngImpl: state.rngImpl,
  events: [...state.events],
  custody: state.custody.map((entry) => ({ ...entry, coins: [...entry.coins] }))
});

/** Throws if a coin is absent from, or duplicated across, combat-local zones. */
export const assertCombatCoinZoneInvariant = (state: CombatState): void => {
  if (state.custody.some((entry) => entry.coins.some((coin) => state.coins[Number(coin)]?.counterfeit === true))) {
    throw new Error('counterfeit coin cannot enter custody');
  }
  const locations = [
    ...state.zones.draw,
    ...state.zones.hand,
    ...Object.values(state.zones.placed).flat(),
    ...state.zones.discard,
    ...state.zones.exhausted,
    ...state.flipReservations.flatMap((reservation) => reservation.coinUids),
    ...state.custody.flatMap((entry) => entry.coins)
  ];
  if (new Set(state.flipReservations.map((reservation) => reservation.id)).size !== state.flipReservations.length) {
    throw new Error('flip reservation ids must be unique');
  }
  if (locations.length !== Object.keys(state.coins).length || new Set(locations).size !== locations.length) {
    throw new Error('combat coin zone invariant violated');
  }
};
