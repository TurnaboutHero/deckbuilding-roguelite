import type { EnemyIntent, StatusId, TargetRef } from '../content-types';
import type { CoinEnchantId, CoinUid, Element, Face, SkillId, SlotId } from '../ids';

export type DamageSource = 'skill' | 'coin' | 'burn' | 'poison' | 'enemy' | 'self';

export type CombatEvent =
  | { type: 'coinsDrawn'; coins: CoinUid[] }
  | { type: 'coinPlaced'; coin: CoinUid; slot: SlotId }
  | { type: 'coinUnplaced'; coin: CoinUid; slot: SlotId }
  | { type: 'coinFlipped'; coin: CoinUid; face: Face }
  | {
      type: 'enchantTriggered';
      coin: CoinUid;
      enchant: CoinEnchantId;
      effect: 'face' | 'damage' | 'return';
    }
  | { type: 'resonanceTriggered'; skill: SkillId; element: Element }
  | { type: 'skillUsed'; slot: SlotId; skill: SkillId; kind: 'flip' | 'consume' }
  | {
      type: 'damageDealt';
      target: TargetRef;
      amount: number;
      blocked: number;
      source: DamageSource;
    }
  | { type: 'bloodCoinFizzle'; coin: CoinUid }
  | { type: 'blockGained'; target: TargetRef; amount: number }
  | { type: 'blockCleared'; target: TargetRef; amount: number }
  // P7 — 회복(D4)·쿨다운 감소(D1)·과열(D5)
  | { type: 'healed'; target: TargetRef; amount: number; hp: number }
  | { type: 'healPrevented'; target: { type: 'player' }; amount: number; reason: 'healLock' }
  | { type: 'cooldownReduced'; slots: number[]; amount: number }
  | { type: 'overheatEntered' }
  | { type: 'overheatScheduled' }
  | { type: 'overheatActivated' }
  | { type: 'overheatConsumed'; skill: SkillId }
  | { type: 'echoComputed'; base: number; preheat: number; precision: number; total: number }
  | { type: 'echoSpent'; skill: SkillId; amount: number }
  | { type: 'remiseGained'; amount: number; total: number }
  | { type: 'remiseSpent'; skill: SkillId; firstFace: Face; repeat: boolean; remaining: number }
  | { type: 'remiseRepeatResolved'; skill: SkillId }
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
  | { type: 'coinsPreserved'; coins: CoinUid[] }
  | { type: 'pileShuffled'; count: number }
  | { type: 'elementGranted'; coins: CoinUid[]; element: Element }
  | { type: 'witherApplied'; enemy: number; amount: number; nextDrawPenalty: number }
  | { type: 'enemyHealed'; enemy: number; amount: number; hp: number }
  | { type: 'enemyPassiveTriggered'; enemy: number; passive: string }
  | { type: 'enemyAttackBuffed'; enemy: number; amount: number; nextAttackBonus: number }
  | { type: 'intentRevealed'; enemy: number; intent: EnemyIntent }
  | { type: 'enemyWindupStarted'; enemy: number; intent: EnemyIntent; turnsLeft: number; cancelThreshold?: number }
  | { type: 'enemyWindupTicked'; enemy: number; intent: EnemyIntent; turnsLeft: number }
  | { type: 'enemyWindupCancelled'; enemy: number; intent: EnemyIntent }
  | { type: 'enemyPhaseChanged'; enemy: number }
  | { type: 'enemyGrew'; enemy: number; stacks: number }
  | { type: 'enemyGrowthReduced'; enemy: number; removed: number; stacks: number; damage: number; threshold: number }
  | { type: 'playerTurnEndPunished'; enemy: number; coinCount: number; threshold: number; status: StatusId; stacks: number }
  | { type: 'enemyCleansed'; enemy: number; statuses: StatusId[] }
  | { type: 'enemyHealFailed'; enemy: number; target: number }
  | { type: 'damageRedirected'; protector: number; protected: number; amount: number }
  | { type: 'protectionLinkRemoved'; protector: number; protected: number }
  | { type: 'protectionLinkBroken'; protector: number; protected: number; turns: number }
  | { type: 'petrifyProgressed'; enemy: number; rawDamage: number; threshold: number }
  | { type: 'petrifyShattered'; enemy: number; rawDamage: number }
  | { type: 'enemyAuraApplied'; source: number; target: number; percent: number }
  | { type: 'enemyAuraRemoved'; source: number }
  | { type: 'enemyMarchRemoved'; source: number; target: number }
  | { type: 'coinSeizureTelegraphed'; sourceEnemy: number; element: Element; nominated: CoinUid[]; handCountAtTelegraph: number; cap: number; quantity: number }
  | { type: 'coinsSeized'; sourceEnemy: number; coins: CoinUid[]; element: Element; seizureOrder: number }
  | { type: 'coinsReturned'; sourceEnemy: number; coins: CoinUid[] }
  | { type: 'skillSealed'; sourceEnemy: number; slot: SlotId; turns: number }
  | { type: 'skillSealFallbackReduced'; sourceEnemy: number; slot: SlotId; multiplier: number; turns: number }
  | { type: 'placedCoinsReturned'; slot: SlotId; coins: CoinUid[]; reason: 'skillSeal' }
  | { type: 'skillSealRepeatStruck'; sourceEnemy: number; damage: number }
  | { type: 'turnStarted'; turn: number }
  | { type: 'combatEnded'; result: 'victory' | 'defeat'; turns: number };
