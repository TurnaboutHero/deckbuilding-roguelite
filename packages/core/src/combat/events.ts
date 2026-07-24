import type { EnemyFurnaceReason, EnemyIntent, StatusId, TargetRef } from '../content-types';
import type { CoinEnchantId, CoinUid, Element, Face, SkillId, SlotId } from '../ids';

export type DamageSource = 'skill' | 'coin' | 'fixed' | 'burn' | 'poison' | 'enemy' | 'self';

export type CombatEvent =
  | { type: 'coinsDrawn'; coins: CoinUid[] }
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
  | { type: 'enemyFurnaceChanged'; enemy: number; before: number; after: number; reason: EnemyFurnaceReason }
  | { type: 'enemySummonTelegraphed'; sourceEnemyUid: number; enemy: string; maxCount: number }
  | { type: 'enemySummoned'; sourceEnemyUid: number; enemy: string; slot: number; enemyUid: number }
  | { type: 'enemySummonFailed'; sourceEnemyUid: number; enemy: string; maxCount: number }
  | { type: 'enemyHatchDelayed'; sourceEnemyUid: number }
  | { type: 'enemyHatched'; sourceEnemyUid: number; into: string }
  | { type: 'enemyHatchAccelerated'; sourceEnemyUid: number; targetEnemyUid: number; amount: number }
  | { type: 'enemyRemoved'; enemyUid: number; reason: 'killed' }
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
  | { type: 'repeatSkillZealChanged'; sourceEnemy: number; skill: SkillId; zeal: number; maxZeal: number }
  | { type: 'repeatSkillZealReset'; sourceEnemy: number }
  | { type: 'royalTaxOpened'; sourceEnemy: number; element: Element; denomination: number; deadlineTurn: number }
  | { type: 'royalTaxPaymentProgressed'; sourceEnemy: number; element: Element; paid: number; denomination: number }
  | { type: 'royalTaxPaid'; sourceEnemy: number; element: Element; paid: number; denomination: number }
  | { type: 'royalTaxDefaulted'; sourceEnemy: number; element: Element; paid: number; denomination: number; counterfeits: CoinUid[]; shield: number; defaultStreak: number }
  | { type: 'royalTaxSeizureScheduled'; sourceEnemy: number; intent: EnemyIntent }
  | { type: 'royalVaultForeclosed'; sourceEnemy: number; sourceEnemyUid: number; element: Element; nominated: CoinUid[]; capacity: number }
  | { type: 'royalVaultSeized'; sourceEnemy: number; sourceEnemyUid: number; coins: CoinUid[]; elements: Array<{ coin: CoinUid; element: Element }>; before: number; after: number; seizureOrder: number }
  | { type: 'royalVaultReturned'; sourceEnemy: number; sourceEnemyUid: number; coin: CoinUid; before: number; after: number; reason: 'skillRecovery' | 'phaseEntry' | 'crownCancelled' | 'crownResolved' }
  | { type: 'royalVaultRecoveryProgressed'; sourceEnemy: number; sourceEnemyUid: number; recovered: number; required?: number }
  | { type: 'leadDecreeStarted'; sourceEnemy: number; sourceEnemyUid: number; initial: number; remaining: number }
  | { type: 'leadDecreeWeakened'; sourceEnemy: number; sourceEnemyUid: number; before: number; after: number; reason: 'distinctElements' | 'skillDamage' }
  | { type: 'leadCoinTransformed'; sourceEnemy: number; sourceEnemyUid: number; coin: CoinUid; before: string; after: string }
  | { type: 'leadCoinsCleared'; sourceEnemy: number; sourceEnemyUid: number; coins: CoinUid[]; transformed: Array<{ coin: CoinUid; before: string; after: string }> }
  | { type: 'leadCoinsExhausted'; coins: CoinUid[] }
  | { type: 'counterfeitExhausted'; coin: CoinUid }
  | { type: 'counterfeitsRemoved'; coins: CoinUid[] }
  | { type: 'counterfeitsCreated'; coins: CoinUid[]; defId: string }
  | { type: 'turnStarted'; turn: number }
  | { type: 'combatEnded'; result: 'victory' | 'defeat'; turns: number };
