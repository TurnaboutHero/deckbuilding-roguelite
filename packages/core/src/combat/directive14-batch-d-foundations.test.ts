import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import type { CharacterId, CoinDefId, CoinEnchantId, CoinUid, Element, EnemyDefId, SkillId, SlotId } from '../ids';
import type { Rng } from '../rng';
import { legalCommands } from './commands';
import { runEnemyPhase } from './enemy';
import type { CombatEvent } from './events';
import { applyDamage, scaleSkillAuthoredEffect } from './resolve/flip';
import { createCombat, step, zoneCoinCount } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

/**
 * D14's public contract intentionally uses runtime fields before the shared
 * custody/seal atoms exist.  Keeping this facade local makes the RED tests
 * executable now while requiring the production implementation to expose the
 * behavior, rather than hiding an untyped compiler failure behind the tests.
 */
type Custody = { sourceEnemy: number; coins: readonly CoinUid[]; element: Element; seizureOrder: number };
type Seal = { turns: number; effectMultiplier?: number; fallback?: boolean; sourceEnemy?: number; owners?: readonly Seal[] };
type D14State = CombatState & {
  custody?: readonly Custody[];
  player: CombatState['player'] & {
    skillSeals?: Partial<Record<number, Seal>>;
  };
  enemies: Array<CombatState['enemies'][number] & {
    coinSeizure?: { element: Element; nominated: readonly CoinUid[]; handCountAtTelegraph: number; cap: number; quantity: number };
  }>;
};

const d14 = (state: CombatState): D14State => state as D14State;
const testEvents = (result: { events: readonly unknown[] }) => result.events as Array<{ type: string; [key: string]: unknown }>;

const enemy = (value: string, maxHp: number, extras: Record<string, unknown>): EnemyDef =>
  ({ id: id<EnemyDefId>(value), name: value, maxHp, intents: [{ id: 'idle', actions: [] }], ...extras }) as unknown as EnemyDef;

const db = (enemies: Record<string, EnemyDef>): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: { id: id<CoinDefId>('fire'), element: 'fire' },
    frost: { id: id<CoinDefId>('frost'), element: 'frost' },
    blood: { id: id<CoinDefId>('blood'), element: 'blood', procs: { heads: [{ kind: 'coinDamage', amount: 2 }] } }
  },
  skills: {
    jab: {
      id: id<SkillId>('jab'), name: 'Jab', type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 1,
      cooldown: 0, base: [{ kind: 'damage', amount: 4 }]
    },
    guard: {
      id: id<SkillId>('guard'), name: 'Guard', type: 'flip', rarity: 'common', tags: ['defense'], targetType: 'self', cost: 1,
      cooldown: 0, base: [{ kind: 'block', amount: 4 }]
    },
    costly: {
      id: id<SkillId>('costly'), name: 'Costly', type: 'consume', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy',
      consume: { element: 'fire', count: 2 }, effects: [{ kind: 'damage', amount: 6 }]
    }
  },
  enemies,
  characters: {
    hero: {
      id: id<CharacterId>('hero'), name: 'hero', maxHp: 70,
      startingBag: [id<CoinDefId>('fire'), id<CoinDefId>('fire'), id<CoinDefId>('fire'), id<CoinDefId>('frost'), id<CoinDefId>('blood')],
      startingSkills: [id<SkillId>('jab'), id<SkillId>('guard'), id<SkillId>('costly')],
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const start = (content: ContentDb, enemyId: string): CombatState => createCombat({ character: id<CharacterId>('hero'), enemies: [id<EnemyDefId>(enemyId)] }, content, 'directive14');
const startMany = (content: ContentDb, enemyIds: readonly string[]): CombatState =>
  createCombat({ character: id<CharacterId>('hero'), enemies: enemyIds.map((enemyId) => id<EnemyDefId>(enemyId)) }, content, 'directive14');

const withHand = (state: CombatState, coins: readonly CoinUid[]): CombatState => ({
  ...state,
  zones: {
    ...state.zones,
    hand: [...coins],
    draw: Object.keys(state.coins).map(Number).filter((coin) => !coins.includes(coin as CoinUid)) as CoinUid[],
    discard: [],
    exhausted: []
  }
});

const scriptedFlips = (faces: readonly ('heads' | 'tails')[]): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      const face = faces[index];
      if (face === undefined) throw new Error('scripted flip exhausted');
      index += 1;
      return face;
    },
    shuffle: <T>(values: readonly T[]) => [...values],
    snapshot: () => ({ s: [1, 2, 3, 4] as [number, number, number, number] })
  };
};

