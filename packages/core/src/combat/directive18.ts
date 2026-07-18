import { effectiveElements } from '../content-types';
import type { ContentDb, EnemyAction } from '../content-types';
import type { CoinUid, Element } from '../ids';
import type { CombatEvent } from './events';
import type { CoinCustody, CombatState, EnemyState } from './state';

const withEnemy = (state: CombatState, enemyIndex: number, update: (enemy: EnemyState) => EnemyState): CombatState => ({
  ...state,
  enemies: state.enemies.map((enemy, index) => index === enemyIndex ? update(enemy) : enemy)
});

const sourceUid = (state: CombatState, enemyIndex: number): number => state.enemies[enemyIndex]?.enemyUid ?? enemyIndex + 1;
const vaultEntries = (state: CombatState, enemyIndex: number): CoinCustody[] => {
  const uid = sourceUid(state, enemyIndex);
  return state.custody.filter((entry) => entry.kind === 'royalVault' && entry.sourceEnemyUid === uid);
};
export const royalVaultCoinCount = (state: CombatState, enemyIndex: number): number =>
  vaultEntries(state, enemyIndex).reduce((total, entry) => total + entry.coins.length, 0);

const isEligible = (state: CombatState, db: ContentDb, coin: CoinUid): boolean => {
  const instance = state.coins[Number(coin)];
  return instance !== undefined && instance.counterfeit !== true && instance.lead !== true && effectiveElements(instance, db).length > 0;
};

const oldestVaultCoin = (state: CombatState, enemyIndex: number, element?: Element): { entry: CoinCustody; coin: CoinUid } | undefined =>
  vaultEntries(state, enemyIndex)
    .sort((left, right) => left.seizureOrder - right.seizureOrder)
    .flatMap((entry) => entry.coins.map((coin) => ({ entry, coin })))
    .find(({ entry }) => element === undefined || entry.element === element);

export const returnOldestRoyalVaultCoin = (
  state: CombatState,
  enemyIndex: number,
  events: CombatEvent[],
  reason: 'skillRecovery' | 'phaseEntry' | 'crownCancelled' | 'crownResolved',
  element?: Element
): CombatState => {
  const selected = oldestVaultCoin(state, enemyIndex, element);
  if (selected === undefined) return state;
  const before = royalVaultCoinCount(state, enemyIndex);
  const custody = state.custody.flatMap((entry) => {
    if (entry !== selected.entry) return [entry];
    const coins = entry.coins.filter((coin) => coin !== selected.coin);
    return coins.length === 0 ? [] : [{ ...entry, coins }];
  });
  const next = { ...state, custody, zones: { ...state.zones, discard: [...state.zones.discard, selected.coin] } };
  events.push({ type: 'royalVaultReturned', sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), coin: selected.coin, before, after: before - 1, reason });
  return next;
};

const setVaultSeizure = (state: CombatState, enemyIndex: number, nominated: CoinUid[], capacity: number, events: CombatEvent[], element: Element): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const vault = enemy === undefined ? undefined : undefined;
  void vault;
  if (nominated.length === 0 || capacity === 0) return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, royalVaultSeizure: undefined }));
  events.push({ type: 'royalVaultForeclosed', sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), element, nominated, capacity });
  return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, royalVaultSeizure: { nominated, capacity } }));
};

/** Freezes hand UIDs only.  It is intentionally reusable by tax and phase-three actions. */
export const forecloseRoyalVault = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  const element = enemy?.royalTaxForeclosureElement;
  const maxCoins = def?.royalTax?.foreclosureMaxCoins ?? 1;
  if (enemy === undefined || def?.royalVault === undefined || element === undefined) return state;
  const capacity = Math.max(0, def.royalVault.capacity - royalVaultCoinCount(state, enemyIndex));
  const nominated = state.zones.hand.filter((coin) => isEligible(state, db, coin) && effectiveElements(state.coins[Number(coin)]!, db).includes(element)).slice(0, Math.min(maxCoins, capacity));
  const base = setVaultSeizure(state, enemyIndex, nominated, capacity, events, element);
  return withEnemy(base, enemyIndex, (candidate) => ({ ...candidate, royalTaxForeclosureElement: undefined }));
};

export const nominateExactRoyalVaultSeizure = (state: CombatState, enemyIndex: number, maxCoins: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  if (enemy === undefined || def?.royalVault === undefined) return state;
  const capacity = Math.max(0, def.royalVault.capacity - royalVaultCoinCount(state, enemyIndex));
  const hand = state.zones.hand.filter((coin) => isEligible(state, db, coin));
  const quantity = hand.length <= 2 ? Math.min(1, hand.length) : Math.min(maxCoins, Math.floor(hand.length / 2));
  const nominated = hand.slice(0, Math.min(quantity, capacity));
  const element = nominated[0] === undefined ? 'fire' : effectiveElements(state.coins[Number(nominated[0])]!, db)[0] ?? 'fire';
  return setVaultSeizure(state, enemyIndex, nominated, capacity, events, element);
};

