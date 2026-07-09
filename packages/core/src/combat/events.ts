import type { EnemyIntent, StatusId, TargetRef } from '../content-types';
import type { CoinUid, Element, Face, SkillId, SlotId } from '../ids';

export type CombatEvent =
  | { type: 'coinsDrawn'; coins: CoinUid[] }
  | { type: 'coinPlaced'; coin: CoinUid; slot: SlotId }
  | { type: 'coinUnplaced'; coin: CoinUid; slot: SlotId }
  | { type: 'coinFlipped'; coin: CoinUid; face: Face }
  | { type: 'skillUsed'; slot: SlotId; skill: SkillId; kind: 'flip' | 'consume' }
  | {
      type: 'damageDealt';
      target: TargetRef;
      amount: number;
      blocked: number;
      source: 'skill' | 'burn' | 'enemy' | 'self';
    }
  | { type: 'blockGained'; target: TargetRef; amount: number }
  | { type: 'blockCleared'; target: TargetRef; amount: number }
  | { type: 'statusApplied'; target: TargetRef; status: StatusId; stacks: number }
  | { type: 'statusTicked'; target: TargetRef; status: StatusId; amount: number; remaining: number }
  | { type: 'coinCreated'; coin: CoinUid; defId: string; zone: 'draw' | 'discard' | 'hand' }
  | { type: 'coinsConsumed'; coins: CoinUid[] }
  | { type: 'elementGranted'; coins: CoinUid[]; element: Element }
  | { type: 'intentRevealed'; enemy: number; intent: EnemyIntent }
  | { type: 'turnStarted'; turn: number }
  | { type: 'combatEnded'; result: 'victory' | 'defeat'; turns: number };
