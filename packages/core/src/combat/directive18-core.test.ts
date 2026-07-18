import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId } from '../ids';
import { applyLeadToCreatedCoin, forecloseRoyalVault, nominateExactRoyalVaultSeizure, resolveRoyalVaultSeizure, royalVaultCoinCount, clearLeadCoins, startLeadDecree, weakenLeadDecreeForSkill, weakenLeadDecreeForSkillDamage } from './directive18';
import { nextIntent, runEnemyPhase } from './enemy';
import { applyDamage } from './resolve/flip';
import { createCombat } from './reducer';
import type { CombatEvent, } from './events';
import type { CombatState } from './state';

const id = <T extends string>(value: string): T => value as T;
const enemy = (value: string, overrides: Partial<EnemyDef> = {}): EnemyDef => ({
  id: id<EnemyDefId>(value), name: value, maxHp: 100, intents: [{ id: 'idle', actions: [] }], ...overrides
});
const content = (foe: EnemyDef): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' },
    frost: { id: id<CoinDefId>('frost'), element: 'frost' },
    counterfeit: { id: id<CoinDefId>('counterfeit'), element: null, counterfeit: true }
  },
  skills: {}, enemies: { [String(foe.id)]: foe },
  characters: { hero: { id: id<CharacterId>('hero'), name: 'hero', maxHp: 50, startingBag: [id<CoinDefId>('basic')], startingSkills: [], trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] } } },
  validate: () => []
});
const base = (db: ContentDb, foe: EnemyDef): CombatState => createCombat({ character: id<CharacterId>('hero'), enemies: [foe.id] }, db, 'd18');
const coin = (uid: number, defId: string, lead = false) => ({ uid: uid as CoinUid, defId: id<CoinDefId>(defId), grants: [], permanent: false as const, ...(lead ? { lead: true as const, leadSourceEnemyUid: 1 } : {}) });

