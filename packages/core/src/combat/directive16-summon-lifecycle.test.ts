import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef, EnemyIntent } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId } from '../ids';
import { legalCommands } from './commands';
import { runEnemyPhase } from './enemy';
import type { CombatEvent } from './events';
import { applyDamage } from './resolve/flip';
import { createCombat } from './reducer';
import type { CombatState, EnemyState } from './state';

const id = <T extends string>(value: string): T => value as T;
/**
 * Directive 16 deliberately specifies runtime-facing fields before the shared
 * schema exists. This facade keeps the RED tests executable while requiring
 * the engine to implement the public behavior rather than accepting a type-only change.
 */
type D16Enemy = EnemyState & {
  enemyUid: number;
  slot: number;
  summonSick?: boolean;
  hatch?: { turnsRemaining: number; delayed: boolean };
};
type D16State = CombatState & {
  enemies: D16Enemy[];
  custody: Array<CombatState['custody'][number] & { sourceEnemyUid: number }>;
};

const d16 = (state: CombatState): D16State => state as D16State;
const eventsOf = (events: readonly CombatEvent[]): Array<{ type: string; [key: string]: unknown }> => events as Array<{ type: string; [key: string]: unknown }>;

const enemy = (value: string, maxHp: number, intents: readonly EnemyIntent[], extras: Record<string, unknown> = {}): EnemyDef =>
  ({ id: id<EnemyDefId>(value), name: value, maxHp, intents: [...intents], ...extras }) as unknown as EnemyDef;

const necromancer = () => enemy('mortbell-bonebell-necromancer', 50, [
  {
    id: 'raise-skeleton', windup: { turns: 1, revealAtStart: true },
    actions: [{ kind: 'summonEnemies', enemy: 'skeleton-servant', maxCount: 2 }] as unknown as EnemyIntent['actions']
  },
  { id: 'bone-shard', actions: [{ kind: 'attack', damage: 6 }] }
]);
const skeleton = () => enemy('skeleton-servant', 15, [{ id: 'rattle-strike', actions: [{ kind: 'attack', damage: 4 }] }]);
const eggkeeper = () => enemy('fenmarsh-eggkeeper-witch', 55, [
  { id: 'marsh-curse', actions: [{ kind: 'attack', damage: 6 }] },
  { id: 'lay-eggs', actions: [{ kind: 'summonEnemies', enemy: 'mud-egg', maxCount: 2 }] as unknown as EnemyIntent['actions'] },
  { id: 'accelerate-brood', actions: [{ kind: 'accelerateHatching', amount: 1 }] as unknown as EnemyIntent['actions'] }
]);
const mudEgg = () => enemy('mud-egg', 10, [
  { id: 'incubate', actions: [{ kind: 'tickHatch' }] as unknown as EnemyIntent['actions'] }
], { hatch: { into: 'marsh-hatchling', turns: 2, delayAtHpFraction: 0.5 } });
const hatchling = () => enemy('marsh-hatchling', 18, [{ id: 'marsh-bite', actions: [{ kind: 'attack', damage: 5 }] }]);

