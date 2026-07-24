import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CharacterId, CoinUid, ContentDb, EnemyDefId, SkillDef, SkillId, SlotId } from '@game/core';
import {
  applyDamage,
  assertCombatCoinZoneInvariant,
  createCombat,
  drawCards,
  legalCommands,
  recordDirective15SkillResolution,
  resolveRoyalTaxDeadlines,
  royalTaxPayableElement,
  runEnemyPhase,
  sealTriggeredSkill,
  step,
} from '@game/core';

import { contentDb } from './index';

const id = <T extends string>(value: string) => value as T;
const start = (enemy: string) => createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>(enemy)] }, contentDb, 'd15');
const slot = (value: number) => value as SlotId;
const withFreshNextUid = <T extends { coins: Record<number, { uid: CoinUid }>; nextUid: number }>(state: T): T => ({
  ...state,
  nextUid: Math.max(...Object.keys(state.coins).map(Number)) + 1,
});

const withoutCoins = <T extends { zones: { draw: CoinUid[]; hand: CoinUid[]; discard: CoinUid[]; exhausted: CoinUid[]; placed: Record<SlotId, CoinUid[]> } }>(state: T, coins: readonly CoinUid[]): T => {
  const removed = new Set(coins);
  return {
    ...state,
    zones: {
      ...state.zones,
      draw: state.zones.draw.filter((coin) => !removed.has(coin)),
      hand: state.zones.hand.filter((coin) => !removed.has(coin)),
      discard: state.zones.discard.filter((coin) => !removed.has(coin)),
      exhausted: state.zones.exhausted.filter((coin) => !removed.has(coin)),
      placed: Object.fromEntries(Object.entries(state.zones.placed).map(([key, placed]) => [key, placed.filter((coin) => !removed.has(coin))])) as Record<SlotId, CoinUid[]>,
    },
  };
};