export const resolveRoyalVaultSeizure = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  const pending = enemy?.royalVaultSeizure;
  if (enemy === undefined || def?.royalVault === undefined || pending === undefined) return state;
  const before = royalVaultCoinCount(state, enemyIndex);
  const available = Math.max(0, def.royalVault.capacity - before);
  const coins = pending.nominated.filter((coin) => state.zones.hand.includes(coin) && isEligible(state, db, coin)).slice(0, Math.min(pending.capacity, available));
  let next = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, royalVaultSeizure: undefined }));
  if (coins.length === 0) return next;
  const order = state.custody.reduce((maximum, entry) => Math.max(maximum, entry.seizureOrder + 1), 0);
  const elements = coins.map((coin) => ({ coin, element: effectiveElements(state.coins[Number(coin)]!, db)[0] ?? 'fire' }));
  next = {
    ...next,
    custody: [...next.custody, ...elements.map(({ coin, element }, index) => ({ sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), coins: [coin], element, seizureOrder: order + index, kind: 'royalVault' as const }))],
    zones: { ...next.zones, hand: next.zones.hand.filter((coin) => !coins.includes(coin)) }
  };
  events.push({ type: 'royalVaultSeized', sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), coins, elements, before, after: before + coins.length, seizureOrder: order });
  return next;
};

export const applyRoyalVaultBarrier = (state: CombatState, enemyIndex: number, amountPerCoin: number, events: CombatEvent[]): CombatState => {
  const amount = royalVaultCoinCount(state, enemyIndex) * amountPerCoin;
  if (amount <= 0) return state;
  events.push({ type: 'blockGained', target: { type: 'enemy', index: enemyIndex }, amount });
  return withEnemy(state, enemyIndex, (enemy) => ({ ...enemy, block: enemy.block + amount }));
};

export const startLeadDecree = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const rule = enemy === undefined ? undefined : db.enemies[String(enemy.defId)]?.royalVault?.lead;
  if (enemy === undefined || rule === undefined) return state;
  // Direct setup calls arm a new decree too; an already-armed decree resolves
  // into an inactive display state after its windup finishes.
  if (enemy.leadDecree !== undefined && !enemy.windup?.intent.actions.some((action) => action.kind === 'leadDecree')) {
    return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, leadDecree: candidate.leadDecree === undefined ? undefined : { ...candidate.leadDecree, active: undefined } }));
  }
  const next = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, leadDecree: { initial: rule.generatedTemporaryElementalCount, remaining: rule.generatedTemporaryElementalCount, active: true, weakenedThisTurn: 0, weakenedTotal: 0 } }));
  events.push({ type: 'leadDecreeStarted', sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), initial: rule.generatedTemporaryElementalCount, remaining: rule.generatedTemporaryElementalCount });
  return next;
};

export const weakenLeadDecreeForSkill = (state: CombatState, enemyIndex: number, spent: readonly CoinUid[], db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const rule = enemy === undefined ? undefined : db.enemies[String(enemy.defId)]?.royalVault?.lead;
  const decree = enemy?.leadDecree;
  if (enemy === undefined || rule === undefined || decree?.active !== true || decree.distinctWeakenedTurn === state.turn || decree.weakenedTotal >= rule.maxWeakensPerWindup) return state;
  const elements = new Set(spent.flatMap((coin) => {
    const instance = state.coins[Number(coin)];
    return instance === undefined ? [] : [db.coins[String(instance.defId)]?.element].filter((element): element is Element => element !== null && element !== undefined);
  }));
  if (elements.size < 2 || decree.remaining <= rule.minRemaining) return state;
  const remaining = Math.max(rule.minRemaining, decree.remaining - 1);
  const next = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, leadDecree: candidate.leadDecree === undefined ? undefined : { ...candidate.leadDecree, remaining, weakenedThisTurn: candidate.leadDecree.weakenedThisTurn + 1, weakenedTotal: candidate.leadDecree.weakenedTotal + 1, distinctWeakenedTurn: state.turn } }));
  events.push({ type: 'leadDecreeWeakened', sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), before: decree.remaining, after: remaining, reason: 'distinctElements' });
  return next;
};

/** Damage route is independent of the distinct-elements route, but each route fires once per player turn. */
export const weakenLeadDecreeForSkillDamage = (state: CombatState, enemyIndex: number, hpDamage: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const rule = enemy === undefined ? undefined : db.enemies[String(enemy.defId)]?.royalVault?.lead;
  const decree = enemy?.leadDecree;
  const threshold = rule?.damageWeakeningThreshold;
  if (enemy === undefined || rule === undefined || decree?.active !== true || threshold === undefined || decree.damageWeakenedTurn === state.turn || decree.weakenedTotal >= rule.maxWeakensPerWindup) return state;
  const damage = (decree.damageTurn === state.turn ? decree.damageThisTurn ?? 0 : 0) + hpDamage;
  if (damage < threshold || decree.remaining <= rule.minRemaining) {
    return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, leadDecree: candidate.leadDecree === undefined ? undefined : { ...candidate.leadDecree, damageThisTurn: damage, damageTurn: state.turn } }));
  }
  const remaining = Math.max(rule.minRemaining, decree.remaining - 1);
  const next = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, leadDecree: candidate.leadDecree === undefined ? undefined : { ...candidate.leadDecree, remaining, weakenedThisTurn: candidate.leadDecree.weakenedThisTurn + 1, weakenedTotal: candidate.leadDecree.weakenedTotal + 1, damageWeakenedTurn: state.turn, damageThisTurn: damage, damageTurn: state.turn } }));
  events.push({ type: 'leadDecreeWeakened', sourceEnemy: enemyIndex, sourceEnemyUid: sourceUid(state, enemyIndex), before: decree.remaining, after: remaining, reason: 'skillDamage' });
  return next;
};