const endTurn = (state: CombatState, content: ContentDb) => {
  const result = step(state, { type: 'endTurn' }, content);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const resolveEnemy = (state: CombatState, content: ContentDb) => runEnemyPhase(state, content);

describe('Directive 14 Batch D M09 coin custody', () => {
  const thief = () => enemy('black-pouch-coin-thief', 44, {
    coinSeizure: { target: 'mostNumerousPublicElementInHand', maxCoins: 2, capFraction: 0.5 },
    intents: [
      { id: 'seize-purse', windup: { turns: 1, revealAtStart: true }, actions: [{ kind: 'seizeCustody' }, { kind: 'attack', damage: 4 }] },
      { id: 'cutpurse-strike', actions: [{ kind: 'attack', damage: 6 }] }
    ]
  });
  const seizureResolution = () => ({ ...thief().intents[0]!, windup: undefined });

  it('seizes an enchanted nominated coin as one custody entry and preserves its identity and enchant', () => {
    const content = db({ 'black-pouch-coin-thief': thief() });
    const initial = start(content, 'black-pouch-coin-thief');
    const [fireA, fireB, frost] = initial.zones.hand;
    if (fireA === undefined || fireB === undefined || frost === undefined) throw new Error('expected opening hand');
    const prepared = d14(withHand(initial, [fireA, fireB, frost]));
    prepared.coins[Number(fireA)] = { ...prepared.coins[Number(fireA)]!, enchant: id<CoinEnchantId>('sharpness') } as typeof prepared.coins[number];
    prepared.enemies[0] = {
      ...prepared.enemies[0]!,
      intent: seizureResolution(),
      intentIndex: 0,
      coinSeizure: { element: 'fire', nominated: [fireA, fireB], handCountAtTelegraph: 3, cap: 1, quantity: 1 }
    };

    const resolved = resolveEnemy(prepared, content).state;
    const custody = d14(resolved).custody;

    expect(custody).toEqual([{ sourceEnemy: 0, sourceEnemyUid: 1, coins: [fireA], element: 'fire', seizureOrder: 0 }]);
    expect(resolved.zones.hand).not.toContain(fireA);
    expect(resolved.coins[Number(fireA)]).toMatchObject({ uid: fireA, enchant: 'sharpness' });
  });

  it('returns seized coins to discard in seizure order when the thief dies in the same resolution', () => {
    const content = db({ 'black-pouch-coin-thief': thief() });
    const initial = start(content, 'black-pouch-coin-thief');
    const [fireA, fireB] = initial.zones.hand;
    if (fireA === undefined || fireB === undefined) throw new Error('expected opening hand');
    const prepared = d14(withHand(initial, []));
    prepared.zones.draw = prepared.zones.draw.filter((coin) => coin !== fireA && coin !== fireB);
    prepared.enemies[0] = { ...prepared.enemies[0]!, hp: 1 };
    prepared.custody = [{ sourceEnemy: 0, coins: [fireB, fireA], element: 'fire', seizureOrder: 0 }];

    const resolutionEvents: CombatEvent[] = [];
    const killed = applyDamage(prepared, { type: 'enemy', index: 0 }, 1, 'skill', resolutionEvents, { type: 'player' });

    expect(killed.zones.discard.slice(-2)).toEqual([fireB, fireA]);
    expect(d14(killed).custody).toEqual([]);
    expect(resolutionEvents).toContainEqual(expect.objectContaining({ type: 'coinsReturned', sourceEnemy: 0, coins: [fireB, fireA] }));
  });

  it('uses floor half-cap arithmetic for an odd three-coin telegraph', () => {
    const content = db({ 'black-pouch-coin-thief': thief() });
    const initial = start(content, 'black-pouch-coin-thief');
    const [fireA, fireB, frost] = initial.zones.hand;
    if (fireA === undefined || fireB === undefined || frost === undefined) throw new Error('expected opening hand');
    const prepared = d14(withHand(initial, [fireA, fireB, frost]));
    prepared.enemies[0] = {
      ...prepared.enemies[0]!, intent: seizureResolution(), intentIndex: 0,
      coinSeizure: { element: 'fire', nominated: [fireA, fireB], handCountAtTelegraph: 3, cap: Math.floor(3 / 2), quantity: 1 }
    };

    const resolved = resolveEnemy(prepared, content).state;

    expect(d14(resolved).custody?.[0]?.coins ?? []).toHaveLength(1);
  });

  it('reduces seizure to still-held nominated coins and never retargets another element', () => {
    const content = db({ 'black-pouch-coin-thief': thief() });
    const initial = start(content, 'black-pouch-coin-thief');
    const [fireA, fireB, frost] = initial.zones.hand;
    if (fireA === undefined || fireB === undefined || frost === undefined) throw new Error('expected opening hand');
    const prepared = d14(withHand(initial, [fireB, frost]));
    prepared.zones.draw = prepared.zones.draw.filter((coin) => coin !== fireA);
    prepared.zones.discard.push(fireA); // nominated fireA was spent/moved after telegraph.
    prepared.enemies[0] = {
      ...prepared.enemies[0]!, intent: seizureResolution(), intentIndex: 0,
      coinSeizure: { element: 'fire', nominated: [fireA, fireB], handCountAtTelegraph: 4, cap: 2, quantity: 2 }
    };

    const resolved = resolveEnemy(prepared, content).state;

    expect(d14(resolved).custody?.[0]?.coins).toEqual([fireB]);
    expect(d14(resolved).custody?.[0]?.coins).not.toContain(frost);
  });

  it('does not change the permanent run-bag coin set when custody remains at combat end', () => {
    const content = db({ 'black-pouch-coin-thief': thief() });
    const initial = start(content, 'black-pouch-coin-thief');
    const [fireA] = initial.zones.hand;
    if (fireA === undefined) throw new Error('expected opening hand');
    const prepared = d14(withHand(initial, []));
    prepared.zones.draw = prepared.zones.draw.filter((coin) => coin !== fireA);
    prepared.enemies[0] = { ...prepared.enemies[0]!, hp: 1 };
    prepared.custody = [{ sourceEnemy: 0, coins: [fireA], element: 'fire', seizureOrder: 0 }];

    const finished = applyDamage(prepared, { type: 'enemy', index: 0 }, 1, 'skill', [], { type: 'player' });

    expect(zoneCoinCount(finished.zones)).toBe(Object.values(finished.coins).filter((coin) => coin.permanent).length);
    expect(d14(finished).custody).toEqual([]);
  });

  it('falls through spent early nominees to later UIDs from the frozen candidate set', () => {
    const content = db({ 'black-pouch-coin-thief': thief() });
    const initial = start(content, 'black-pouch-coin-thief');
    const fireCoins = Object.values(initial.coins)
      .filter((coin) => String(coin.defId) === 'fire')
      .map((coin) => coin.uid);
    const frost = Object.values(initial.coins).find((coin) => String(coin.defId) === 'frost')?.uid;
    if (fireCoins.length !== 3 || frost === undefined) throw new Error('expected three fire coins and frost');
    const prepared = withHand(initial, [...fireCoins, frost]);

    const telegraphed = resolveEnemy(prepared, content).state;
    expect(d14(telegraphed).enemies[0]?.coinSeizure).toMatchObject({ nominated: fireCoins, quantity: 2 });
    const spent = fireCoins[0]!;
    telegraphed.zones.hand = telegraphed.zones.hand.filter((coin) => coin !== spent);
    telegraphed.zones.discard.push(spent);

    const resolved = resolveEnemy(telegraphed, content).state;
    expect(d14(resolved).custody?.[0]?.coins).toEqual([fireCoins[1], fireCoins[2]]);
  });
});

describe('Directive 14 Batch D M10 seal and repeat foundations', () => {
  const sealer = () => enemy('grey-tower-sealer', 46, {
    skillSeal: { recentPlayerTurns: 2, turns: 2, uniqueSkillEffectMultiplier: 0.75 },
    intents: [
      { id: 'cast-seal', actions: [{ kind: 'sealRecentSkill' }] },
      { id: 'arcane-bolt', actions: [{ kind: 'attack', damage: 7 }] },
      { id: 'greater-bolt', actions: [{ kind: 'attack', damage: 5 }] }
    ]
  });

  it('selects the most repeated skill across the most recent two player turns', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    initial.player.recentSkillUses = [slot(1), slot(0), slot(1), slot(0), slot(0)].map((usedSlot) => ({ turn: initial.turn, slot: usedSlot }));
    initial.enemies[0] = { ...initial.enemies[0]!, intent: sealer().intents[0]!, intentIndex: 0 };

    const resolved = endTurn(initial, content).state;

    expect(d14(resolved).player.skillSeals?.[0]).toMatchObject({ turns: 2 });
    expect(testEvents(endTurn(initial, content))).toContainEqual(expect.objectContaining({ type: 'skillSealed', slot: 0, turns: 2 }));
  });

  it('uses a one-player-turn twenty-five-percent fallback when the chosen skill is the only usable skill', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    initial.slots = [initial.slots[0]!, { ...initial.slots[1]!, skillId: null }, { ...initial.slots[2]!, cooldownRemaining: 2 }];
    initial.player.recentSkillUses = [{ turn: initial.turn, slot: slot(0) }, { turn: initial.turn, slot: slot(0) }];
    initial.enemies[0] = { ...initial.enemies[0]!, intent: sealer().intents[0]!, intentIndex: 0 };

    const resolved = endTurn(initial, content).state;

    expect(d14(resolved).player.skillSeals?.[0]).toMatchObject({ turns: 1, effectMultiplier: 0.75, fallback: true });
    expect(testEvents(endTurn(initial, content))).toContainEqual(expect.objectContaining({ type: 'skillSealFallbackReduced', slot: 0, multiplier: 0.75, turns: 1 }));
  });

  it('expires a standard seal after exactly two player turns without removing end turn', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    initial.player.skillSeals = { 0: { turns: 2 } };

    const first = endTurn(initial, content).state;
    const second = endTurn(first, content).state;

    expect(d14(first).player.skillSeals?.[0]).toMatchObject({ turns: 1 });
    expect(d14(second).player.skillSeals?.[0]).toBeUndefined();
    expect(legalCommands(d14(first), content)).toContainEqual(expect.objectContaining({ type: 'endTurn' }));
    expect(legalCommands(d14(first), content)).not.toContainEqual(expect.objectContaining({ type: 'useImmediateFlipSkill', slot: 0 }));
    const handCoin = first.zones.hand[0];
    if (handCoin === undefined) throw new Error('expected a hand coin');
    expect(step(d14(first), { type: 'useImmediateFlipSkill', slot: slot(0), coins: [handCoin], target: 0 }, content)).toMatchObject({
      ok: false,
      error: 'skill is sealed'
    });
  });

  it('uses the alternate strike without refreshing a seal owned by the active source', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    initial.player.skillSeals = { 0: { turns: 2, sourceEnemy: 0 } };
    initial.enemies[0] = { ...initial.enemies[0]!, intent: sealer().intents[0]!, intentIndex: 0 };

    const resolved = resolveEnemy(initial, content).state;

    expect(resolved.player.hp).toBe(initial.player.hp - 6);
    expect(d14(resolved).player.skillSeals?.[0]).toMatchObject({ turns: 2, sourceEnemy: 0 });
  });

  it('ignores skill uses older than the configured two-player-turn window', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    initial.turn = 3;
    initial.player.recentSkillUses = [{ turn: 1, slot: slot(0) }];
    initial.enemies[0] = { ...initial.enemies[0]!, intent: sealer().intents[0]!, intentIndex: 0 };

    const resolved = endTurn(initial, content).state;

    expect(d14(resolved).player.skillSeals?.[0]).toBeUndefined();
  });

  it('preserves concurrent source ownership so neither sealer can overwrite the other', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(startMany(content, ['grey-tower-sealer', 'grey-tower-sealer']));
    initial.player.recentSkillUses = [{ turn: initial.turn, slot: slot(0) }, { turn: initial.turn, slot: slot(0) }];
    initial.enemies = initial.enemies.map((enemyState) => ({ ...enemyState, intent: sealer().intents[0]!, intentIndex: 0 }));

    const sealed = d14(endTurn(initial, content).state);
    expect(sealed.player.skillSeals?.[0]?.owners?.map((owner) => owner.sourceEnemy)).toEqual([0, 1]);
    sealed.enemies[0] = { ...sealed.enemies[0]!, intent: sealer().intents[0]!, intentIndex: 0 };
    sealed.enemies[1] = { ...sealed.enemies[1]!, intent: { id: 'idle', actions: [] }, intentIndex: 1 };

    const repeated = d14(resolveEnemy(sealed, content).state);
    expect(repeated.player.skillSeals?.[0]?.owners?.map((owner) => owner.sourceEnemy)).toEqual([0, 1]);
    expect(repeated.player.skillSeals?.[0]?.turns).toBe(2);
  });

  it('reduces skill-native damage but excludes coin-native damage from the fallback multiplier', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    const blood = Object.keys(initial.coins)
      .map(Number)
      .map((coin) => coin as CoinUid)
      .find((coin) => String(initial.coins[Number(coin)]?.defId) === 'blood');
    if (blood === undefined) throw new Error('expected a blood coin');
    const ready = d14(withHand(initial, [blood]));
    ready.rngImpl = { ...ready.rngImpl, flip: scriptedFlips(['heads']) };
    ready.player.skillSeals = { 0: { turns: 1, effectMultiplier: 0.75, fallback: true } };
    ready.player.nextAttackDamageBonus = 2;
    const used = step(ready, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [blood], target: 0 }, content);
    if (!used.ok) throw new Error(used.error);

    const skillDamage = testEvents(used).filter((event) => event.type === 'damageDealt' && event.source === 'skill');
    const coinDamage = testEvents(used).filter((event) => event.type === 'damageDealt' && event.source === 'coin');

    expect(skillDamage).toContainEqual(expect.objectContaining({ amount: 5 }));
    expect(coinDamage).toContainEqual(expect.objectContaining({ amount: 2 }));
  });

  it('scales consumed-skill coefficients while keeping the runtime consumed count intact', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const costly = content.skills.costly;
    if (costly?.type !== 'consume') throw new Error('expected costly consume skill');
    content.skills.costly = { ...costly, effects: [{ kind: 'damageByConsumed', base: 5, perCoin: 5 }] };
    const initial = d14(start(content, 'grey-tower-sealer'));
    const fireCoins = Object.values(initial.coins).filter((coin) => String(coin.defId) === 'fire').slice(0, 2).map((coin) => coin.uid);
    if (fireCoins.length !== 2) throw new Error('expected two fire coins');
    const ready = d14(withHand(initial, fireCoins));
    ready.player.skillSeals = { 2: { turns: 1, effectMultiplier: 0.75, fallback: true } };

    const used = step(ready, { type: 'useConsumeSkill', slot: slot(2), coins: fireCoins, target: 0 }, content);
    if (!used.ok) throw new Error(used.error);

    expect(testEvents(used)).toContainEqual(expect.objectContaining({ type: 'damageDealt', source: 'skill', amount: 9 }));
  });

  it('scales composite authored coefficients and leaves hardcoded state-driven outputs unchanged', () => {
    expect(scaleSkillAuthoredEffect(
      { kind: 'damageByConsumed', base: 5, perCoin: 5, frostbittenBonusPerCoin: 2 },
      0.75
    )).toEqual({ kind: 'damageByConsumed', base: 3, perCoin: 3, frostbittenBonusPerCoin: 1 });
    expect(scaleSkillAuthoredEffect({ kind: 'aoeDamage', amount: 4 }, 0.75))
      .toEqual({ kind: 'aoeDamage', amount: 3 });
    expect(scaleSkillAuthoredEffect({ kind: 'blockPerTargetShock', base: 7, cap: 5 }, 0.75))
      .toEqual({ kind: 'blockPerTargetShock', base: 5, cap: 3 });
    expect(scaleSkillAuthoredEffect({ kind: 'virtualManaSwordVolley', baseDamage: 3, baseCount: 4 }, 0.75))
      .toEqual({ kind: 'virtualManaSwordVolley', baseDamage: 2, baseCount: 4 });
    expect(scaleSkillAuthoredEffect({ kind: 'damagePerBlock', amountPerBlock: 1 }, 0.75))
      .toEqual({ kind: 'damagePerBlock', amountPerBlock: 0 });
    expect(scaleSkillAuthoredEffect({ kind: 'lifestealByConsumed', amountPerCoin: 2 }, 0.75))
      .toEqual({ kind: 'lifestealByConsumed', amountPerCoin: 1 });
    expect(scaleSkillAuthoredEffect({ kind: 'scheduleEndTurnBlockAoe', cap: 6 }, 0.75))
      .toEqual({ kind: 'scheduleEndTurnBlockAoe', cap: 4 });
    expect(scaleSkillAuthoredEffect({ kind: 'executeOrDischargeShock' }, 0.75))
      .toEqual({ kind: 'executeOrDischargeShock' });
    expect(scaleSkillAuthoredEffect({ kind: 'selfDamage', amount: 4 }, 0.75))
      .toEqual({ kind: 'selfDamage', amount: 4 });
    expect(scaleSkillAuthoredEffect({ kind: 'payHp', amount: 4 }, 0.75))
      .toEqual({ kind: 'payHp', amount: 4 });
  });

  it('returns placed coins in slot order and removes a defensive queued allocation before sealing it', () => {
    const content = db({ 'grey-tower-sealer': sealer() });
    const initial = d14(start(content, 'grey-tower-sealer'));
    const [first, second] = initial.zones.hand;
    if (first === undefined || second === undefined) throw new Error('expected opening hand');
    initial.zones.hand = initial.zones.hand.filter((coin) => coin !== first && coin !== second);
    initial.zones.draw = initial.zones.draw.filter((coin) => coin !== first && coin !== second);
    initial.zones.placed[slot(0)] = [first];
    initial.zones.placed[slot(1)] = [second];
    initial.player.recentSkillUses = [{ turn: initial.turn, slot: slot(0) }, { turn: initial.turn, slot: slot(0) }];
    initial.enemies[0] = { ...initial.enemies[0]!, intent: sealer().intents[0]!, intentIndex: 0 };

    const result = endTurn(initial, content);
    const resolved = result.state;

    expect(resolved.zones.placed[slot(0)]).toEqual([]);
    expect(testEvents(result)).toContainEqual(expect.objectContaining({ type: 'placedCoinsReturned', slot: 0, coins: [first] }));
    expect(d14(resolved).player.skillSeals?.[0]).toMatchObject({ turns: 2 });
  });
});
