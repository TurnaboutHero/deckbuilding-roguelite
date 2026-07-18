import type { ContentDb, EnemyAction, EnemyCancelPredicate, EnemyFurnaceReason } from '../content-types';
import { resetRepeatSkillPressure } from './directive15';
import { returnOldestRoyalVaultCoin } from './directive18';
import type { CombatEvent } from './events';
import type { CombatState, EnemyState } from './state';

const withEnemy = (state: CombatState, enemyIndex: number, update: (enemy: EnemyState) => EnemyState): CombatState => ({
  ...state,
  enemies: state.enemies.map((enemy, index) => (index === enemyIndex ? update(enemy) : enemy))
});

const predicatesFor = (predicate: EnemyCancelPredicate | readonly EnemyCancelPredicate[] | undefined): readonly EnemyCancelPredicate[] =>
  predicate === undefined ? [] : 'kind' in predicate ? [predicate] : predicate;

const resourceCancelMatches = (enemy: EnemyState): boolean => predicatesFor(enemy.windup?.intent.cancelOn).some((predicate) =>
  (predicate.kind === 'enemyResourceAtMost' && predicate.resource === 'furnaceTemperature' && (enemy.furnaceTemperature ?? 0) <= predicate.value) ||
  (predicate.kind === 'vaultCoinsRecovered' && (enemy.royalVaultRecoveredThisWindup ?? 0) >= predicate.count)
);

export const skillDamageCancelMatches = (enemy: EnemyState, nextHp: number): boolean => predicatesFor(enemy.windup?.intent.cancelOn).some((predicate) =>
  predicate.kind === 'skillDamage' && enemy.windup !== undefined && Math.max(0, enemy.windup.startHp - nextHp) >= predicate.threshold
);

const applyCancelAction = (state: CombatState, enemyIndex: number, action: EnemyAction, events: CombatEvent[]): CombatState => {
  if (action.kind === 'setEnemyResource' && action.resource === 'furnaceTemperature') {
    return setFurnaceTemperature(state, enemyIndex, action.value, action.reason, events);
  }
  if (action.kind === 'adjustEnemyResource' && action.resource === 'furnaceTemperature') {
    const current = state.enemies[enemyIndex]?.furnaceTemperature ?? 0;
    return setFurnaceTemperature(state, enemyIndex, current + action.amount, action.reason, events);
  }
  if (action.kind === 'reduceGrowthStacks') {
    return withEnemy(state, enemyIndex, (enemy) => ({ ...enemy, growthStacks: Math.max(0, (enemy.growthStacks ?? 0) - action.amount) }));
  }
  if (action.kind === 'returnOldestRoyalVaultCoin') {
    return returnOldestRoyalVaultCoin(state, enemyIndex, events, action.reason ?? 'crownCancelled');
  }
  throw new Error(`windup cancel action ${action.kind} is not supported`);
};

export const cancelWindupIfNeeded = (state: CombatState, enemyIndex: number, events: CombatEvent[], force = false): CombatState => {
  const enemy = state.enemies[enemyIndex];
  if (enemy?.windup === undefined || (!force && !resourceCancelMatches(enemy))) return state;
  const intent = enemy.windup.intent;
  events.push({ type: 'enemyWindupCancelled', enemy: enemyIndex, intent });
  let next = withEnemy(state, enemyIndex, (candidate) => ({
    ...candidate,
    windup: undefined,
    boundHealAlly: undefined,
    cancelledWindupIntentId: intent.id
  }));
  next = resetRepeatSkillPressure(next, enemyIndex, events);
  for (const action of intent.onCancelActions ?? []) next = applyCancelAction(next, enemyIndex, action, events);
  return next;
};

/** Applies a bounded furnace mutation and immediately re-evaluates resource windup cancellation. */
export const setFurnaceTemperature = (state: CombatState, enemyIndex: number, requested: number, reason: EnemyFurnaceReason, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  if (enemy === undefined || enemy.furnaceMaxTemperature === undefined || enemy.furnaceTemperature === undefined) return state;
  const before = enemy.furnaceTemperature;
  const after = Math.max(0, Math.min(enemy.furnaceMaxTemperature, requested));
  const next = after === before ? state : withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, furnaceTemperature: after }));
  if (after !== before) events.push({ type: 'enemyFurnaceChanged', enemy: enemyIndex, before, after, reason });
  return cancelWindupIfNeeded(next, enemyIndex, events);
};

