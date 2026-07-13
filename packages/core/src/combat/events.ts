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
  // P7 — 회복(D4)·쿨다운 감소(D1)·과열(D5)
  | { type: 'healed'; target: TargetRef; amount: number; hp: number }
  | { type: 'cooldownReduced'; slots: number[]; amount: number }
  | { type: 'overheatEntered' }
  | { type: 'overheatConsumed'; skill: SkillId }
  | { type: 'remiseChecked'; coin: CoinUid; face: Face }
  | { type: 'remiseReflipped'; coin: CoinUid; face: Face }
  | { type: 'remiseReused'; skill: SkillId }
  | { type: 'weaponOutputChanged'; amount: number; value: number }
  | { type: 'statusApplied'; target: TargetRef; status: StatusId; stacks: number; turns?: number }
  | { type: 'statusTicked'; target: TargetRef; status: StatusId; amount: number; remaining: number; turns?: number }
  | { type: 'coinCreated'; coin: CoinUid; defId: string; zone: 'draw' | 'discard' | 'hand' }
  | { type: 'traitTriggered'; trait: string }
  | { type: 'passiveTriggered'; passive: string }
  | { type: 'summonAdded'; uid: number; equipment: string; duration: number }
  | { type: 'summonReplaced'; uid: number; equipment: string }
  | { type: 'summonActed'; uid: number; equipment: string; bonus: number }
  | { type: 'summonExpired'; uid: number; equipment: string }
  | { type: 'summonCloned'; sourceUid: number; uid: number; equipment: string }
  | { type: 'summonAoeGranted'; uid: number; uses: number }
  | { type: 'turnTriggerAdded'; trigger: string }
  | { type: 'turnTriggerFired'; trigger: string; hook: string }
  | { type: 'turnTriggersExpired'; count: number }
  | { type: 'coinsDiscarded'; coins: CoinUid[]; reason: 'skillCost' | 'turnEnd' }
  | { type: 'coinsConsumed'; coins: CoinUid[] }
  | { type: 'pileShuffled'; count: number }
  | { type: 'elementGranted'; coins: CoinUid[]; element: Element }
  | { type: 'witherApplied'; enemy: number; amount: number; nextDrawPenalty: number }
  | { type: 'enemyHealed'; enemy: number; amount: number; hp: number }
  | { type: 'enemyPassiveTriggered'; enemy: number; passive: string }
  | { type: 'enemyAttackBuffed'; enemy: number; amount: number; nextAttackBonus: number }
  | { type: 'intentRevealed'; enemy: number; intent: EnemyIntent }
  | { type: 'turnStarted'; turn: number }
  | { type: 'combatEnded'; result: 'victory' | 'defeat'; turns: number };
