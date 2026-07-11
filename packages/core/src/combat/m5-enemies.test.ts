import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId } from '../ids';
import { createCombat, step } from './reducer';
import { statusTurns } from './state';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null }
  },
  skills: {},
  enemies: {
    shaman: {
      id: id<EnemyDefId>('shaman'),
      name: '주술사',
      maxHp: 60,
      intents: [
        { id: 'wither', actions: [{ kind: 'nextDrawPenalty', amount: 1 }] },
        { id: 'hex-strike', actions: [{ kind: 'attack', damage: 9 }] }
      ]
    },
    gatekeeper: {
      id: id<EnemyDefId>('gatekeeper'),
      name: '수문장',
      maxHp: 70,
      intents: [
        {
          id: 'guarded-strike',
          actions: [
            { kind: 'block', amount: 8 },
            { kind: 'attack', damage: 5 }
          ]
        },
        {
          id: 'guarded-strike-2',
          actions: [
            { kind: 'block', amount: 8 },
            { kind: 'attack', damage: 5 }
          ]
        },
        {
          id: 'fortified-strike',
          actions: [
            { kind: 'block', amount: 12 },
            { kind: 'attack', damage: 5 }
          ]
        }
      ]
    },
    buffer: {
      id: id<EnemyDefId>('buffer'),
      name: '버퍼',
      maxHp: 20,
      intents: [
        { id: 'focus', actions: [{ kind: 'buffNextAttack', amount: 4 }] },
        { id: 'strike', actions: [{ kind: 'attack', damage: 5 }] },
        { id: 'idle', actions: [] }
      ]
    },
    stacker: {
      id: id<EnemyDefId>('stacker'),
      name: '중첩 버퍼',
      maxHp: 20,
      intents: [
        { id: 'focus-1', actions: [{ kind: 'buffNextAttack', amount: 3 }] },
        { id: 'focus-2', actions: [{ kind: 'buffNextAttack', amount: 4 }] },
        { id: 'strike', actions: [{ kind: 'attack', damage: 3 }] }
      ]
    },
    guardedBuffer: {
      id: id<EnemyDefId>('guardedBuffer'),
      name: '방어 버퍼',
      maxHp: 20,
      intents: [
        { id: 'focus', actions: [{ kind: 'buffNextAttack', amount: 4 }] },
        { id: 'guard', actions: [{ kind: 'block', amount: 2 }] }
      ]
    },
    healer: {
      id: id<EnemyDefId>('healer'),
      name: '치유자',
      maxHp: 10,
      intents: [{ id: 'heal', actions: [{ kind: 'heal', amount: 5 }] }]
    },
    statusFiend: {
      id: id<EnemyDefId>('statusFiend'),
      name: '상태 악령',
      maxHp: 20,
      intents: [
        {
          id: 'double-shock-strike',
          actions: [
            { kind: 'applyStatus', status: 'shock', stacks: 1 },
            { kind: 'applyStatus', status: 'shock', stacks: 1 },
            { kind: 'attack', damage: 10 }
          ]
        },
        { id: 'frostbite', actions: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1 }] },
        { id: 'idle', actions: [] }
      ]
    }
  },
  characters: {
    warrior: {
      id: id<CharacterId>('warrior'),
      name: '전사',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [],
      trait: { id: 'none', name: '없음', hook: 'combatStart', effects: [] }
    }
  },
  validate: () => []
});