/** Marks newly-created temporary elemental coins, never mutating a permanent bag coin. */
export const applyLeadToCreatedCoin = (state: CombatState, coin: CoinUid, db: ContentDb, events: CombatEvent[]): CombatState => {
  const instance = state.coins[Number(coin)];
  if (instance === undefined || instance.permanent || instance.counterfeit === true || instance.lead === true || effectiveElements(instance, db).length === 0) return state;
  const owner = state.enemies.findIndex((enemy) => enemy.hp > 0 && (enemy.leadDecree?.remaining ?? 0) > 0);
  if (owner < 0) return state;
  const next = withEnemy({ ...state, coins: { ...state.coins, [Number(coin)]: { ...instance, lead: true, leadSourceEnemyUid: sourceUid(state, owner), grants: [] } } }, owner, (candidate) => ({ ...candidate, leadDecree: candidate.leadDecree === undefined ? undefined : { ...candidate.leadDecree, remaining: Math.max(0, candidate.leadDecree.remaining - 1) } }));
  events.push({ type: 'leadCoinTransformed', sourceEnemy: owner, sourceEnemyUid: sourceUid(state, owner), coin, before: `temporary:${String(instance.defId)}`, after: 'lead:neutral' });
  return next;
};

export const clearLeadCoins = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const uid = sourceUid(state, enemyIndex);
  const basic = Object.values(db.coins).find((coin) => coin.element === null && coin.counterfeit !== true)?.id;
  const marked = Object.values(state.coins).filter((coin) => coin.leadSourceEnemyUid === uid);
  const coins = marked.map((coin) => coin.uid);
  if (coins.length === 0) return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, leadDecree: undefined }));
  if (basic === undefined) throw new Error('lead clear requires a basic coin definition');
  const transformed = marked.map((coin) => ({ coin: coin.uid, before: String(coin.defId), after: String(basic) }));
  const next = withEnemy({ ...state, coins: Object.fromEntries(Object.entries(state.coins).map(([key, coin]) => [key, coin.leadSourceEnemyUid === uid ? { uid: coin.uid, defId: basic, grants: [], permanent: false as const } : coin])) }, enemyIndex, (candidate) => ({ ...candidate, leadDecree: undefined }));
  events.push({ type: 'leadCoinsCleared', sourceEnemy: enemyIndex, sourceEnemyUid: uid, coins, transformed });
  return next;
};

export const removeCounterfeits = (state: CombatState, count: number, events: CombatEvent[]): CombatState => {
  const removed = Object.values(state.coins).filter((coin) => coin.counterfeit === true).map((coin) => coin.uid).slice(0, count);
  if (removed.length === 0) return state;
  events.push({ type: 'counterfeitsRemoved', coins: removed });
  const gone = new Set(removed);
  return {
    ...state,
    coins: Object.fromEntries(Object.entries(state.coins).filter(([, coin]) => !gone.has(coin.uid))),
    zones: {
      draw: state.zones.draw.filter((coin) => !gone.has(coin)), hand: state.zones.hand.filter((coin) => !gone.has(coin)), discard: state.zones.discard.filter((coin) => !gone.has(coin)), exhausted: state.zones.exhausted.filter((coin) => !gone.has(coin)), placed: Object.fromEntries(Object.entries(state.zones.placed).map(([slot, coins]) => [slot, coins.filter((coin) => !gone.has(coin))])) as CombatState['zones']['placed']
    }
  };
};

export const createCounterfeits = (state: CombatState, coinDef: string, count: number, events: CombatEvent[]): CombatState => {
  if (count <= 0) return state;
  const coins = Array.from({ length: count }, (_, index) => (state.nextUid + index) as CoinUid);
  const additions = Object.fromEntries(coins.map((uid) => [Number(uid), { uid, defId: coinDef as never, grants: [], permanent: false as const, counterfeit: true }]));
  events.push({ type: 'counterfeitsCreated', coins, defId: coinDef });
  return { ...state, coins: { ...state.coins, ...additions }, nextUid: state.nextUid + count, zones: { ...state.zones, draw: [...state.zones.draw, ...coins] } };
};

export const isRoyalVaultAction = (action: EnemyAction): boolean => action.kind.startsWith('royalVault') || action.kind === 'leadDecree' || action.kind === 'clearLeadCoins';
