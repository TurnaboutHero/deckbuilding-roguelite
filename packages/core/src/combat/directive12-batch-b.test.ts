import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import { validateContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, SlotId } from '../ids';
import { createCombat, step } from './reducer';
import { applyDamage, applyEffectAtom } from './resolve/flip';
import { statusStacks, statusTurns } from './state';
import type { CombatState } from './state';
import type { CombatEvent } from './events';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const ringGrowth = {
  gainPerRound: 1,
  maxStacks: 5,
  damageReductionPerStack: 0.08,
  healMaxHpFractionPerStack: 0.03,
  removeOneAtHpFraction: 0.15,
  removeTwoAtHpFraction: 0.25
} as const;

const enemy = (value: string, overrides: Partial<EnemyDef> = {}): EnemyDef => ({
  id: id<EnemyDefId>(value),
  name: value,
  maxHp: 65,
  intents: [{ id: 'idle', actions: [] }],
  ...overrides
});

const testDb = (enemies: Record<string, EnemyDef>): ContentDb => {
  const base = {
    coins: {
      basic: { id: id<CoinDefId>('basic'), element: null },
      frost: { id: id<CoinDefId>('frost'), element: 'frost' as const }
    },
    skills: {},
    enemies,
    characters: {
      hero: {
        id: id<CharacterId>('hero'),
        name: 'hero',
        maxHp: 70,
        startingBag: Array.from({ length: 8 }, () => id<CoinDefId>('basic')),
        startingSkills: [],
        trait: { id: 'none', name: 'none', hook: 'combatStart' as const, effects: [] }
      }
    }
  };
  return { ...base, validate: () => validateContentDb(base) };
};

const combat = (db: ContentDb, enemyId: string): CombatState =>
  createCombat({ character: id<CharacterId>('hero'), enemies: [id<EnemyDefId>(enemyId)] }, db, 'directive12-batch-b');

