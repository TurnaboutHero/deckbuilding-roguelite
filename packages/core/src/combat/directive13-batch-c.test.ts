import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, SlotId } from '../ids';
import { createCombat, step } from './reducer';
import { applyDamage } from './resolve/flip';
import type { CombatState } from './state';
import type { CombatEvent } from './events';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

/**
 * Directive 13 deliberately keeps the Batch C fields locally structural until
 * the production schema lands.  The assertions below are the behavior
 * contract; implementation is free to name the internal runtime state
 * differently as long as the shared resolver produces these results.
 */
const batchCEnemy = (value: string, maxHp: number, extras: Record<string, unknown> = {}): EnemyDef =>
  ({
    id: id<EnemyDefId>(value),
    name: value,
    maxHp,
    intents: [{ id: 'idle', actions: [] }],
    ...extras
  }) as unknown as EnemyDef;

const testDb = (enemies: Record<string, EnemyDef>): ContentDb => ({
  coins: { basic: { id: id<CoinDefId>('basic'), element: null } },
  skills: {
    jab: {
      id: id('jab'),
      name: 'Jab',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      cooldown: 0,
      base: [{ kind: 'damage', amount: 1 }]
    },
    'double-jab': {
      id: id('double-jab'),
      name: 'Double Jab',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      cooldown: 0,
      base: [
        { kind: 'damage', amount: 1 },
        { kind: 'damage', amount: 1 }
      ]
    }
  },
  enemies,
  characters: {
    hero: {
      id: id<CharacterId>('hero'),
      name: 'hero',
      maxHp: 70,
      startingBag: Array.from({ length: 8 }, () => id<CoinDefId>('basic')),
      startingSkills: [id('jab'), id('double-jab')],
      trait: { id: 'none', name: 'none', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (db: ContentDb, enemies: readonly string[]): CombatState =>
  createCombat({ character: id<CharacterId>('hero'), enemies: enemies.map((enemy) => id<EnemyDefId>(enemy)) }, db, 'directive13-batch-c');

const endTurn = (state: CombatState, db: ContentDb) => {
  const result = step(state, { type: 'endTurn' }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const useAttack = (state: CombatState, target: number, db: ContentDb, slotIndex = 0): CombatState => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('expected a coin in hand');
  const used = step(state, { type: 'useImmediateFlipSkill', slot: slot(slotIndex), coins: [coin], target }, db);
  if (!used.ok) throw new Error(used.error);
  return used.state;
};

describe('Directive 13 Batch C M05 fortress guard protection link', () => {
  const fortressGuard = () =>
    batchCEnemy('fortress-guard', 100, {
      protectionLink: {
        target: 'highestThreatAlly',
        redirectFraction: 0.4,
        durability: 3,
        restoreDurability: 2,
        brokenTurns: 2,
        damageTakenMultiplierWhileBroken: 1.2
      }
    });

  const priorityAlly = () => batchCEnemy('priority-ally', 50, { threat: 10 });

  it('redirects forty percent after target status modifiers and lets each unit block its own share', () => {
    const db = testDb({ 'fortress-guard': fortressGuard(), 'priority-ally': priorityAlly() });
    const base = combat(db, ['fortress-guard', 'priority-ally']);
    const state = {
      ...base,
      enemies: base.enemies.map((enemy, index) =>
        index === 0
          ? { ...enemy, block: 2 }
          : { ...enemy, block: 4, statuses: { shock: { kind: 'duration' as const, turns: 1 } } }
      )
    };
    const events: CombatEvent[] = [];

    const resolved = applyDamage(state, { type: 'enemy', index: 1 }, 10, 'skill', events, { type: 'player' });

    // Shock raises the original hit to 15.  The link splits that modified hit
    // into 9 / 6, then independent blocks absorb 4 / 2.
    expect(resolved.enemies.map((enemy) => enemy.hp)).toEqual([96, 45]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'damageRedirected', protector: 0, protected: 1, amount: 6 })
    );
  });

  it('cleans a protection link during the same resolution that kills its protector', () => {
    const db = testDb({ 'fortress-guard': fortressGuard(), 'priority-ally': priorityAlly() });
    const base = combat(db, ['fortress-guard', 'priority-ally']);
    const state = { ...base, enemies: base.enemies.map((enemy, index) => (index === 0 ? { ...enemy, hp: 6 } : enemy)) };
    const firstEvents: CombatEvent[] = [];

    const protectorKilled = applyDamage(state, { type: 'enemy', index: 1 }, 20, 'skill', firstEvents, { type: 'player' });

    expect(protectorKilled.enemies.map((enemy) => enemy.hp)).toEqual([0, 38]);
    expect(firstEvents).toContainEqual(expect.objectContaining({ type: 'protectionLinkRemoved', protector: 0, protected: 1 }));

    const secondEvents: CombatEvent[] = [];
    const afterCleanup = applyDamage(protectorKilled, { type: 'enemy', index: 1 }, 10, 'skill', secondEvents, { type: 'player' });
    expect(afterCleanup.enemies[1]?.hp).toBe(28);
    expect(secondEvents.some((event) => event.type === 'damageRedirected')).toBe(false);
  });

  it('does not spend shield durability when the original attack target is the protected ally', () => {
    const db = testDb({ 'fortress-guard': fortressGuard(), 'priority-ally': priorityAlly() });
    const state = useAttack(combat(db, ['fortress-guard', 'priority-ally']), 1, db);

    expect(state.enemies[0]).toMatchObject({ protectionLink: expect.objectContaining({ durability: 3, active: true }) });
  });

  it('spends one durability for a multi-atom attack whose original target is the guardian', () => {
    const db = testDb({ 'fortress-guard': fortressGuard(), 'priority-ally': priorityAlly() });
    const state = useAttack(combat(db, ['fortress-guard', 'priority-ally']), 0, db, 1);

    expect(state.enemies[0]).toMatchObject({ protectionLink: expect.objectContaining({ durability: 2, active: true }) });
  });

  it('breaks the link after three original attack skills target the guardian', () => {
    const db = testDb({ 'fortress-guard': fortressGuard(), 'priority-ally': priorityAlly() });
    let state = combat(db, ['fortress-guard', 'priority-ally']);

    state = useAttack(state, 0, db);
    state = useAttack(state, 0, db);
    state = useAttack(state, 0, db);

    expect(state.enemies[0]).toMatchObject({ protectionLink: expect.objectContaining({ active: false, turnsUntilRestore: 2 }) });
  });

  it('restores the configured durability after two complete enemy phases', () => {
    const db = testDb({ 'fortress-guard': fortressGuard(), 'priority-ally': priorityAlly() });
    let state = combat(db, ['fortress-guard', 'priority-ally']);
    state = useAttack(state, 0, db);
    state = useAttack(state, 0, db);
    state = useAttack(state, 0, db);

    const firstPhase = endTurn(state, db);
    expect(firstPhase.state.enemies[0]).toMatchObject({ protectionLink: expect.objectContaining({ active: false, turnsUntilRestore: 1 }) });
    const secondPhase = endTurn(firstPhase.state, db);
    expect(secondPhase.state.enemies[0]).toMatchObject({ protectionLink: expect.objectContaining({ active: true, durability: 2, turnsUntilRestore: 0 }) });
  });

  it('tracks the protected petrified target raw hit before shock, petrify, and redirect rounding', () => {
    const petrifiedAlly = batchCEnemy('petrified-ally', 100, {
      threat: 10,
      petrify: {
        damageReduction: 0.7,
        shatterRawDamageFraction: 0.2,
        crackedTurns: 1,
        crackedDamageTakenMultiplier: 1.3,
        cancelWindupIntentId: 'falling-assault'
      },
      intents: [{ id: 'falling-assault', windup: { turns: 1, revealAtStart: true }, actions: [] }]
    });
    const db = testDb({ 'fortress-guard': fortressGuard(), 'petrified-ally': petrifiedAlly });
    const base = combat(db, ['fortress-guard', 'petrified-ally']);
    const primed = {
      ...base,
      enemies: base.enemies.map((enemy, index) => index === 1
        ? { ...enemy, petrifyActive: true, petrifyRawDamage: 0, statuses: { shock: { kind: 'duration' as const, turns: 1 } } }
        : enemy)
    };
    const events: CombatEvent[] = [];
    const first = applyDamage(primed, { type: 'enemy', index: 1 }, 10, 'skill', events, { type: 'player' });
    expect(first.enemies[1]?.petrifyRawDamage).toBe(15);
    expect(events).toContainEqual(expect.objectContaining({ type: 'petrifyProgressed', enemy: 1, rawDamage: 15 }));
    const shattered = applyDamage(first, { type: 'enemy', index: 1 }, 4, 'skill', events, { type: 'player' });
    expect(shattered.enemies[1]).toMatchObject({ petrifyActive: false, crackedTurns: 1 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'petrifyShattered', enemy: 1, rawDamage: 21 }));
  });
});

describe('Directive 13 Batch C M06 cathedral gargoyle', () => {
  const gargoyle = () =>
    batchCEnemy('cathedral-gargoyle', 100, {
      petrify: {
        damageReduction: 0.7,
        shatterRawDamageFraction: 0.2,
        crackedTurns: 1,
        crackedDamageTakenMultiplier: 1.3,
        cancelWindupIntentId: 'falling-assault'
      },
      intents: [
        { id: 'claw', actions: [] },
        { id: 'petrify', actions: [], entersPetrify: true },
        { id: 'falling-assault', windup: { turns: 1, revealAtStart: true }, actions: [] }
      ]
    });

  it('does not apply petrify reduction before the petrify intent resolves', () => {
    const db = testDb({ 'cathedral-gargoyle': gargoyle() });
    const events: CombatEvent[] = [];

    const resolved = applyDamage(combat(db, ['cathedral-gargoyle']), { type: 'enemy', index: 0 }, 10, 'skill', events, { type: 'player' });

    expect(resolved.enemies[0]?.hp).toBe(90);
  });

  it('enters petrify when the petrify intent resolves and then telegraphs the falling assault', () => {
    const db = testDb({ 'cathedral-gargoyle': gargoyle() });
    const base = combat(db, ['cathedral-gargoyle']);
    const primed = {
      ...base,
      enemies: base.enemies.map((enemy) => ({ ...enemy, intentIndex: 1, intent: gargoyle().intents[1]! }))
    };

    const entered = endTurn(primed, db);

    expect(entered.state.enemies[0]).toMatchObject({ petrifyActive: true, petrifyRawDamage: 0 });
    expect(entered.state.enemies[0]?.intent.id).toBe('falling-assault');
  });

  it('reduces active petrified damage by seventy percent while tracking the pre-reduction amount', () => {
    const db = testDb({ 'cathedral-gargoyle': gargoyle() });
    const base = combat(db, ['cathedral-gargoyle']);
    const petrified = {
      ...base,
      enemies: base.enemies.map((enemy) => ({ ...enemy, petrifyActive: true, petrifyRawDamage: 0 }))
    };
    const events: CombatEvent[] = [];

    const resolved = applyDamage(petrified, { type: 'enemy', index: 0 }, 10, 'skill', events, { type: 'player' });

    expect(resolved.enemies[0]?.hp).toBe(97);
    expect(events).toContainEqual(expect.objectContaining({ type: 'petrifyProgressed', enemy: 0, rawDamage: 10, threshold: 20 }));
  });

  it('uses pre-reduction damage to shatter petrify, cancel the dive, and expose one cracked turn', () => {
    const db = testDb({ 'cathedral-gargoyle': gargoyle() });
    const base = combat(db, ['cathedral-gargoyle']);
    const primed = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy,
        petrifyActive: true,
        petrifyRawDamage: 0,
        intentIndex: 2,
        intent: gargoyle().intents[2]!,
        windup: { intent: gargoyle().intents[2]!, turnsLeft: 1, startHp: 100, cancelThreshold: 20 }
      }))
    };
    const events: CombatEvent[] = [];

    const shattered = applyDamage(primed, { type: 'enemy', index: 0 }, 20, 'skill', events, { type: 'player' });
    const cracked = applyDamage(shattered, { type: 'enemy', index: 0 }, 10, 'skill', events, { type: 'player' });

    expect(shattered.enemies[0]).toMatchObject({ hp: 94, windup: undefined, crackedTurns: 1 });
    expect(cracked.enemies[0]?.hp).toBe(81);
    expect(events).toContainEqual(expect.objectContaining({ type: 'enemyWindupCancelled', enemy: 0 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'petrifyShattered', enemy: 0, rawDamage: 20 }));
  });

  it('counts low pre-petrify hits exactly and expires cracked after one player response window', () => {
    const db = testDb({ 'cathedral-gargoyle': gargoyle() });
    const base = combat(db, ['cathedral-gargoyle']);
    let state: CombatState = {
      ...base,
      enemies: base.enemies.map((enemy) => ({ ...enemy, petrifyActive: true, petrifyRawDamage: 17 }))
    };
    const events: CombatEvent[] = [];
    state = applyDamage(state, { type: 'enemy', index: 0 }, 1, 'skill', events, { type: 'player' });
    state = applyDamage(state, { type: 'enemy', index: 0 }, 1, 'skill', events, { type: 'player' });
    state = applyDamage(state, { type: 'enemy', index: 0 }, 1, 'skill', events, { type: 'player' });
    expect(state.enemies[0]).toMatchObject({ petrifyActive: false, crackedTurns: 1 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'petrifyShattered', rawDamage: 20 }));

    const nextWindow = endTurn(state, db);
    expect(nextWindow.state.enemies[0]?.crackedTurns).toBe(0);
  });

  it('clears unshattered petrify after the configured falling assault resolves', () => {
    const db = testDb({ 'cathedral-gargoyle': gargoyle() });
    const base = combat(db, ['cathedral-gargoyle']);
    const activeDive = {
      ...base,
      enemies: base.enemies.map((enemy) => ({
        ...enemy,
        petrifyActive: true,
        petrifyRawDamage: 4,
        intentIndex: 2,
        intent: gargoyle().intents[2]!,
        windup: { intent: gargoyle().intents[2]!, turnsLeft: 1, startHp: enemy.hp }
      }))
    };
    const resolved = endTurn(activeDive, db);
    expect(resolved.state.enemies[0]).toMatchObject({ petrifyActive: false, petrifyRawDamage: 0 });
  });
});