const canApplyOnceThisTurn = (enemy: EnemyState, marker: keyof EnemyState, turn: number): boolean => enemy[marker] !== turn;

export const applyFurnaceActionResolved = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const gain = enemy === undefined ? undefined : db.enemies[String(enemy.defId)]?.furnace?.actionResolvedGain;
  if (enemy === undefined || gain === undefined || !canApplyOnceThisTurn(enemy, 'furnaceActionResolvedTurn', state.turn)) return state;
  const marked = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, furnaceActionResolvedTurn: state.turn }));
  return setFurnaceTemperature(marked, enemyIndex, (marked.enemies[enemyIndex]?.furnaceTemperature ?? 0) + gain, 'enemyActionResolved', events);
};

export const applyFurnacePlayerBurnDamage = (state: CombatState, events: CombatEvent[]): CombatState => {
  let next = state;
  for (let index = 0; index < next.enemies.length; index += 1) {
    const enemy = next.enemies[index];
    const gain = enemy?.furnacePlayerBurnDamageGain;
    if (enemy === undefined || enemy.hp <= 0 || gain === undefined || !canApplyOnceThisTurn(enemy, 'furnacePlayerBurnDamageTurn', next.turn)) continue;
    next = withEnemy(next, index, (candidate) => ({ ...candidate, furnacePlayerBurnDamageTurn: next.turn }));
    next = setFurnaceTemperature(next, index, (next.enemies[index]?.furnaceTemperature ?? 0) + gain, 'playerBurnDamaged', events);
  }
  return next;
};

export const applyFurnacePlayerBurnClear = (state: CombatState, events: CombatEvent[]): CombatState => {
  let next = state;
  for (let index = 0; index < next.enemies.length; index += 1) {
    const enemy = next.enemies[index];
    const loss = enemy === undefined ? undefined : dbFurnaceLoss(enemy);
    if (enemy === undefined || enemy.hp <= 0 || loss === undefined || !canApplyOnceThisTurn(enemy, 'furnacePlayerBurnClearTurn', next.turn)) continue;
    next = withEnemy(next, index, (candidate) => ({ ...candidate, furnacePlayerBurnClearTurn: next.turn }));
    next = setFurnaceTemperature(next, index, (next.enemies[index]?.furnaceTemperature ?? 0) - loss, 'playerBurnCleared', events);
  }
  return next;
};

const dbFurnaceLoss = (enemy: EnemyState): number | undefined => enemy.furnacePlayerBurnClearLoss;

export const applyFurnacePlayerDamageThreshold = (state: CombatState, enemyIndex: number, hpDamage: number, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const rule = enemy?.furnacePlayerDamageThreshold;
  if (enemy === undefined || rule === undefined) return state;
  const hpDamageThisTurn = (enemy.furnacePlayerDamageTurn === state.turn ? enemy.furnacePlayerDamageThisTurn ?? 0 : 0) + hpDamage;
  const accumulated = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, furnacePlayerDamageTurn: state.turn, furnacePlayerDamageThisTurn: hpDamageThisTurn }));
  if (!canApplyOnceThisTurn(enemy, 'furnacePlayerDamageThresholdTurn', state.turn)) return accumulated;
  const threshold = Math.ceil((enemy.furnacePhaseEntryHp ?? enemy.maxHp) * rule.phaseEntryHpFraction);
  if (hpDamageThisTurn < threshold) return accumulated;
  const marked = withEnemy(accumulated, enemyIndex, (candidate) => ({ ...candidate, furnacePlayerDamageThresholdTurn: state.turn }));
  return setFurnaceTemperature(marked, enemyIndex, (marked.enemies[enemyIndex]?.furnaceTemperature ?? 0) - rule.loss, 'playerDamageThreshold', events);
};