describe('Directive 18 generic vault contracts', () => {
  const foe = () => enemy('aurel', {
    royalTax: { denomination: 2, deadline: 'endNextPlayerTurn', counterfeitCoin: id('counterfeit'), counterfeitCount: 1, defaultShield: 0, foreclosureAfterDefaults: 1, foreclosureIntent: { id: 'foreclose', windup: { turns: 1, revealAtStart: true }, actions: [{ kind: 'royalVaultForeclose' }] }, foreclosureMaxCoins: 1 },
    royalVault: { capacity: 6, blockLostPerRecovery: 4, lead: { generatedTemporaryElementalCount: 3, minRemaining: 1, maxWeakensPerTurn: 2, maxWeakensPerWindup: 2, damageWeakeningThreshold: 16 } }
  });

  it('freezes foreclosure UIDs, then vaults only the still-held exact nominee', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const state: CombatState = { ...first, coins: { 1: coin(1, 'fire'), 2: coin(2, 'fire'), 3: coin(3, 'frost') }, zones: { ...first.zones, hand: [1 as CoinUid, 2 as CoinUid, 3 as CoinUid] }, enemies: [{ ...first.enemies[0]!, royalTaxForeclosureElement: 'fire' }] };
    const events: CombatEvent[] = [];
    const armed = forecloseRoyalVault(state, 0, db, events);
    expect(armed.enemies[0]?.royalVaultSeizure?.nominated).toEqual([1]);
    const spent = { ...armed, zones: { ...armed.zones, hand: [2 as CoinUid, 3 as CoinUid] } };
    const resolved = resolveRoyalVaultSeizure(spent, 0, db, events);
    expect(royalVaultCoinCount(resolved, 0)).toBe(0);
    expect(resolved.zones.hand).toEqual([2, 3]);
  });

  it('preserves per-coin authored elements for exact mixed seizure recovery', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const state = { ...first, coins: { 1: coin(1, 'fire'), 2: coin(2, 'frost'), 3: coin(3, 'fire'), 4: coin(4, 'fire'), 5: coin(5, 'frost'), 6: coin(6, 'fire') }, zones: { ...first.zones, hand: [1 as CoinUid, 2 as CoinUid, 3 as CoinUid, 4 as CoinUid, 5 as CoinUid, 6 as CoinUid] } };
    const events: CombatEvent[] = [];
    const armed = nominateExactRoyalVaultSeizure(state, 0, 3, db, events);
    const resolved = resolveRoyalVaultSeizure(armed, 0, db, events);
    expect(resolved.custody.filter((entry) => entry.kind === 'royalVault').map((entry) => [entry.coins[0], entry.element])).toEqual([[1, 'fire'], [2, 'frost'], [3, 'fire']]);
  });

  it('uses distinct authored elements once per route and phase-three converts lead to temporary basic', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const state = { ...first, turn: 4, coins: { 1: coin(1, 'fire'), 2: coin(2, 'frost'), 3: coin(3, 'fire', true) } };
    const events: CombatEvent[] = [];
    const started = startLeadDecree(state, 0, db, events);
    const weak = weakenLeadDecreeForSkill(started, 0, [1 as CoinUid, 2 as CoinUid], db, events);
    const twice = weakenLeadDecreeForSkill(weak, 0, [1 as CoinUid, 2 as CoinUid], db, events);
    expect(weak.enemies[0]?.leadDecree?.remaining).toBe(2);
    expect(twice.enemies[0]?.leadDecree?.remaining).toBe(2);
    const cleared = clearLeadCoins(twice, 0, db, events);
    expect(cleared.coins[3]).toMatchObject({ defId: 'basic', permanent: false });
    expect(cleared.coins[3]?.lead).toBeUndefined();
  });

  it('allows each lead weakening route once per player turn, never twice from repeated damage', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const state = { ...first, turn: 6, coins: { 1: coin(1, 'fire'), 2: coin(2, 'frost') } };
    const events: CombatEvent[] = [];
    const started = startLeadDecree(state, 0, db, events);
    const distinct = weakenLeadDecreeForSkill(started, 0, [1 as CoinUid, 2 as CoinUid], db, events);
    const damage = weakenLeadDecreeForSkillDamage(distinct, 0, 16, db, events);
    const repeated = weakenLeadDecreeForSkillDamage(damage, 0, 16, db, events);
    expect(distinct.enemies[0]?.leadDecree?.remaining).toBe(2);
    expect(damage.enemies[0]?.leadDecree?.remaining).toBe(1);
    expect(repeated.enemies[0]?.leadDecree?.remaining).toBe(1);
    expect(events.filter((event) => event.type === 'leadDecreeWeakened').map((event) => event.reason)).toEqual(['distinctElements', 'skillDamage']);
  });

  it('reads two authored element UIDs for decree weakening and rejects one multi-grant coin', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const grantedFire = { ...coin(1, 'fire'), grants: ['frost' as const] };
    const state = { ...first, turn: 7, coins: { 1: grantedFire, 2: coin(2, 'frost') } };
    const events: CombatEvent[] = [];
    const started = startLeadDecree(state, 0, db, events);
    const oneUid = weakenLeadDecreeForSkill(started, 0, [1 as CoinUid, 1 as CoinUid], db, events);
    expect(oneUid.enemies[0]?.leadDecree?.remaining).toBe(3);
    const twoAuthored = weakenLeadDecreeForSkill(oneUid, 0, [1 as CoinUid, 2 as CoinUid], db, events);
    expect(twoAuthored.enemies[0]?.leadDecree?.remaining).toBe(2);
  });

  it('keeps pending Lead transformations after windup while rejecting post-windup weakening', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const state = { ...first, turn: 8, coins: { 1: coin(1, 'fire'), 2: coin(2, 'frost'), 3: coin(3, 'fire') } };
    const events: CombatEvent[] = [];
    const armed = startLeadDecree(state, 0, db, events);
    const weakened = weakenLeadDecreeForSkill(armed, 0, [1 as CoinUid, 2 as CoinUid], db, events);
    const resolved = startLeadDecree(weakened, 0, db, events);
    const created = { ...resolved, coins: { ...resolved.coins, 3: coin(3, 'fire') } };
    const transformed = applyLeadToCreatedCoin(created, 3 as CoinUid, db, events);

    expect(resolved.enemies[0]?.leadDecree).toMatchObject({ active: undefined, remaining: 2 });
    expect(weakenLeadDecreeForSkill(resolved, 0, [1 as CoinUid, 2 as CoinUid], db, events)).toBe(resolved);
    expect(transformed.coins[3]).toMatchObject({ lead: true, leadSourceEnemyUid: resolved.enemies[0]?.enemyUid });
  });

  it('applies a paid tax reduction only to the next ordinary strike, never Crown damage', () => {
    const ordinary = { id: 'ordinary-strike', actions: [{ kind: 'attack' as const, damage: 10, ordinary: true as const }] };
    const crown = { id: 'crown-strike', actions: [{ kind: 'attack' as const, damage: 22 }] };
    const f = enemy('aurel-paid-tax', { intents: [ordinary, crown], royalTax: { denomination: 2, deadline: 'endNextPlayerTurn', counterfeitCoin: id('counterfeit'), counterfeitCount: 1, defaultShield: 0, seizureAfterDefaults: 1, seizureIntent: ordinary, paidNextOrdinaryAttackReduction: 2 } });
    const db = content(f);
    const first = base(db, f);

    const ordinaryResult = runEnemyPhase({ ...first, enemies: [{ ...first.enemies[0]!, intent: ordinary, royalTaxPaidAttackReduction: 2 }] }, db);
    expect(ordinaryResult.state.player.hp).toBe(42);
    expect(ordinaryResult.state.enemies[0]?.royalTaxPaidAttackReduction).toBeUndefined();

    const crownResult = runEnemyPhase({ ...first, enemies: [{ ...first.enemies[0]!, intent: crown, royalTaxPaidAttackReduction: 2 }] }, db);
    expect(crownResult.state.player.hp).toBe(28);
    expect(crownResult.state.enemies[0]?.royalTaxPaidAttackReduction).toBe(2);
  });

  it('freezes exact phase-three nominees at windup, then vaults only the survivors', () => {
    const seizure = { id: 'phase-three-seizure', windup: { turns: 1, revealAtStart: true as const }, actions: [{ kind: 'royalVaultExactSeizure' as const, maxCoins: 3, selection: 'handFraction' as const }] };
    const f = enemy('aurel-exact', { intents: [seizure], royalVault: { capacity: 6, lead: { generatedTemporaryElementalCount: 3, minRemaining: 1, maxWeakensPerTurn: 2, maxWeakensPerWindup: 2 } } });
    const db = content(f); const first = base(db, f);
    const armed = runEnemyPhase({ ...first, coins: { 1: coin(1, 'fire'), 2: coin(2, 'frost'), 3: coin(3, 'fire'), 4: coin(4, 'frost') }, zones: { ...first.zones, hand: [1 as CoinUid, 2 as CoinUid, 3 as CoinUid, 4 as CoinUid] } }, db);
    expect(armed.state.enemies[0]?.royalVaultSeizure?.nominated).toEqual([1, 2]);
    const afterSpend = { ...armed.state, zones: { ...armed.state.zones, hand: [2 as CoinUid, 3 as CoinUid, 4 as CoinUid] } };
    const resolved = runEnemyPhase(afterSpend, db);
    expect(resolved.state.custody.filter((entry) => entry.kind === 'royalVault').map((entry) => entry.coins[0])).toEqual([2]);
    expect(resolved.state.zones.hand).toEqual([3, 4]);
  });

  it('Crown at vault six attacks, creates two counterfeits, returns oldest, then yields to ordinary intent', () => {
    const ordinary = { id: 'ordinary-strike', actions: [{ kind: 'attack' as const, damage: 10, ordinary: true as const }] };
    const crown = { id: 'crown', actions: [{ kind: 'attack' as const, damage: 22 }, { kind: 'createCounterfeit' as const, coin: id<CoinDefId>('counterfeit'), count: 2 }, { kind: 'returnOldestRoyalVaultCoin' as const, reason: 'crownResolved' as const }] };
    const f = enemy('aurel-crown', { intents: [ordinary], royalVault: { capacity: 6, atCapacityIntent: crown, lead: { generatedTemporaryElementalCount: 3, minRemaining: 1, maxWeakensPerTurn: 2, maxWeakensPerWindup: 2 } } });
    const db = content(f); const first = base(db, f);
    const stored = Array.from({ length: 6 }, (_, index) => (index + 1) as CoinUid);
    const state = {
      ...first,
      coins: Object.fromEntries(stored.map((uid) => [Number(uid), coin(Number(uid), 'fire')])),
      custody: stored.map((uid, index) => ({ sourceEnemy: 0, sourceEnemyUid: first.enemies[0]!.enemyUid, coins: [uid], element: 'fire' as const, seizureOrder: index, kind: 'royalVault' as const })),
      zones: { ...first.zones, draw: [], hand: [], discard: [], exhausted: [] },
      nextUid: 7,
      enemies: [{ ...first.enemies[0]!, intent: crown }
      ]
    };
    const result = runEnemyPhase(state, db);
    expect(result.state.player.hp).toBe(28);
    expect(Object.values(result.state.coins).filter((candidate) => candidate.counterfeit === true)).toHaveLength(2);
    expect(royalVaultCoinCount(result.state, 0)).toBe(5);
    expect(result.state.zones.discard).toEqual([1]);
    expect(nextIntent(result.state, 0, db).intent.id).toBe('ordinary-strike');
  });

  it('cancels Crown by both two vault recoveries and ten skill damage, returning the oldest vault coin', () => {
    const crown = {
      id: 'crown', windup: { turns: 1, revealAtStart: true as const },
      cancelOn: [{ kind: 'vaultCoinsRecovered' as const, count: 2 }, { kind: 'skillDamage' as const, threshold: 10 }],
      onCancelActions: [{ kind: 'returnOldestRoyalVaultCoin' as const, reason: 'crownCancelled' as const }],
      actions: [{ kind: 'attack' as const, damage: 22 }]
    };
    const f = enemy('aurel-cancel', { intents: [crown], royalVault: { capacity: 6, lead: { generatedTemporaryElementalCount: 3, minRemaining: 1, maxWeakensPerTurn: 2, maxWeakensPerWindup: 2 } } });
    const db = content(f); const first = base(db, f);
    const stored = [1 as CoinUid, 2 as CoinUid];
    const windupState = {
      ...first,
      coins: { 1: coin(1, 'fire'), 2: coin(2, 'frost') },
      custody: stored.map((uid, index) => ({ sourceEnemy: 0, sourceEnemyUid: first.enemies[0]!.enemyUid, coins: [uid], element: index === 0 ? 'fire' as const : 'frost' as const, seizureOrder: index, kind: 'royalVault' as const })),
      enemies: [{ ...first.enemies[0]!, intent: crown, windup: { intent: crown, turnsLeft: 1, startHp: 100 }, royalVaultRecoveredThisWindup: 2 }]
    };
    const recoveryCancelled = runEnemyPhase(windupState, db);
    expect(recoveryCancelled.events).toContainEqual(expect.objectContaining({ type: 'enemyWindupCancelled', intent: crown }));
    expect(royalVaultCoinCount(recoveryCancelled.state, 0)).toBe(1);
    expect(recoveryCancelled.state.zones.discard).toEqual([1]);

    const damageEvents: CombatEvent[] = [];
    const damageCancelled = applyDamage({ ...windupState, enemies: [{ ...windupState.enemies[0]!, royalVaultRecoveredThisWindup: 0 }] }, { type: 'enemy', index: 0 }, 10, 'skill', damageEvents, { type: 'player' });
    expect(damageEvents).toContainEqual(expect.objectContaining({ type: 'enemyWindupCancelled', intent: crown }));
    expect(royalVaultCoinCount(damageCancelled, 0)).toBe(1);
    expect(damageCancelled.zones.discard).toEqual([1]);
  });

  it('returns an enchanted six-coin vault in global order when its source dies', () => {
    const f = foe(); const db = content(f); const first = base(db, f);
    const stored = Array.from({ length: 6 }, (_, index) => (index + 1) as CoinUid);
    const state = {
      ...first,
      coins: Object.fromEntries(stored.map((uid) => [Number(uid), { ...coin(Number(uid), 'fire'), grants: ['frost' as const] }])),
      custody: stored.map((uid, index) => ({ sourceEnemy: 0, sourceEnemyUid: first.enemies[0]!.enemyUid, coins: [uid], element: 'fire' as const, seizureOrder: index, kind: 'royalVault' as const })),
      zones: { ...first.zones, draw: [], hand: [], discard: [], exhausted: [] }
    };
    const events: CombatEvent[] = [];
    const dead = applyDamage(state, { type: 'enemy', index: 0 }, 100, 'skill', events, { type: 'player' });
    expect(dead.custody).toEqual([]);
    expect(dead.zones.discard).toEqual(stored);
    expect(stored.map((uid) => dead.coins[Number(uid)]?.grants)).toEqual(stored.map(() => ['frost']));
  });
});