describe('Directive 13 Batch C M08 war-banner rider', () => {
  const warBannerRider = () =>
    batchCEnemy('war-banner-rider', 40, {
      warBanner: {
        attackAuraPercent: 0.1,
        march: { attackPercent: 0.2, turns: 2, shieldMaxHpFraction: 0.08 }
      },
      intents: [
        { id: 'banner-strike', actions: [{ kind: 'attack', damage: 10 }] },
        { id: 'royal-march', windup: { turns: 1, revealAtStart: true }, actions: [], groupMarch: true }
      ]
    });

  const soldier = () =>
    batchCEnemy('banner-soldier', 50, {
      intents: [{ id: 'strike', actions: [{ kind: 'attack', damage: 10 }] }]
    });

  it('applies the living rider ten-percent attack aura to other enemies but excludes the rider', () => {
    const db = testDb({ 'war-banner-rider': warBannerRider(), 'banner-soldier': soldier() });

    const resolved = endTurn(combat(db, ['war-banner-rider', 'banner-soldier']), db);

    // The rider deals its unmodified 10, then the soldier deals 11.
    expect(resolved.state.player.hp).toBe(49);
    expect(resolved.events).toContainEqual(expect.objectContaining({ type: 'enemyAuraApplied', source: 0, target: 1, percent: 0.1 }));
    expect(resolved.events).not.toContainEqual(expect.objectContaining({ type: 'enemyAuraApplied', source: 0, target: 0 }));
  });

  it('removes only rider-owned march shield on death and preserves unrelated block', () => {
    const db = testDb({ 'war-banner-rider': warBannerRider(), 'banner-soldier': soldier() });
    const base = combat(db, ['war-banner-rider', 'banner-soldier']);
    const primed = {
      ...base,
      enemies: base.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, intentIndex: 1, intent: warBannerRider().intents[1]! } : enemy
      )
    };
    const marchStarted = endTurn(primed, db);
    const marched = endTurn(marchStarted.state, db);

    expect(marched.state.enemies[1]).toMatchObject({ block: 4, marchShield: 4, marchTurns: 1, marchSource: 0 });

    const withUnrelatedBlock = {
      ...marched.state,
      enemies: marched.state.enemies.map((enemy, index) => (index === 1 ? { ...enemy, block: enemy.block + 7 } : enemy))
    };

    const events: CombatEvent[] = [];
    const riderKilled = applyDamage(withUnrelatedBlock, { type: 'enemy', index: 0 }, 43, 'skill', events, { type: 'player' });

    expect(riderKilled.enemies[1]).toMatchObject({ block: 7, marchShield: 0, marchTurns: 0 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'enemyAuraRemoved', source: 0 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'enemyMarchRemoved', source: 0, target: 1 }));
  });

  it('expires the source-owned march after two enemy rounds', () => {
    const db = testDb({ 'war-banner-rider': warBannerRider(), 'banner-soldier': soldier() });
    const base = combat(db, ['war-banner-rider', 'banner-soldier']);
    const primed = {
      ...base,
      enemies: base.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, intentIndex: 1, intent: warBannerRider().intents[1]! } : enemy
      )
    };
    const marchStarted = endTurn(primed, db);
    const marched = endTurn(marchStarted.state, db);

    const expired = endTurn(marched.state, db);

    expect(marched.state.enemies[1]).toMatchObject({ marchTurns: 1, marchSource: 0 });
    expect(expired.state.enemies[1]).toMatchObject({ marchTurns: 0, marchShield: 0, marchAttackPercent: 0 });
    expect(expired.events).toContainEqual(expect.objectContaining({ type: 'enemyMarchRemoved', source: 0, target: 1 }));
  });

  it('keeps source-owned shield through generic block clearing and consumes its attributable remainder', () => {
    const db = testDb({ 'war-banner-rider': warBannerRider(), 'banner-soldier': soldier() });
    const base = combat(db, ['war-banner-rider', 'banner-soldier']);
    const primed = {
      ...base,
      enemies: base.enemies.map((enemy, index) => index === 0 ? { ...enemy, intentIndex: 1, intent: warBannerRider().intents[1]! } : enemy)
    };
    const started = endTurn(primed, db);
    const marched = endTurn(started.state, db);
    expect(marched.state.enemies[0]).toMatchObject({ marchSource: 0, marchShield: 3, marchTurns: 1 });
    expect(marched.state.enemies[1]).toMatchObject({ block: 4, marchShield: 4, marchTurns: 1 });
    const damageEvents: CombatEvent[] = [];
    const damaged = applyDamage(marched.state, { type: 'enemy', index: 1 }, 3, 'skill', damageEvents, { type: 'player' });
    expect(damaged.enemies[1]).toMatchObject({ block: 1, marchShield: 1 });
  });

  it('buffs exactly two enemy attack phases before the march expires', () => {
    const timerRider = batchCEnemy('timer-rider', 40, {
      warBanner: { attackAuraPercent: 0.1, march: { attackPercent: 0.2, turns: 2, shieldMaxHpFraction: 0.08 } },
      intents: [
        { id: 'idle', actions: [] },
        { id: 'royal-march', windup: { turns: 1, revealAtStart: true }, actions: [], groupMarch: true }
      ]
    });
    const db = testDb({ 'timer-rider': timerRider, 'banner-soldier': soldier() });
    const base = combat(db, ['timer-rider', 'banner-soldier']);
    const primed = { ...base, enemies: base.enemies.map((enemy, index) => index === 0 ? { ...enemy, intentIndex: 1, intent: timerRider.intents[1]! } : enemy) };
    const windup = endTurn(primed, db);
    const firstBuffed = endTurn(windup.state, db);
    const secondBuffed = endTurn(firstBuffed.state, db);
    const unbuffed = endTurn(secondBuffed.state, db);

    expect(windup.state.player.hp - firstBuffed.state.player.hp).toBe(13);
    expect(firstBuffed.state.player.hp - secondBuffed.state.player.hp).toBe(13);
    expect(secondBuffed.state.player.hp - unbuffed.state.player.hp).toBe(11);
    expect(secondBuffed.state.enemies[1]).toMatchObject({ marchTurns: 0, marchShield: 0 });
  });

  it('shares aura and march attack scaling with conditional attacks and cleans a dead source once', () => {
    const conditional = batchCEnemy('conditional-soldier', 50, {
      intents: [{ id: 'conditional', actions: [{ kind: 'conditionalAttack', damage: 10, bonusDamage: 0, condition: 'playerHpBelowHalf' }] }]
    });
    const db = testDb({ 'war-banner-rider': warBannerRider(), 'conditional-soldier': conditional });
    const base = combat(db, ['war-banner-rider', 'conditional-soldier']);
    const auraOnly = endTurn({ ...base, enemies: base.enemies.map((enemy, index) => index === 0 ? { ...enemy, intent: { id: 'idle', actions: [] } } : enemy) }, db);
    expect(auraOnly.state.player.hp).toBe(59);

    const deathEvents: CombatEvent[] = [];
    const killed = applyDamage(base, { type: 'enemy', index: 0 }, 40, 'skill', deathEvents, { type: 'player' });
    expect(deathEvents.filter((event) => event.type === 'enemyAuraRemoved')).toHaveLength(1);
    const laterEvents: CombatEvent[] = [];
    applyDamage(killed, { type: 'enemy', index: 1 }, 1, 'skill', laterEvents, { type: 'player' });
    expect(laterEvents.some((event) => event.type === 'enemyAuraRemoved')).toBe(false);
  });
});