const endTurn = (state: CombatState, db: ContentDb) => {
  const result = step(state, { type: 'endTurn' }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('M5 enemy actions', () => {
  it('consumes Shaman Wither on the next draw only', () => {
    const db = testDb();
    const initial = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('shaman')] },
      db,
      'm5-shaman-wither'
    );

    const withered = endTurn(initial, db);
    expect(withered.state.zones.hand).toHaveLength(4);
    expect(withered.state.player.nextDrawPenalty).toBe(0);
    expect(withered.events).toContainEqual({
      type: 'witherApplied',
      enemy: 0,
      amount: 1,
      nextDrawPenalty: 1
    });
    expect(withered.state.enemies[0]?.intent.id).toBe('hex-strike');

    const recovered = endTurn(withered.state, db);
    expect(recovered.state.zones.hand).toHaveLength(5);
    expect(recovered.state.player.nextDrawPenalty).toBe(0);
    expect(recovered.state.player.hp).toBe(61);
    expect(recovered.events.some((event) => event.type === 'witherApplied')).toBe(false);
    expect(recovered.state.enemies[0]?.intent.id).toBe('wither');
  });

  it('clears Gatekeeper block immediately before its next deterministic action', () => {
    const run = () => {
      const db = testDb();
      let state = createCombat(
        { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('gatekeeper')] },
        db,
        'm5-gatekeeper-loop'
      );
      const trace: Array<{ block: number; revealed?: string; events: typeof state.events }> = [];

      for (let turn = 0; turn < 4; turn += 1) {
        const result = endTurn(state, db);
        state = result.state;
        const revealed = result.events.find((event) => event.type === 'intentRevealed');
        trace.push({
          block: state.enemies[0]?.block ?? -1,
          revealed: revealed?.type === 'intentRevealed' ? revealed.intent.id : undefined,
          events: result.events
        });
      }
      return trace;
    };

    const first = run();
    expect(first.map(({ block }) => block)).toEqual([8, 8, 12, 8]);
    expect(first.map(({ revealed }) => revealed)).toEqual([
      'guarded-strike-2',
      'fortified-strike',
      'guarded-strike',
      'guarded-strike-2'
    ]);

    for (const [index, expectedAmount] of [8, 8, 12].entries()) {
      const events = first[index + 1]?.events ?? [];
      const clearedAt = events.findIndex((event) => event.type === 'blockCleared');
      const gainedAt = events.findIndex((event) => event.type === 'blockGained');
      expect(events[clearedAt]).toMatchObject({ type: 'blockCleared', amount: expectedAmount });
      expect(clearedAt).toBeGreaterThanOrEqual(0);
      expect(gainedAt).toBeGreaterThan(clearedAt);
    }

    expect(run()).toEqual(first);
  });

  it('consumes buffNextAttack on the next attack once', () => {
    const db = testDb();
    let state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('buffer')] },
      db,
      'enemy-buff-once'
    );

    const buffed = endTurn(state, db);
    expect(buffed.state.enemies[0]?.nextAttackBonus).toBe(4);
    expect(buffed.events).toContainEqual({
      type: 'enemyAttackBuffed',
      enemy: 0,
      amount: 4,
      nextAttackBonus: 4
    });

    state = buffed.state;
    const attacked = endTurn(state, db);
    expect(attacked.state.player.hp).toBe(61);
    expect(attacked.state.enemies[0]?.nextAttackBonus).toBe(0);
    expect(attacked.events).toContainEqual({
      type: 'damageDealt',
      target: { type: 'player' },
      amount: 9,
      blocked: 0,
      source: 'enemy'
    });

    const unbuffed = endTurn(attacked.state, db);
    expect(unbuffed.state.player.hp).toBe(61);
    expect(unbuffed.state.enemies[0]?.nextAttackBonus).toBe(0);
  });

  it('adds repeated buffNextAttack actions before consuming them on one attack', () => {
    const db = testDb();
    let state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('stacker')] },
      db,
      'enemy-buff-stack'
    );

    state = endTurn(state, db).state;
    expect(state.enemies[0]?.nextAttackBonus).toBe(3);
    state = endTurn(state, db).state;
    expect(state.enemies[0]?.nextAttackBonus).toBe(7);

    const attacked = endTurn(state, db);
    expect(attacked.state.player.hp).toBe(60);
    expect(attacked.state.enemies[0]?.nextAttackBonus).toBe(0);
  });

  it('keeps buffNextAttack while non-attack intents resolve', () => {
    const db = testDb();
    let state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('guardedBuffer')] },
      db,
      'enemy-buff-persist'
    );

    state = endTurn(state, db).state;
    expect(state.enemies[0]?.nextAttackBonus).toBe(4);
    state = endTurn(state, db).state;
    expect(state.enemies[0]?.block).toBe(2);
    expect(state.enemies[0]?.nextAttackBonus).toBe(4);
  });

  it('clamps enemy heal actions to maxHp', () => {
    const db = testDb();
    const initial = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('healer')] },
      db,
      'enemy-heal-clamp'
    );
    const damaged = {
      ...initial,
      enemies: initial.enemies.map((enemy) => ({ ...enemy, hp: 8 }))
    };

    const healed = endTurn(damaged, db);
    expect(healed.state.enemies[0]?.hp).toBe(10);
    expect(healed.events).toContainEqual({ type: 'enemyHealed', enemy: 0, amount: 2, hp: 10 });
  });

  it('applies enemy statuses through the shared duration container and modifiers', () => {
    const db = testDb();
    let state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('statusFiend')] },
      db,
      'enemy-status-container'
    );

    const shocked = endTurn(state, db);
    expect(statusTurns(shocked.state.player.statuses, 'shock')).toBe(2);
    expect(shocked.state.player.hp).toBe(55);
    expect(shocked.events.filter((event) => event.type === 'statusApplied')).toEqual([
      { type: 'statusApplied', target: { type: 'player' }, status: 'shock', stacks: 1, turns: 1 },
      { type: 'statusApplied', target: { type: 'player' }, status: 'shock', stacks: 1, turns: 1 }
    ]);

    state = shocked.state;
    const frostbitten = endTurn(state, db);
    expect(statusTurns(frostbitten.state.player.statuses, 'shock')).toBe(1);
    expect(statusTurns(frostbitten.state.player.statuses, 'frostbite')).toBe(1);

    const expired = endTurn(frostbitten.state, db);
    expect(statusTurns(expired.state.player.statuses, 'shock')).toBe(0);
    expect(statusTurns(expired.state.player.statuses, 'frostbite')).toBe(0);
  });
});