const endTurn = (state: CombatState, db: ContentDb) => {
  const result = step(state, { type: 'endTurn' }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const prepareElementalHand = (input: CombatState, grants: readonly string[][]): CombatState => {
  const coins = Object.fromEntries(
    grants.map((coinGrants, index) => {
      const coin = input.zones.draw[index]!;
      return [
        Number(coin),
        {
          ...input.coins[Number(coin)]!,
          defId: index === 0 ? id<CoinDefId>('frost') : id<CoinDefId>('basic'),
          grants: coinGrants as Array<'fire' | 'mana' | 'frost' | 'lightning' | 'blood'>,
          ...(index === 2 ? { permanent: false as const, permanentUid: undefined } : {}),
          ...(index === 3 ? { preserved: true } : {})
        }
      ];
    })
  );
  const hand = input.zones.draw.slice(0, grants.length - 1);
  const placedCoin = input.zones.draw[grants.length - 1]!;
  return {
    ...input,
    coins: { ...input.coins, ...coins },
    zones: {
      ...input.zones,
      draw: input.zones.draw.slice(grants.length),
      hand,
      placed: { ...input.zones.placed, [slot(0)]: [placedCoin] }
    }
  } as CombatState;
};

describe('Directive 12 Batch B status contracts', () => {
  it('keeps poison as a persistent stack that bypasses player block at turn end', () => {
    const db = testDb({ idle: enemy('idle') });
    const events: CombatEvent[] = [];
    const poisoned = applyEffectAtom(
      combat(db, 'idle'),
      { kind: 'applyStatus', status: 'poison', stacks: 3, to: 'self' },
      { type: 'player' },
      db,
      events
    );

    const ended = endTurn({ ...poisoned, player: { ...poisoned.player, block: 99 } }, db);

    expect(ended.state.player.hp).toBe(67);
    expect(ended.events).toContainEqual({ type: 'damageDealt', target: { type: 'player' }, amount: 3, blocked: 0, source: 'poison' });
    expect(statusStacks(ended.state.player.statuses, 'poison')).toBe(3);
  });

  it('prevents player healing while healLock has remaining duration', () => {
    const db = testDb({ idle: enemy('idle') });
    const state = {
      ...combat(db, 'idle'),
      player: {
        ...combat(db, 'idle').player,
        hp: 40,
        statuses: { healLock: { kind: 'duration' as const, turns: 2 } }
      }
    };
    const events: CombatEvent[] = [];

    const healed = applyEffectAtom(state, { kind: 'heal', amount: 10 }, { type: 'player' }, db, events);

    expect(healed.player.hp).toBe(40);
    expect(events).toContainEqual({ type: 'healPrevented', target: { type: 'player' }, amount: 10, reason: 'healLock' });
  });

  it('prevents lifesteal through the same heal gateway', () => {
    const db = testDb({ idle: enemy('idle') });
    const base = combat(db, 'idle');
    const state = {
      ...base,
      player: { ...base.player, hp: 40, statuses: { healLock: { kind: 'duration' as const, turns: 1 } } }
    };
    const events: CombatEvent[] = [
      { type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 1, blocked: 0, source: 'skill' }
    ];

    const resolved = applyEffectAtom(state, { kind: 'lifesteal', amount: 5 }, { type: 'enemy', index: 0 }, db, events);

    expect(resolved.player.hp).toBe(40);
    expect(events).toContainEqual({ type: 'healPrevented', target: { type: 'player' }, amount: 5, reason: 'healLock' });
  });

  it('ends combat before enemy actions when poison defeats the player', () => {
    const db = testDb({ attacker: enemy('attacker', { intents: [{ id: 'attack', actions: [{ kind: 'attack', damage: 7 }] }] }) });
    const base = combat(db, 'attacker');
    const state = {
      ...base,
      player: { ...base.player, hp: 2, statuses: { poison: { kind: 'stack' as const, stacks: 3 } } }
    };

    const resolved = endTurn(state, db);

    expect(resolved.state.phase).toBe('defeat');
    expect(resolved.events.some((event) => event.type === 'damageDealt' && event.source === 'enemy')).toBe(false);
  });

  it('expires healLock only after its configured number of player turn ends', () => {
    const db = testDb({ idle: enemy('idle') });
    const initial = {
      ...combat(db, 'idle'),
      player: { ...combat(db, 'idle').player, statuses: { healLock: { kind: 'duration' as const, turns: 2 } } }
    };

    const first = endTurn(initial, db);
    const second = endTurn(first.state, db);

    expect(statusTurns(first.state.player.statuses, 'healLock')).toBe(1);
    expect(statusTurns(second.state.player.statuses, 'healLock')).toBe(0);
  });
});

describe('Directive 12 Batch B M11 plague mist', () => {
  const plagueMist = () =>
    enemy('plague-mist', {
      intents: [
        {
          id: 'poison-injection',
          actions: [
            { kind: 'attack', damage: 7 },
            { kind: 'applyStatus', status: 'poison', stacks: 2, requiresLastAttackHpDamage: true }
          ]
        },
        {
          id: 'plague-mist',
          windup: { turns: 1, revealAtStart: true },
          actions: [
            { kind: 'applyStatus', status: 'poison', stacks: 1 },
            { kind: 'applyStatus', status: 'healLock', stacks: 2, requiresPlayerStatus: { status: 'poison', atLeast: 5 } }
          ]
        }
      ]
    });

  it('does not inject poison when its attack is fully blocked', () => {
    const db = testDb({ 'plague-mist': plagueMist() });
    const base = combat(db, 'plague-mist');

    const resolved = endTurn({ ...base, player: { ...base.player, block: 7 } }, db);

    expect(resolved.state.player.hp).toBe(70);
    expect(statusStacks(resolved.state.player.statuses, 'poison')).toBe(0);
  });

  it('injects two poison stacks only after its attack deals player HP damage', () => {
    const db = testDb({ 'plague-mist': plagueMist() });

    const resolved = endTurn(combat(db, 'plague-mist'), db);

    expect(resolved.state.player.hp).toBe(63);
    expect(statusStacks(resolved.state.player.statuses, 'poison')).toBe(2);
  });

  it('applies healLock for two turns when plague mist raises poison to five', () => {
    const db = testDb({ 'plague-mist': plagueMist() });
    const base = combat(db, 'plague-mist');
    const poisoned = {
      ...base,
      player: { ...base.player, statuses: { poison: { kind: 'stack' as const, stacks: 4 } } },
      enemies: base.enemies.map((unit) => ({ ...unit, intentIndex: 1, intent: plagueMist().intents[1]! }))
    };

    const started = endTurn(poisoned, db);
    const resolved = endTurn(started.state, db);

    expect(statusStacks(resolved.state.player.statuses, 'poison')).toBe(5);
    expect(statusTurns(resolved.state.player.statuses, 'healLock')).toBe(2);
  });

  it('does not apply healLock when plague mist leaves poison below five', () => {
    const db = testDb({ 'plague-mist': plagueMist() });
    const base = combat(db, 'plague-mist');
    const poisoned = {
      ...base,
      player: { ...base.player, statuses: { poison: { kind: 'stack' as const, stacks: 3 } } },
      enemies: base.enemies.map((unit) => ({ ...unit, intentIndex: 1, intent: plagueMist().intents[1]! }))
    };

    const started = endTurn(poisoned, db);
    const resolved = endTurn(started.state, db);

    expect(statusStacks(resolved.state.player.statuses, 'poison')).toBe(4);
    expect(statusTurns(resolved.state.player.statuses, 'healLock')).toBe(0);
  });
});

describe('Directive 12 Batch B M12 winter hand', () => {
  const winterHand = () =>
    enemy('winter-hand', {
      playerTurnEndPunishment: { kind: 'unusedElementalCoinsAtLeast', threshold: 4, status: 'frostbite', stacks: 1 },
      intents: [
        { id: 'cold-touch', actions: [{ kind: 'attack', damage: 7 }, { kind: 'applyStatus', status: 'frostbite', stacks: 1 }] },
        {
          id: 'winter-hand',
          windup: { turns: 1, revealAtStart: true },
          actions: [{ kind: 'applyStatus', status: 'frostbite', stacks: 2 }]
        }
      ]
    });

  it('counts each unspent elemental coin once before discard, including grants, temporary coins, and preserved coins', () => {
    const db = testDb({ 'winter-hand': winterHand() });
    const prepared = prepareElementalHand(combat(db, 'winter-hand'), [[], ['fire', 'mana'], ['lightning'], ['blood']]);
    const state = { ...prepared, enemies: prepared.enemies.map((unit) => ({ ...unit, intent: { id: 'idle', actions: [] } })) };

    const resolved = endTurn(state, db);
    const statusIndex = resolved.events.findIndex((event) => event.type === 'statusApplied' && event.status === 'frostbite');
    const discardIndex = resolved.events.findIndex((event) => event.type === 'coinsDiscarded');

    expect(statusTurns(resolved.state.player.statuses, 'frostbite')).toBe(1);
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(discardIndex);
  });

  it('does not count multiple effective elements on one coin more than once', () => {
    const db = testDb({ 'winter-hand': winterHand() });
    const prepared = prepareElementalHand(combat(db, 'winter-hand'), [[], ['fire', 'mana'], ['lightning']]);
    const state = { ...prepared, enemies: prepared.enemies.map((unit) => ({ ...unit, intent: { id: 'idle', actions: [] } })) };

    const resolved = endTurn(state, db);

    expect(statusTurns(resolved.state.player.statuses, 'frostbite')).toBe(0);
  });

  it('resolves cold touch as attack seven followed by frostbite one', () => {
    const db = testDb({ 'winter-hand': winterHand() });

    const resolved = endTurn(combat(db, 'winter-hand'), db);

    expect(resolved.state.player.hp).toBe(63);
    expect(statusTurns(resolved.state.player.statuses, 'frostbite')).toBe(1);
  });

  it('resolves the winter-hand windup as frostbite two', () => {
    const db = testDb({ 'winter-hand': winterHand() });
    const base = combat(db, 'winter-hand');
    const primed = {
      ...base,
      enemies: base.enemies.map((unit) => ({ ...unit, intentIndex: 1, intent: winterHand().intents[1]! }))
    };

    const started = endTurn(primed, db);
    const resolved = endTurn(started.state, db);

    expect(statusTurns(resolved.state.player.statuses, 'frostbite')).toBe(2);
  });
});

describe('Directive 12 Batch B M14 ring bearer', () => {
  const ringBearer = () => enemy('ring-bearer', { maxHp: 65, roundGrowth: ringGrowth });

  it('starts M14 with the exact max HP and ring growth contract', () => {
    const db = testDb({ 'ring-bearer': ringBearer() });

    const state = combat(db, 'ring-bearer');

    expect(state.enemies[0]).toMatchObject({ maxHp: 65, growthStacks: 0, roundGrowth: ringGrowth });
  });

  it('reduces damage by eight percent for each active ring', () => {
    const db = testDb({ 'ring-bearer': ringBearer() });
    const base = combat(db, 'ring-bearer');
    const primed = { ...base, enemies: base.enemies.map((unit) => ({ ...unit, growthStacks: 5 })) };
    const events: CombatEvent[] = [];

    const damaged = applyDamage(primed, { type: 'enemy', index: 0 }, 20, 'skill', events, { type: 'player' });

    expect(damaged.enemies[0]?.hp).toBe(53);
    expect(events).toContainEqual({ type: 'damageDealt', target: { type: 'enemy', index: 0 }, amount: 12, blocked: 0, source: 'skill' });
  });

  it('records only actual HP damage toward the ring round total', () => {
    const db = testDb({ 'ring-bearer': ringBearer() });
    const base = combat(db, 'ring-bearer');
    const primed = { ...base, enemies: base.enemies.map((unit) => ({ ...unit, growthStacks: 0, block: 10 })) };
    const events: CombatEvent[] = [];

    const blocked = applyDamage(primed, { type: 'enemy', index: 0 }, 10, 'skill', events, { type: 'player' });
    const damaged = applyDamage(blocked, { type: 'enemy', index: 0 }, 6, 'poison', events, { type: 'player' });

    expect(damaged.enemies[0]?.damageTakenThisRound).toBe(6);
  });

  it('removes two rings after twenty-five percent actual HP damage, adds one ring, and resets the round total', () => {
    const db = testDb({ 'ring-bearer': ringBearer() });
    const base = combat(db, 'ring-bearer');
    const damaged = {
      ...base,
      enemies: base.enemies.map((unit) => ({ ...unit, growthStacks: 5, damageTakenThisRound: 17, hp: 48 }))
    };

    const resolved = endTurn(damaged, db);

    expect(resolved.state.enemies[0]?.growthStacks).toBe(4);
    expect(resolved.state.enemies[0]?.damageTakenThisRound).toBe(0);
  });

  it('removes one ring at fifteen percent, then applies the mandatory round-end gain', () => {
    const db = testDb({ 'ring-bearer': ringBearer() });
    const base = combat(db, 'ring-bearer');
    const damaged = {
      ...base,
      enemies: base.enemies.map((unit) => ({ ...unit, growthStacks: 3, damageTakenThisRound: 10, hp: 55 }))
    };

    const resolved = endTurn(damaged, db);

    expect(resolved.state.enemies[0]?.growthStacks).toBe(3);
    expect(resolved.events).toContainEqual({
      type: 'enemyGrowthReduced',
      enemy: 0,
      removed: 1,
      stacks: 2,
      damage: 10,
      threshold: 10
    });
  });

  it('heals three percent of max HP per ring at action start and caps growth at five', () => {
    const db = testDb({ 'ring-bearer': ringBearer() });
    const base = combat(db, 'ring-bearer');
    const wounded = {
      ...base,
      enemies: base.enemies.map((unit) => ({ ...unit, hp: 40, growthStacks: 2, damageTakenThisRound: 0 }))
    };

    const healed = endTurn(wounded, db);
    const capped = endTurn({ ...healed.state, enemies: healed.state.enemies.map((unit) => ({ ...unit, growthStacks: 5 })) }, db);

    expect(healed.state.enemies[0]?.hp).toBe(44);
    expect(healed.events).toContainEqual({ type: 'enemyHealed', enemy: 0, amount: 4, hp: 44 });
    expect(healed.state.enemies[0]?.growthStacks).toBe(3);
    expect(capped.state.enemies[0]?.growthStacks).toBe(5);
  });
});
