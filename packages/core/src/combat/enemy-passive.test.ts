// 몬스터 패시브 (P5.6 수직 슬라이스) — 자신 턴 시작 시 자동 발동, 자기 대상 원자만.
// 수치는 balance-provisional — 이 테스트는 발동 규칙만 고정하고 밸런스를 주장하지 않는다.
import { describe, expect, it } from 'vitest';

import type { ContentDb, EnemyDef } from '../content-types';
import { validateContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, PassiveId } from '../ids';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;

const regenGhoul = (): EnemyDef => ({
  id: id<EnemyDefId>('regen-ghoul'),
  name: '재생 구울',
  maxHp: 38,
  passive: {
    id: 'rotting-flesh',
    name: '썩은 육체',
    description: '자신의 턴이 시작될 때 HP를 1 회복한다',
    hook: 'enemyTurnStart',
    effects: [{ kind: 'heal', amount: 1 }]
  },
  intents: [{ id: 'idle', actions: [] }]
});

const testDb = (overrides?: Partial<EnemyDef>): ContentDb => ({
  coins: { basic: { id: id<CoinDefId>('basic'), element: null } },
  skills: {},
  enemies: {
    'regen-ghoul': { ...regenGhoul(), ...overrides },
    striker: {
      id: id<EnemyDefId>('striker'),
      name: '타격수',
      maxHp: 20,
      intents: [{ id: 'strike', actions: [{ kind: 'attack', damage: 3 }] }]
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
  passives: {
    'discharge-suppression': {
      id: id<PassiveId>('discharge-suppression'), name: '방전 억제', description: '',
      hook: 'combatStart', effects: [], mechanic: 'dischargeSuppression', element: 'lightning', price: 0
    }
  },
  validate: () => []
});

const endTurn = (state: CombatState, db: ContentDb) => {
  const result = step(state, { type: 'endTurn' }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const damageEnemy = (state: CombatState, index: number, amount: number): CombatState => ({
  ...state,
  enemies: state.enemies.map((enemy, i) => (i === index ? { ...enemy, hp: enemy.hp - amount } : enemy))
});

describe('enemy passive — enemyTurnStart', () => {
  it('heals 1 at the owner turn start and emits enemyPassiveTriggered', () => {
    const db = testDb();
    let state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('regen-ghoul')] },
      db,
      'passive-heal'
    );
    state = damageEnemy(state, 0, 8); // 38 → 30
    const result = endTurn(state, db);
    expect(result.state.enemies[0]?.hp).toBe(31);
    expect(
      result.events.some((event) => event.type === 'enemyPassiveTriggered' && event.passive === 'rotting-flesh' && event.enemy === 0)
    ).toBe(true);
    expect(result.events.some((event) => event.type === 'enemyHealed' && event.amount === 1)).toBe(true);
  });

  it('caps healing at maxHp (amount 0 when undamaged)', () => {
    const db = testDb();
    const state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('regen-ghoul')] },
      db,
      'passive-cap'
    );
    const result = endTurn(state, db);
    expect(result.state.enemies[0]?.hp).toBe(38);
    expect(result.events.some((event) => event.type === 'enemyHealed' && event.amount === 0)).toBe(true);
  });

  it('does not trigger for dead enemies', () => {
    const db = testDb();
    let state = createCombat(
      { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('regen-ghoul'), id<EnemyDefId>('striker')] },
      db,
      'passive-dead'
    );
    state = damageEnemy(state, 0, 38); // 죽음 — checkCombatEnd 없이 직접 0
    const result = endTurn(state, db);
    expect(result.state.enemies[0]?.hp).toBe(0);
    expect(result.events.some((event) => event.type === 'enemyPassiveTriggered')).toBe(false);
  });

  it('is deterministic — same seed, same passive outcome', () => {
    const db = testDb();
    const run = () => {
      let state = createCombat(
        { character: id<CharacterId>('warrior'), enemies: [id<EnemyDefId>('regen-ghoul')] },
        db,
        'passive-det'
      );
      state = damageEnemy(state, 0, 5);
      return endTurn(state, db).state.enemies[0]?.hp;
    };
    expect(run()).toBe(run());
  });

  it('uses the last targeted enemy to break equal-shock discharge suppression ties', () => {
    const db = testDb();
    const created = createCombat(
      {
        character: id<CharacterId>('warrior'),
        enemies: [id<EnemyDefId>('striker'), id<EnemyDefId>('striker')],
        passives: [id<PassiveId>('discharge-suppression')]
      },
      db,
      'discharge-tie'
    );
    const state: CombatState = {
      ...created,
      lastTargetedEnemy: 1,
      enemies: created.enemies.map((enemy) => ({
        ...enemy,
        statuses: { shock: { kind: 'duration', turns: 3 } }
      }))
    };

    const result = endTurn(state, db);
    expect(result.state.enemies[0]?.statuses.shock).toEqual({ kind: 'duration', turns: 2 });
    expect(result.state.enemies[1]?.statuses.shock).toEqual({ kind: 'duration', turns: 3 });
  });
});

describe('enemy passive — content validation', () => {
  it('rejects player-target atoms in passives', () => {
    const db = testDb({
      passive: {
        id: 'bad',
        name: '나쁨',
        description: '금지 원자',
        hook: 'enemyTurnStart',
        effects: [{ kind: 'attack', damage: 3 }]
      }
    });
    const errors = validateContentDb(db);
    expect(errors.some((error) => error.includes('only self-target actions'))).toBe(true);
  });

  it('rejects empty effects and non-positive amounts', () => {
    const emptyDb = testDb({
      passive: { id: 'empty', name: '빈', description: '', hook: 'enemyTurnStart', effects: [] }
    });
    expect(validateContentDb(emptyDb).some((error) => error.includes('at least one effect'))).toBe(true);
    const zeroDb = testDb({
      passive: {
        id: 'zero',
        name: '영',
        description: '',
        hook: 'enemyTurnStart',
        effects: [{ kind: 'heal', amount: 0 }]
      }
    });
    expect(validateContentDb(zeroDb).some((error) => error.includes('positive integer'))).toBe(true);
  });
});
