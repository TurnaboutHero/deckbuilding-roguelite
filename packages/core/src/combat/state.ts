import type { CoinInstance, EnemyIntent, StatusId, TurnTriggerDef } from '../content-types';
import type { CharacterId, PassiveId, EquipmentDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import type { CombatEvent } from './events';

// P7 D2 — 기본 최대 장착 슬롯 (단일 정본 — reducer/run/types/저장 검증이 모두 이 상수를 쓴다)
export const MAX_SKILL_SLOTS = 8;

export type StatusState =
  | { kind: 'stack'; stacks: number }
  | { kind: 'duration'; turns: number };

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
  // P7 D5 — 과열: 비중첩 불리언, 턴 넘어 지속, 과열 강화 스킬 해결 후 소비
  overheat: boolean;
  weaponOutput: number;
  remiseCharges: number;
  continuousMotionUsed: boolean;
  retrievalHabitUsed: boolean;
  balanceSenseUsed: boolean;
  lastMoveUsed: boolean;
  residualChargeUsed: boolean;
  overcurrentUsed: boolean;
}

export interface EnemyState extends UnitState {
  defId: EnemyDefId;
  intent: EnemyIntent;
  intentIndex: number;
  nextAttackBonus: number;
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

export interface CombatState {
  turn: number;
  phase: 'player' | 'enemy' | 'victory' | 'defeat';
  player: PlayerState;
  enemies: EnemyState[];
  coins: Record<number, CoinInstance>;
  zones: CombatZones;
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
}

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
  player: { ...state.player, statuses: { ...state.player.statuses } },
  enemies: state.enemies.map((enemy) => ({ ...enemy, statuses: { ...enemy.statuses } })),
  coins: Object.fromEntries(Object.entries(state.coins).map(([uid, coin]) => [uid, { ...coin, grants: [...coin.grants] }])),
  zones: {
    draw: [...state.zones.draw],
    hand: [...state.zones.hand],
    placed: clonePlaced(state.zones.placed),
    discard: [...state.zones.discard],
    exhausted: [...state.zones.exhausted]
  },
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
  events: [...state.events]
});