describe('Directive 15 engine contracts', () => {
  it('creates counterfeits once on default, exhausts them when drawn, and preserves zone invariants', () => {
    let state = start('fallen-kings-treasurer-marcel');
    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 1, deadlineTurn: state.turn } };
    const events: import('@game/core').CombatEvent[] = [];
    state = resolveRoyalTaxDeadlines(state, contentDb, events);
    expect(Object.values(state.coins).filter((coin) => coin.counterfeit === true)).toHaveLength(2);
    expect(state.enemies[0]?.block).toBe(8);
    expect(events).toContainEqual(expect.objectContaining({ type: 'royalTaxDefaulted', sourceEnemy: 0, shield: 8 }));
    const counterfeitUids = Object.values(state.coins).filter((coin) => coin.counterfeit === true).map((coin) => coin.uid);
    const ordinaryUids = Object.values(state.coins).filter((coin) => coin.counterfeit !== true).map((coin) => coin.uid);
    state = { ...state, zones: { ...state.zones, hand: [], draw: counterfeitUids, discard: ordinaryUids, exhausted: [], placed: {} } };
    const drawn = drawCards(state, 2);
    expect(drawn.events.filter((event) => event.type === 'counterfeitExhausted')).toHaveLength(2);
    assertCombatCoinZoneInvariant(drawn.state);
  });

  it('reaches zeal threshold three on the third consecutive resolved use of the same skill', () => {
    let state = start('blackthorn-inquisitor-roderick');
    const events: import('@game/core').CombatEvent[] = [];

    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);
    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);
    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);

    expect(state.enemies[0]?.repeatSkillPressure).toMatchObject({ lastSkillId: 'jab', triggeringSlot: 0, zeal: 3 });
  });

  it('resets zeal when a different skill resolves after repeated uses', () => {
    let state = start('blackthorn-inquisitor-roderick');
    const events: import('@game/core').CombatEvent[] = [];

    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);
    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);
    state = recordDirective15SkillResolution(state, state, slot(1), [], contentDb, events);

    expect(state.enemies[0]?.repeatSkillPressure).toMatchObject({ lastSkillId: 'fist-guard', zeal: 0 });
    expect(events.filter((event) => event.type === 'repeatSkillZealChanged').at(-1)).toMatchObject({ skill: 'fist-guard', zeal: 0 });
  });

  it('cancels execution at fifteen damage but resolves eighteen damage and one-turn seal below the threshold', () => {
    const execution = contentDb.enemies['blackthorn-inquisitor-roderick']?.repeatSkillPressure?.executionIntent;
    if (execution === undefined) throw new Error('expected M17 execution intent');
    const ready = (damageTaken: number) => {
      let state = start('blackthorn-inquisitor-roderick');
      state.enemies[0] = {
        ...state.enemies[0]!,
        intent: execution,
        windup: { intent: execution, turnsLeft: 1, startHp: state.enemies[0]!.hp, cancelThreshold: 15 },
        repeatSkillPressure: { lastSkillId: id<SkillId>('jab'), triggeringSlot: slot(0), zeal: 3, singleUsableResolvedUses: 0 },
      };
      state = applyDamage(state, { type: 'enemy', index: 0 }, damageTaken, 'skill', [], { type: 'player' });
      return state;
    };

    const below = runEnemyPhase(ready(14), contentDb);
    const exactDamageEvents: import('@game/core').CombatEvent[] = [];
    let exactState = ready(0);
    exactState = applyDamage(exactState, { type: 'enemy', index: 0 }, 15, 'skill', exactDamageEvents, { type: 'player' });
    const exact = runEnemyPhase(exactState, contentDb);

    expect(below.state.player.hp).toBe(52);
    expect(below.state.player.skillSeals[0]).toMatchObject({ turns: 1 });
    expect(below.events.some((event) => event.type === 'enemyWindupCancelled')).toBe(false);
    expect(exact.state.player.hp).toBe(70);
    expect(exact.state.player.skillSeals[0]).toBeUndefined();
    expect(exactDamageEvents).toContainEqual(expect.objectContaining({ type: 'enemyWindupCancelled' }));
    expect(exactDamageEvents).toContainEqual(expect.objectContaining({ type: 'repeatSkillZealReset', sourceEnemy: 0 }));
    expect(exact.state.enemies[0]?.repeatSkillPressure).toBeUndefined();
  });

  it('throttles zeal to every second use when only one skill is usable without sealing it', () => {
    let state = start('blackthorn-inquisitor-roderick');
    state.slots = state.slots.map((entry, index) => (index === 0 ? entry : { ...entry, skillId: null }));
    const events: import('@game/core').CombatEvent[] = [];

    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);
    expect(state.player.skillSeals[0]).toBeUndefined();
    expect(state.enemies[0]?.repeatSkillPressure).toMatchObject({ zeal: 0, singleUsableResolvedUses: 1 });
    state = recordDirective15SkillResolution(state, state, slot(0), [], contentDb, events);

    expect(state.player.skillSeals[0]).toBeUndefined();
    expect(state.enemies[0]?.repeatSkillPressure).toMatchObject({ zeal: 1, singleUsableResolvedUses: 2 });
    expect(legalCommands(state, contentDb)).toContainEqual(expect.objectContaining({ type: 'endTurn' }));
  });

  it('seals the armed slot rather than the first duplicate skill slot', () => {
    let state = start('blackthorn-inquisitor-roderick');
    state = {
      ...state,
      slots: state.slots.map((entry, index) => index === 1 ? { ...entry, skillId: id<SkillId>('jab') } : entry),
      enemies: state.enemies.map((enemy, index) => index === 0
        ? { ...enemy, repeatSkillPressure: { lastSkillId: id<SkillId>('jab'), triggeringSlot: slot(1), zeal: 3, singleUsableResolvedUses: 0 } }
        : enemy),
    };

    state = sealTriggeredSkill(state, 0, 1, []);

    expect(state.player.skillSeals[0]).toBeUndefined();
    expect(state.player.skillSeals[1]).toMatchObject({ turns: 1 });
  });

  it('records partial payment before clearing tax only after its second eligible coin', () => {
    let state = start('fallen-kings-treasurer-marcel');
    const fire = Object.values(state.coins).filter((coin) => String(coin.defId) === 'fire').map((coin) => coin.uid);
    if (fire.length < 2) throw new Error('expected two fire coins');
    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 0, deadlineTurn: state.turn + 1 } };
    const events: import('@game/core').CombatEvent[] = [];

    state = recordDirective15SkillResolution(state, state, slot(2), [fire[0]!], contentDb, events);
    expect(state.enemies[0]?.royalTaxPending).toMatchObject({ element: 'fire', paid: 1 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'royalTaxPaymentProgressed', paid: 1, denomination: 2 }));

    state = recordDirective15SkillResolution(state, state, slot(2), [fire[1]!], contentDb, events);
    expect(state.enemies[0]?.royalTaxPending).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: 'royalTaxPaid', paid: 2, denomination: 2 }));
  });

  it('opens tax only for a legal same-element two-coin skill plan and credits only that skill element', () => {
    let state = start('fallen-kings-treasurer-marcel');
    const fire = Object.values(state.coins).filter((coin) => String(coin.defId) === 'fire').map((coin) => coin.uid);
    if (fire.length < 2) throw new Error('expected two fire coins');
    const allCoins = Object.values(state.coins).map((coin) => coin.uid);
    state = {
      ...state,
      zones: {
        draw: allCoins.filter((coin) => !fire.includes(coin)),
        hand: fire,
        discard: [],
        exhausted: [],
        placed: Object.fromEntries(state.slots.map((_, index) => [index, []])) as Record<SlotId, CoinUid[]>,
      },
    };
    const taxEnemy = contentDb.enemies['fallen-kings-treasurer-marcel']!;
    const noFirePlan = {
      ...state,
      slots: state.slots.map((entry, index) => index >= 2 ? { ...entry, skillId: null } : entry),
    };

    expect(royalTaxPayableElement(noFirePlan, contentDb, taxEnemy)).toBeUndefined();

    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 0, deadlineTurn: state.turn + 1 } };
    state = recordDirective15SkillResolution(state, state, slot(0), [fire[0]!], contentDb, []);

    expect(state.enemies[0]?.royalTaxPending).toMatchObject({ paid: 0 });
    expect(royalTaxPayableElement(state, contentDb, taxEnemy)).toBe('fire');
  });

  it('requires an exact legal two-coin tax plan across flip and consume skill modes', () => {
    let state = start('fallen-kings-treasurer-marcel');
    const fire = Object.values(state.coins).filter((coin) => String(coin.defId) === 'fire').map((coin) => coin.uid);
    if (fire.length < 2) throw new Error('expected two fire coins');
    const allCoins = Object.values(state.coins).map((coin) => coin.uid);
    state = {
      ...state,
      zones: {
        draw: allCoins.filter((coin) => !fire.includes(coin)),
        hand: fire,
        discard: [],
        exhausted: [],
        placed: Object.fromEntries(state.slots.map((_, index) => [index, []])) as Record<SlotId, CoinUid[]>,
      },
    };
    const payableWith = (candidate: typeof state, definition: SkillDef): ReturnType<typeof royalTaxPayableElement> => {
      const db: ContentDb = { ...contentDb, skills: { ...contentDb.skills, [String(definition.id)]: definition } };
      const equipped = {
        ...candidate,
        slots: candidate.slots.map((entry, index) => ({ ...entry, skillId: index === 2 ? definition.id : null })),
      };
      return royalTaxPayableElement(equipped, db, db.enemies['fallen-kings-treasurer-marcel']!);
    };
    const flip = (cost: number): SkillDef => ({
      id: id<SkillId>('tax-plan'), name: 'Tax Plan', type: 'flip', rarity: 'common', tags: [], targetType: 'self', cost, element: 'fire', base: [],
    });
    const consume = (count: number, mode?: 'exact' | 'upTo' | 'all'): SkillDef => ({
      id: id<SkillId>('tax-plan'), name: 'Tax Plan', type: 'consume', rarity: 'common', tags: [], targetType: 'self', consume: { element: 'fire', count, mode }, effects: [],
    });
    const thirdFire = state.zones.draw[0];
    if (thirdFire === undefined) throw new Error('expected another coin');
    const allThreeState: typeof state = {
      ...state,
      coins: { ...state.coins, [Number(thirdFire)]: { ...state.coins[Number(thirdFire)]!, defId: state.coins[Number(fire[0]!)]!.defId } },
      zones: { ...state.zones, draw: state.zones.draw.filter((coin) => coin !== thirdFire), hand: [...fire, thirdFire] },
    };

    expect(payableWith(state, flip(3))).toBeUndefined();
    expect(payableWith(state, consume(3))).toBeUndefined();
    expect(payableWith(allThreeState, consume(3, 'all'))).toBeUndefined();
    expect(payableWith(state, flip(2))).toBe('fire');
    expect(payableWith(state, consume(2, 'upTo'))).toBe('fire');
  });

  it('uses the degraded audit for an unopenable tax and retains end turn as a soft-lock escape hatch', () => {
    const state = start('fallen-kings-treasurer-marcel');
    state.slots = state.slots.map((entry) => ({ ...entry, skillId: null }));
    const result = runEnemyPhase(state, contentDb);

    expect(result.state.player.hp).toBe(62);
    expect(legalCommands({ ...result.state, phase: 'player' }, contentDb)).toContainEqual(expect.objectContaining({ type: 'endTurn' }));
  });

  it('schedules D14 custody and four damage only after the second tax default', () => {
    let state = withFreshNextUid(start('fallen-kings-treasurer-marcel'));
    const events: import('@game/core').CombatEvent[] = [];
    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 0, deadlineTurn: state.turn } };
    state = resolveRoyalTaxDeadlines(state, contentDb, events);
    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 0, deadlineTurn: state.turn } };
    state = resolveRoyalTaxDeadlines(state, contentDb, events);

    expect(events.filter((event) => event.type === 'royalTaxDefaulted')).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'royalTaxSeizureScheduled' }));

    const fire = Object.values(state.coins).filter((coin) => String(coin.defId) === 'fire').map((coin) => coin.uid);
    if (fire.length < 2) throw new Error('expected two fire coins');
    const allCoins = Object.values(state.coins).map((coin) => coin.uid);
    state = {
      ...state,
      zones: {
        draw: allCoins.filter((coin) => !fire.includes(coin)),
        hand: fire,
        discard: [],
        exhausted: [],
        placed: Object.fromEntries(state.slots.map((_, index) => [index, []])) as Record<SlotId, CoinUid[]>,
      },
    };
    assertCombatCoinZoneInvariant(state);
    const telegraphed = runEnemyPhase(state, contentDb).state;
    const resolved = runEnemyPhase(telegraphed, contentDb);
    expect(resolved.state.player.hp).toBe(66);
    expect(resolved.events).toContainEqual(expect.objectContaining({ type: 'coinsSeized', sourceEnemy: 0 }));
  });

  it('returns M09 and M18 custody by source and global seizure order when each enemy dies', () => {
    let state = createCombat({ character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('black-pouch-coin-thief'), id<EnemyDefId>('fallen-kings-treasurer-marcel')] }, contentDb, 'd15-custody');
    const [first, second, third, fourth] = Object.values(state.coins).map((coin) => coin.uid);
    if ([first, second, third, fourth].some((coin) => coin === undefined)) throw new Error('expected four coins');
    state = withoutCoins(state, [first!, second!, third!, fourth!]);
    state = {
      ...state,
      custody: [
        { sourceEnemy: 0, coins: [first!], element: 'fire', seizureOrder: 0 },
        { sourceEnemy: 1, coins: [second!, third!], element: 'fire', seizureOrder: 1 },
        { sourceEnemy: 0, coins: [fourth!], element: 'fire', seizureOrder: 2 },
      ],
      enemies: state.enemies.map((enemy, index) => ({ ...enemy, hp: index === 0 ? 1 : enemy.hp })),
    };

    const thiefEvents: import('@game/core').CombatEvent[] = [];
    state = applyDamage(state, { type: 'enemy', index: 0 }, 1, 'skill', thiefEvents, { type: 'player' });
    expect(state.zones.discard.slice(-2)).toEqual([first, fourth]);
    expect(state.custody).toEqual([expect.objectContaining({ sourceEnemy: 1, coins: [second, third] })]);

    const auditorEvents: import('@game/core').CombatEvent[] = [];
    state.enemies[1] = { ...state.enemies[1]!, hp: 1 };
    state = applyDamage(state, { type: 'enemy', index: 1 }, 1, 'skill', auditorEvents, { type: 'player' });
    expect(state.zones.discard.slice(-2)).toEqual([second, third]);
    expect(state.custody).toEqual([]);
  });

  it('keeps zone ownership valid immediately after adding counterfeit coins on default', () => {
    let state = start('fallen-kings-treasurer-marcel');
    const events: import('@game/core').CombatEvent[] = [];
    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 0, deadlineTurn: state.turn } };
    state = resolveRoyalTaxDeadlines(state, contentDb, events);
    assertCombatCoinZoneInvariant(state);
  });

  it('removes counterfeits from every combat zone when combat ends', () => {
    let state = withFreshNextUid(start('fallen-kings-treasurer-marcel'));
    const events: import('@game/core').CombatEvent[] = [];
    state.enemies[0] = { ...state.enemies[0]!, royalTaxPending: { element: 'fire', paid: 0, deadlineTurn: state.turn } };
    state = resolveRoyalTaxDeadlines(state, contentDb, events);
    const counterfeit = Object.values(state.coins).filter((coin) => coin.counterfeit === true).map((coin) => coin.uid);
    const handCoin = state.zones.hand[0];
    if (handCoin === undefined) throw new Error('expected a hand coin');
    state.enemies[0] = { ...state.enemies[0]!, hp: 1, block: 0 };
    state.rngImpl = {
      flip: { float: () => 0, int: () => 0, flip: () => 'heads' as const, shuffle: <T>(values: readonly T[]) => [...values], snapshot: () => ({ s: [1, 2, 3, 4] as [number, number, number, number] }) },
    };
    const used = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [handCoin], target: 0 }, contentDb);
    if (!used.ok) throw new Error(used.error);

    state = used.state;
    events.push(...used.events);

    expect(state.phase).toBe('victory');
    expect(Object.values(state.coins).some((coin) => coin.counterfeit === true)).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'counterfeitsRemoved', coins: counterfeit }));
    assertCombatCoinZoneInvariant(state);
  });

  it('never selects a counterfeit as a payable tax coin', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 2, maxLength: 8 }), (counterfeitFlags) => {
        let state = start('fallen-kings-treasurer-marcel');
        const coins = Object.values(state.coins).slice(0, counterfeitFlags.length);
        state = {
          ...state,
          coins: {
            ...state.coins,
            ...Object.fromEntries(coins.map((coin, index) => [Number(coin.uid), { ...coin, defId: id<'fire'>('fire'), counterfeit: counterfeitFlags[index] }])),
          },
          zones: { ...state.zones, hand: coins.map((coin) => coin.uid) },
        };
        const payable = royalTaxPayableElement(state, contentDb, contentDb.enemies['fallen-kings-treasurer-marcel']!);
        const eligible = counterfeitFlags.filter((counterfeit) => !counterfeit).length;
        expect(payable).toBe(eligible >= 2 ? 'fire' : undefined);
      }),
    );
  });
});
