import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId } from '../ids';
import type { CombatEvent } from './events';
import { applyDamage } from './resolve/flip';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;

const enemy = (idValue: string, overrides: Partial<EnemyDef>): EnemyDef => ({
  id: id<EnemyDefId>(idValue),
  name: idValue,
  maxHp: 30,
  intents: [{ id: 'idle', actions: [] }],
  ...overrides
});

const db = (enemies: Record<string, EnemyDef>): ContentDb => ({
  coins: { basic: { id: id<CoinDefId>('basic'), element: null } },
  skills: {},
  enemies,
  characters: {
    hero: {
      id: id<CharacterId>('hero'),
      name: 'Hero',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [],
      trait: { id: 'none', name: 'None', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const combat = (content: ContentDb, enemies: readonly string[]): CombatState =>
  createCombat({ character: id<CharacterId>('hero'), enemies: enemies.map((value) => id<EnemyDefId>(value)) }, content, 'enemy-atoms');

const endTurn = (state: CombatState, content: ContentDb): ReturnType<typeof step> & { ok: true } => {
  const result = step(state, { type: 'endTurn' }, content);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('enemy atoms — windup', () => {
  it('starts a countdown, holds the intent, then resolves after the countdown', () => {
    const content = db({
      lancer: enemy('lancer', {
        intents: [
          { id: 'pierce', windup: { turns: 1, revealAtStart: true }, actions: [{ kind: 'attack', damage: 8 }] },
          { id: 'rest', actions: [] }
        ]
      })
    });
    const started = endTurn(combat(content, ['lancer']), content);
    expect(started.state.player.hp).toBe(70);
    expect(started.state.enemies[0]?.intent.id).toBe('pierce');
    expect(started.state.enemies[0]?.windup?.turnsLeft).toBe(1);
    expect(started.events).toContainEqual({
      type: 'enemyWindupStarted',
      enemy: 0,
      intent: content.enemies.lancer!.intents[0]!,
      turnsLeft: 1
    });

    const resolved = endTurn(started.state, content);
    expect(resolved.state.player.hp).toBe(62);
    expect(resolved.state.enemies[0]?.intent.id).toBe('rest');
    expect(resolved.events).toContainEqual({
      type: 'enemyWindupTicked',
      enemy: 0,
      intent: content.enemies.lancer!.intents[0]!,
      turnsLeft: 0
    });
  });

  it('cancels on the damage threshold and applies vulnerability only while winding up', () => {
    const content = db({
      lancer: enemy('lancer', {
        maxHp: 30,
        intents: [
          {
            id: 'pierce',
            windup: { turns: 1, revealAtStart: true },
            cancelOn: { damageThreshold: 6 },
            vulnerableWhileWindup: 1.5,
            actions: [{ kind: 'attack', damage: 8 }]
          },
          { id: 'rest', actions: [] }
        ]
      })
    });
    const started = endTurn(combat(content, ['lancer']), content).state;
    const events: CombatEvent[] = [];
    const damaged = applyDamage(started, { type: 'enemy', index: 0 }, 4, 'skill', events, { type: 'player' });
    expect(damaged.enemies[0]?.hp).toBe(24);
    expect(events).toContainEqual({ type: 'enemyWindupCancelled', enemy: 0, intent: content.enemies.lancer!.intents[0]! });

    const skipped = endTurn(damaged, content);
    expect(skipped.state.player.hp).toBe(70);
    expect(skipped.state.enemies[0]?.intent.id).toBe('rest');

    const normalEvents: CombatEvent[] = [];
    const normal = applyDamage(skipped.state, { type: 'enemy', index: 0 }, 4, 'skill', normalEvents, { type: 'player' });
    expect(normal.enemies[0]?.hp).toBe(20);
  });
});

describe('enemy atoms — branching and phases', () => {
  it('uses the conditional attack bonus only below half player HP', () => {
    const content = db({
      hound: enemy('hound', {
        intents: [{ id: 'leap', actions: [{ kind: 'conditionalAttack', damage: 5, bonusDamage: 4, condition: 'playerHpBelowHalf' }] }]
      })
    });
    expect(endTurn({ ...combat(content, ['hound']), player: { ...combat(content, ['hound']).player, hp: 35 } }, content).state.player.hp).toBe(30);
    expect(endTurn({ ...combat(content, ['hound']), player: { ...combat(content, ['hound']).player, hp: 34 } }, content).state.player.hp).toBe(25);
  });

  it('changes to the HP phase once and uses that intent table afterward', () => {
    const content = db({
      berserker: enemy('berserker', {
        maxHp: 20,
        intents: [
          { id: 'base-a', actions: [] },
          { id: 'base-b', actions: [] }
        ],
        phases: [
          {
            hpBelowFraction: 0.5,
            intents: [
              { id: 'rage-a', actions: [{ kind: 'attack', damage: 3 }] },
              { id: 'rage-b', actions: [] }
            ]
          }
        ]
      })
    });
    const changed = endTurn(
      { ...combat(content, ['berserker']), enemies: combat(content, ['berserker']).enemies.map((unit) => ({ ...unit, hp: 9 })) },
      content
    );
    expect(changed.events.filter((event) => event.type === 'enemyPhaseChanged')).toHaveLength(1);
    expect(changed.state.enemies[0]?.intent.id).toBe('rage-a');

    const next = endTurn(changed.state, content);
    expect(next.state.player.hp).toBe(67);
    expect(next.events.filter((event) => event.type === 'enemyPhaseChanged')).toHaveLength(0);
    expect(next.state.enemies[0]?.intent.id).toBe('rage-b');
  });
});

describe('enemy atoms — growth and ally healing', () => {
  it('grows on HP damage, adds stacks to attacks, shrinks on full block, and floors at zero', () => {
    const content = db({
      vampire: enemy('vampire', {
        intents: [
          {
            id: 'bite',
            actions: [
              { kind: 'attack', damage: 3 },
              { kind: 'growOnUnblockedDamage', amount: 1, healOnGrow: 2 }
            ]
          }
        ]
      })
    });
    const first = endTurn({ ...combat(content, ['vampire']), enemies: combat(content, ['vampire']).enemies.map((unit) => ({ ...unit, hp: 20 })) }, content);
    expect(first.state.player.hp).toBe(67);
    expect(first.state.enemies[0]?.growthStacks).toBe(1);
    expect(first.state.enemies[0]?.hp).toBe(22);
    expect(first.events).toContainEqual({ type: 'enemyGrew', enemy: 0, stacks: 1 });

    const blocked = endTurn({ ...first.state, player: { ...first.state.player, block: 99 } }, content);
    expect(blocked.state.player.hp).toBe(67);
    expect(blocked.state.enemies[0]?.growthStacks).toBe(0);
    expect(blocked.events).toContainEqual({ type: 'enemyGrew', enemy: 0, stacks: 0 });

    const floored = endTurn({ ...blocked.state, player: { ...blocked.state.player, block: 99 } }, content);
    expect(floored.state.enemies[0]?.growthStacks).toBe(0);
  });

  it('binds healAlly at windup start and fails if that ally is dead at resolution', () => {
    const content = db({
      healer: enemy('healer', {
        intents: [{ id: 'mend', windup: { turns: 1, revealAtStart: true }, actions: [{ kind: 'healAlly', amount: 6, target: 'lowestHpAlly' }] }]
      }),
      guard: enemy('guard', { maxHp: 30, intents: [{ id: 'idle', actions: [] }] }),
      bruiser: enemy('bruiser', { maxHp: 30, intents: [{ id: 'idle', actions: [] }] })
    });
    const base = combat(content, ['healer', 'guard', 'bruiser']);
    const wounded = {
      ...base,
      enemies: base.enemies.map((unit, index) => (index === 1 ? { ...unit, hp: 5 } : index === 2 ? { ...unit, hp: 10 } : unit))
    };
    const started = endTurn(wounded, content).state;
    expect(started.enemies[0]?.windup?.boundHealAlly).toBe(1);

    const killedTarget = { ...started, enemies: started.enemies.map((unit, index) => (index === 1 ? { ...unit, hp: 0 } : unit)) };
    const failed = endTurn(killedTarget, content);
    expect(failed.events).toContainEqual({ type: 'enemyHealFailed', enemy: 0, target: 1 });
    expect(failed.state.enemies[2]?.hp).toBe(10);
  });
});
