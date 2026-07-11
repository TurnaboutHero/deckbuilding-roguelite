import type { CoinInstance, EnemyIntent, StatusId, TurnTriggerDef } from '../content-types';
import type { CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import type { Rng, RngSnapshot } from '../rng';
import type { CombatEvent } from './events';

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
}

export interface EnemyState extends UnitState {
  defId: EnemyDefId;
  intent: EnemyIntent;
  intentIndex: number;
  nextAttackBonus: number;
}

export interface SlotState {
  skillId: SkillId;
  usedThisTurn: boolean;
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
  skillUsesThisTurn: number;
  rng: { flip: RngSnapshot; shuffle: RngSnapshot; ai: RngSnapshot };
  rngImpl?: { flip?: Rng; shuffle?: Rng; ai?: Rng };
  nextUid: number;
  nextTurnTriggerUid: number;
  events: CombatEvent[];
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
