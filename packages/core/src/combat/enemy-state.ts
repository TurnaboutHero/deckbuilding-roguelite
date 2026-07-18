import type { ContentDb } from '../content-types';
import type { EnemyDefId } from '../ids';
import type { EnemyState } from './state';

export const MAX_ENEMY_SLOTS = 3;

export interface EnemyStateOptions {
  enemyScale?: number;
  enemyUid: number;
  slot: number;
  summonSick?: boolean;
  statuses?: EnemyState['statuses'];
}

/** Builds every runtime enemy from a definition so entrants and transforms share the same invariants. */
export const createEnemyState = (defId: EnemyDefId, db: ContentDb, options: EnemyStateOptions): EnemyState => {
  const def = db.enemies[String(defId)];
  if (def === undefined) throw new Error(`unknown enemy: ${String(defId)}`);
  const intent = def.intents[0];
  if (intent === undefined) throw new Error('enemy has no initial intent');
  const enemyScale = options.enemyScale ?? 1;
  const maxHp = Math.round(def.maxHp * enemyScale);
  return {
    defId,
    enemyUid: options.enemyUid,
    slot: options.slot,
    summonSick: options.summonSick,
    hp: maxHp,
    maxHp,
    block: 0,
    statuses: { ...(options.statuses ?? {}) },
    intent,
    intentIndex: 0,
    nextAttackBonus: 0,
    ...(def.hatch === undefined ? {} : { hatch: { into: def.hatch.into, turnsRemaining: def.hatch.turns, delayed: false, delayAtHpFraction: def.hatch.delayAtHpFraction } }),
    ...(def.petrify === undefined ? {} : {
      petrifyDamageReduction: def.petrify.damageReduction,
      petrifyShatterRawDamageFraction: def.petrify.shatterRawDamageFraction,
      petrifyCrackedDamageTakenMultiplier: def.petrify.crackedDamageTakenMultiplier,
      petrifyCrackedTurns: def.petrify.crackedTurns,
      petrifyCancelIntentId: def.petrify.cancelWindupIntentId
    }),
    ...(def.warBanner === undefined ? {} : { warBannerAuraPercent: def.warBanner.attackAuraPercent }),
    ...(def.roundGrowth === undefined ? {} : { roundGrowth: def.roundGrowth, growthStacks: 0, damageTakenThisRound: 0 })
  };
};