const db = (): ContentDb => ({
  coins: { basic: { id: id<CoinDefId>('basic'), element: null } },
  skills: {
    jab: { id: id('jab'), name: 'Jab', type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 1, cooldown: 0, base: [{ kind: 'damage', amount: 1 }] }
  },
  enemies: {
    'mortbell-bonebell-necromancer': necromancer(),
    'skeleton-servant': skeleton(),
    'fenmarsh-eggkeeper-witch': eggkeeper(),
    'mud-egg': mudEgg(),
    'marsh-hatchling': hatchling()
  },
  characters: {
    hero: {
      id: id<CharacterId>('hero'), name: 'hero', maxHp: 70,
      startingBag: Array.from({ length: 6 }, () => id<CoinDefId>('basic')),
      startingSkills: [id('jab')], trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const start = (content: ContentDb, enemyIds: readonly string[]): D16State =>
  d16(createCombat({ character: id<CharacterId>('hero'), enemies: enemyIds.map((enemyId) => id<EnemyDefId>(enemyId)) }, content, 'directive16'));

const entrant = (template: D16Enemy, defId: string, enemyUid: number, slotIndex: number, hp: number, maxHp: number, intent: EnemyIntent): D16Enemy => ({
  ...template,
  defId: id<EnemyDefId>(defId),
  enemyUid,
  slot: slotIndex,
  hp,
  maxHp,
  block: 0,
  statuses: {},
  intent,
  intentIndex: 0,
  summonSick: true
});

const tagExistingEnemies = (state: D16State): D16State => ({
  ...state,
  enemies: state.enemies.map((current, index) => ({ ...current, enemyUid: index + 1, slot: index, summonSick: false }))
});

const resolveAfterWindup = (state: D16State, content: ContentDb) => {
  const telegraphed = runEnemyPhase(state, content);
  const resolved = runEnemyPhase(d16(telegraphed.state), content);
  return { state: resolved.state, events: [...telegraphed.events, ...resolved.events] };
};

describe('Directive 16 summoned enemy lifecycle', () => {
  it('rejects an opening battle above the canonical three-live-enemy cap', () => {
    const content = db();

    expect(() => start(content, [
      'mortbell-bonebell-necromancer',
      'skeleton-servant',
      'skeleton-servant',
      'skeleton-servant'
    ])).toThrow('combat supports at most 3 enemies');
  });

  it('emits a cap-three battle-slot summon failure without changing the two live skeleton entrants', () => {
    const content = db();
    let state = tagExistingEnemies(start(content, ['mortbell-bonebell-necromancer']));
    const owner = state.enemies[0]!;
    state = {
      ...state,
      enemies: [
        owner,
        entrant(owner, 'skeleton-servant', 2, 1, 15, 15, skeleton().intents[0]!),
        entrant(owner, 'skeleton-servant', 3, 2, 15, 15, skeleton().intents[0]!)
      ]
    };

    const resolved = resolveAfterWindup(state, content);

    expect(resolved.state.enemies.filter((current) => current.defId === 'skeleton-servant' && current.hp > 0)).toHaveLength(2);
    expect(eventsOf(resolved.events)).toContainEqual(expect.objectContaining({ type: 'enemySummonFailed', sourceEnemyUid: 1, enemy: 'skeleton-servant', maxCount: 2 }));
  });

  it('refills the vacant skeleton entrant slot after a skeleton dies', () => {
    const content = db();
    let state = tagExistingEnemies(start(content, ['mortbell-bonebell-necromancer']));
    const owner = state.enemies[0]!;
    state = {
      ...state,
      enemies: [
        owner,
        entrant(owner, 'skeleton-servant', 2, 1, 1, 15, skeleton().intents[0]!),
        entrant(owner, 'skeleton-servant', 3, 2, 15, 15, skeleton().intents[0]!)
      ]
    };
    state = d16(applyDamage(state, { type: 'enemy', index: 1 }, 1, 'skill', [], { type: 'player' }));

    const resolved = resolveAfterWindup(state, content);

    expect(resolved.state.enemies.filter((current) => current.defId === 'skeleton-servant' && current.hp > 0)).toHaveLength(2);
    expect(eventsOf(resolved.events)).toContainEqual(expect.objectContaining({ type: 'enemySummoned', sourceEnemyUid: 1, enemy: 'skeleton-servant', slot: 1 }));
  });

  it('delays an egg hatch exactly once when damage crosses its HP to 50 percent before hatching on the second later phase', () => {
    const content = db();
    const state = tagExistingEnemies(start(content, ['mud-egg']));
    state.enemies[0] = { ...state.enemies[0]!, hp: 6, hatch: { turnsRemaining: 1, delayed: false } };
    const crossingEvents: CombatEvent[] = [];
    const crossed = d16(applyDamage(state, { type: 'enemy', index: 0 }, 1, 'skill', crossingEvents, { type: 'player' }));

    const delayed = runEnemyPhase(crossed, content);
    const hatched = runEnemyPhase(d16(delayed.state), content);

    expect(crossed.enemies[0]).toMatchObject({ hp: 5, hatch: { delayed: true, turnsRemaining: 2 } });
    expect(delayed.state.enemies[0]).toMatchObject({ defId: 'mud-egg', hatch: { delayed: true, turnsRemaining: 1 } });
    expect(eventsOf(crossingEvents)).toContainEqual(expect.objectContaining({ type: 'enemyHatchDelayed', sourceEnemyUid: 1 }));
    expect(hatched.state.enemies[0]).toMatchObject({ defId: 'marsh-hatchling', hp: 18, maxHp: 18 });
  });

  it('does not delay an egg hatch when damage leaves it at 51 percent HP', () => {
    const content = db();
    const state = tagExistingEnemies(start(content, ['mud-egg']));
    state.enemies[0] = { ...state.enemies[0]!, hp: 10, hatch: { turnsRemaining: 1, delayed: false } };
    const crossed = d16(applyDamage(state, { type: 'enemy', index: 0 }, 4, 'skill', [], { type: 'player' }));

    const resolved = runEnemyPhase(crossed, content);

    expect(crossed.enemies[0]).toMatchObject({ hp: 6, hatch: { delayed: false, turnsRemaining: 1 } });
    expect(resolved.state.enemies[0]).toMatchObject({ defId: 'marsh-hatchling', hp: 18, maxHp: 18 });
    expect(eventsOf(resolved.events)).toContainEqual(expect.objectContaining({ type: 'enemyHatched', sourceEnemyUid: 1, into: 'marsh-hatchling' }));
  });

  it('does not hatch an egg killed in the same all-enemy resolution as its eggkeeper', () => {
    const content = db();
    let state = tagExistingEnemies(start(content, ['fenmarsh-eggkeeper-witch', 'mud-egg']));
    state.enemies = state.enemies.map((current) => ({
      ...current,
      hp: 1,
      hatch: current.defId === 'mud-egg' ? { turnsRemaining: 0, delayed: false } : undefined
    })) as D16Enemy[];
    const events: CombatEvent[] = [];
    state = d16(applyDamage(state, { type: 'enemy', index: 0 }, 1, 'skill', events, { type: 'player' }));
    state = d16(applyDamage(state, { type: 'enemy', index: 1 }, 1, 'skill', events, { type: 'player' }));

    expect(state.enemies.map((current) => current.hp)).toEqual([0, 0]);
    expect(eventsOf(events)).toContainEqual(expect.objectContaining({ type: 'enemyRemoved', enemyUid: 2, reason: 'killed' }));
    expect(eventsOf(events).some((event) => event.type === 'enemyHatched')).toBe(false);
  });

  it('lays up to two mud eggs within the three-live-enemy cap without adding a second windup', () => {
    const content = db();
    const state = tagExistingEnemies(start(content, ['fenmarsh-eggkeeper-witch']));
    state.enemies[0] = { ...state.enemies[0]!, intent: eggkeeper().intents[1]!, intentIndex: 1 };

    const resolved = runEnemyPhase(state, content);

    expect(resolved.state.enemies.filter((current) => current.defId === 'mud-egg' && current.hp > 0)).toHaveLength(2);
    expect(eventsOf(resolved.events).filter((event) => event.type === 'enemySummoned')).toHaveLength(2);
    expect(eventsOf(resolved.events).some((event) => event.type === 'enemyWindupStarted')).toBe(false);
  });

  it('marks an accelerate-forced hatch summon-sick so it cannot act in the creation enemy phase', () => {
    const content = db();
    const state = tagExistingEnemies(start(content, ['fenmarsh-eggkeeper-witch', 'mud-egg']));
    state.enemies[0] = { ...state.enemies[0]!, intent: eggkeeper().intents[2]!, intentIndex: 2 };
    state.enemies[1] = { ...state.enemies[1]!, hatch: { turnsRemaining: 1, delayed: false } };
    const playerHp = state.player.hp;

    const resolved = runEnemyPhase(state, content);

    expect(resolved.state.enemies[1]).toMatchObject({ defId: 'marsh-hatchling', summonSick: true, hp: 18, maxHp: 18 });
    expect(resolved.state.player.hp).toBe(playerHp);
    expect(eventsOf(resolved.events)).toContainEqual(expect.objectContaining({ type: 'enemyHatchAccelerated', sourceEnemyUid: 1, targetEnemyUid: 2, amount: 1 }));
  });

  it('carries statuses through a UID-preserving egg transform while retaining its slot and restoring full hatchling HP', () => {
    const content = db();
    const state = tagExistingEnemies(start(content, ['mud-egg']));
    state.enemies[0] = {
      ...state.enemies[0]!, hp: 1, enemyUid: 41, slot: 0,
      statuses: { burn: { kind: 'stack', stacks: 2 }, shock: { kind: 'duration', turns: 1 } },
      protectionLink: {
        target: 1, durability: 2, restoreDurability: 2, active: true, turnsUntilRestore: 0,
        redirectFraction: 0.5, brokenTurns: 2, brokenDamageTakenMultiplier: 1.5
      },
      hatch: { turnsRemaining: 0, delayed: true }
    };

    const resolved = runEnemyPhase(state, content);

    expect(resolved.state.enemies[0]).toMatchObject({
      defId: 'marsh-hatchling', enemyUid: 41, slot: 0, hp: 18, maxHp: 18,
      statuses: { burn: { kind: 'stack', stacks: 2 }, shock: { kind: 'duration', turns: 1 } },
      protectionLink: {
        target: 1, durability: 2, restoreDurability: 2, active: true, turnsUntilRestore: 0,
        redirectFraction: 0.5, brokenTurns: 2, brokenDamageTakenMultiplier: 1.5
      }
    });
  });

  it('summons two entrants after windup and lists both as legal targets', () => {
    const content = db();
    const initial = tagExistingEnemies(start(content, ['mortbell-bonebell-necromancer']));
    const resolved = resolveAfterWindup(initial, content);
    const summoned = resolved.state;
    expect(summoned.enemies.filter((current) => current.defId === 'skeleton-servant' && current.hp > 0)).toHaveLength(2);
    expect(eventsOf(resolved.events).filter((event) => event.type === 'enemySummoned')).toHaveLength(2);
    const playerPhase = d16({ ...summoned, phase: 'player' });
    const coin = playerPhase.zones.hand[0];
    if (coin === undefined) throw new Error('expected opening-hand coin');
    const targets = legalCommands(playerPhase, content)
      .filter(
        (command): command is Extract<typeof command, { type: 'useImmediateFlipSkill' }> =>
          command.type === 'useImmediateFlipSkill' && command.coins[0] === coin
      )
      .map((command) => command.target);

    expect(targets).toEqual([0, 1, 2]);
  });

  it('does not release custody held by a departed UID when a new entrant later dies in that slot', () => {
    const content = db();
    let state = tagExistingEnemies(start(content, ['mortbell-bonebell-necromancer']));
    const coin = state.zones.hand[0] as CoinUid | undefined;
    if (coin === undefined) throw new Error('expected opening-hand coin');
    state = {
      ...state,
      zones: {
        ...state.zones,
        hand: state.zones.hand.filter((current) => current !== coin),
        draw: state.zones.draw.filter((current) => current !== coin),
        discard: state.zones.discard.filter((current) => current !== coin),
        exhausted: state.zones.exhausted.filter((current) => current !== coin)
      },
      custody: [{ sourceEnemy: 1, sourceEnemyUid: 77, coins: [coin], element: 'fire', seizureOrder: 0 }],
      enemies: [...state.enemies, entrant(state.enemies[0]!, 'skeleton-servant', 88, 1, 1, 15, skeleton().intents[0]!)]
    };

    const killed = applyDamage(state, { type: 'enemy', index: 1 }, 1, 'skill', [], { type: 'player' });

    expect(d16(killed).custody).toContainEqual(expect.objectContaining({ sourceEnemyUid: 77, coins: [coin] }));
    expect(killed.zones.discard).not.toContain(coin);
  });

  it('emits a replayable summon lifecycle in telegraph, summon, death, and refill order', () => {
    const content = db();
    let state = tagExistingEnemies(start(content, ['mortbell-bonebell-necromancer']));
    const first = resolveAfterWindup(state, content);
    state = d16(first.state);
    const spawned = state.enemies.findIndex((current) => current.defId === 'skeleton-servant');
    if (spawned < 0) throw new Error('expected a skeleton entrant');
    const deathEvents: CombatEvent[] = [];
    state = d16(applyDamage(state, { type: 'enemy', index: spawned }, 99, 'skill', deathEvents, { type: 'player' }));
    const refill = resolveAfterWindup(state, content);
    const lifecycle = [...eventsOf(first.events), ...eventsOf(deathEvents), ...eventsOf(refill.events)]
      .filter((event) => ['enemySummonTelegraphed', 'enemySummoned', 'enemyRemoved'].includes(event.type))
      .map((event) => event.type);

    expect(lifecycle).toEqual([
      'enemySummonTelegraphed', 'enemySummoned', 'enemySummoned',
      'enemyRemoved',
      'enemySummonTelegraphed', 'enemySummoned'
    ]);
  });
});
