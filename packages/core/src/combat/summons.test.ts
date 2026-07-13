// P6 D6 — 소환 장비 엔진 계약 (결정 로그 §D6 규칙 전부 고정)
import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, EnemyDefId, EquipmentDefId, SlotId } from '../ids';
import { createCombat, step } from './reducer';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number): SlotId => value as SlotId;

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    mana: { id: id<CoinDefId>('mana'), element: 'mana' }
  },
  skills: {
    charge: {
      id: id('charge'),
      name: '마력 충전',
      type: 'flip',
      rarity: 'common',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'summonEquipment', equipment: 'chosen', duration: 2, durationPerTails: 1 }]
    },
    command: {
      id: id('command'),
      name: '명령',
      type: 'flip',
      rarity: 'common',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'commandChosenSummon', bonusPerTails: 1 }]
    },
    tune: {
      id: id('tune'),
      name: '병기 조율',
      type: 'flip',
      rarity: 'common',
      tags: ['utility'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'empowerSummons', amount: 1 }]
    },
    charge2: {
      id: id('charge2'),
      name: '마력 충전 II',
      type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cost: 1,
      base: [{ kind: 'summonEquipment', equipment: 'chosen', duration: 2, durationPerTails: 1 }]
    },
    charge3: {
      id: id('charge3'),
      name: '마력 충전 III',
      type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cost: 1,
      base: [{ kind: 'summonEquipment', equipment: 'chosen', duration: 2, durationPerTails: 1 }]
    },
    s6: { id: id('s6'), name: 's6', type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 1, base: [{ kind: 'damage', amount: 1 }] }
  },
  enemies: {
    dummy: {
      id: id<EnemyDefId>('dummy'),
      name: '허수아비',
      maxHp: 30,
      intents: [{ id: 'idle', actions: [] }]
    },
    frail: {
      id: id<EnemyDefId>('frail'),
      name: '약골',
      maxHp: 3,
      intents: [{ id: 'idle', actions: [] }]
    }
  },
  characters: {
    arcanist: {
      id: id<CharacterId>('arcanist'),
      name: '마도기사',
      maxHp: 65,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: ['charge', 'command', 'tune', 'charge2', 'charge3', 's6'].map((skill) => id(skill)),
      trait: {
        id: 'arcane-atelier',
        name: '마도 공방',
        hook: 'turnStart',
        effects: [{ kind: 'summonEquipment', equipment: id<EquipmentDefId>('mana-sword'), duration: 1 }]
      }
    }
  },
  equipment: {
    'mana-shield': {
      id: id<EquipmentDefId>('mana-shield'),
      name: '마나 방패',
      description: '턴 종료 시 방어 2',
      action: { kind: 'ward', block: 2 }
    },
    'mana-sword': {
      id: id<EquipmentDefId>('mana-sword'),
      name: '마나 검',
      description: '턴 종료 시 첫 적에게 피해 3',
      action: { kind: 'strike', damage: 3 }
    }
  },
  validate: () => []
});

const newCombat = (enemies: string[] = ['dummy'], seed = 'SUMMON-TEST'): CombatState =>
  createCombat(
    { character: id<CharacterId>('arcanist'), enemies: enemies.map((enemy) => id<EnemyDefId>(enemy)) },
    testDb(),
    seed
  );

// step은 이벤트를 반환값으로 준다 (state.events는 생성 시점 로그) — 둘 다 노출
const useSkillAt = (
  state: CombatState,
  slotIndex: number,
  db: ContentDb,
  extra?: Record<string, unknown>,
): { state: CombatState; events: readonly unknown[] } => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('no coin in hand');
  const placed = step(state, { type: 'placeCoin', coin, slot: slot(slotIndex) }, db);
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slot(slotIndex), ...extra }, db);
  if (!used.ok) throw new Error(used.error);
  return { state: used.state, events: used.events };
};

const endTurn = (state: CombatState, db: ContentDb) => {
  const result = step(state, { type: 'endTurn' }, db);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('소환 장비 엔진', () => {
  it('turnStart trait가 매 턴 마나 검(지속 1)을 소환한다', () => {
    const state = newCombat();
    expect(state.summons).toHaveLength(1);
    expect(String(state.summons[0]?.defId)).toBe('mana-sword');
    expect(state.summons[0]?.duration).toBe(1);
    expect(state.events.some((event) => event.type === 'summonAdded')).toBe(true);
  });

  it('턴 종료 시 슬롯 순서로 자동 행동 후 지속 1 감소, 0이면 소멸한다', () => {
    const db = testDb();
    const state = newCombat();
    const enemyHp = state.enemies[0]!.hp;
    const ended = endTurn(state, db);
    // 검 3 피해 → 지속 0 소멸 → 다음 턴 trait가 새 검 소환
    expect(ended.state.enemies[0]?.hp).toBe(enemyHp - 3);
    expect(ended.events.some((event) => event.type === 'summonActed')).toBe(true);
    expect(ended.events.some((event) => event.type === 'summonExpired')).toBe(true);
    expect(ended.state.summons).toHaveLength(1); // 새 턴의 trait 소환
  });

  it('선택 장비 소환 + 뒷면당 지속 연장, 슬롯 3개가 가득 차면 새 소환 불발', () => {
    const db = testDb();
    let state = newCombat();
    // trait 검 1개 존재. 방패 2개 추가 소환 → 3 슬롯 꽉 참 (스킬 사용 상한 3/턴 내)
    state = useSkillAt(state, 0, db, { chosenEquipment: id<EquipmentDefId>('mana-shield') }).state;
    state = useSkillAt(state, 3, db, { chosenEquipment: id<EquipmentDefId>('mana-shield') }).state;
    expect(state.summons).toHaveLength(3);
    // 4번째 소환은 불발하고 기존 3개를 그대로 유지한다.
    const before = state.summons;
    const nextSummonUid = state.nextSummonUid;
    const fourth = useSkillAt(state, 4, db, { chosenEquipment: id<EquipmentDefId>('mana-shield') });
    state = fourth.state;
    expect(state.summons).toEqual(before);
    expect(state.nextSummonUid).toBe(nextSummonUid);
    expect(fourth.events.some((event) => (event as { type: string }).type === 'summonAdded')).toBe(false);
    expect(fourth.events.some((event) => (event as { type: string }).type === 'summonReplaced')).toBe(false);
  });

  it('명령: 선택 소환 즉시 행동 + 지속 -1, 강화 보너스가 행동에 더해진다', () => {
    const db = testDb();
    let state = newCombat();
    const swordUid = state.summons[0]!.uid;
    const enemyHp = state.enemies[0]!.hp;
    // 조율(+1 강화) 후 명령 — 검 피해 3 + 강화 1 + 뒷면 보너스(면은 시드 의존이라 이벤트로 계산)
    state = useSkillAt(state, 2, db).state;
    const command = useSkillAt(state, 1, db, { chosenSummon: swordUid });
    state = command.state;
    const tails = command.events.filter(
      (event) =>
        (event as { type: string; face?: string }).type === 'coinFlipped' &&
        (event as { face: string }).face === 'tails',
    ).length;
    expect(state.enemies[0]?.hp).toBe(enemyHp - (3 + 1 + tails));
    // 지속 1이던 검이 명령으로 0 → 소멸
    expect(state.summons.some((summon) => summon.uid === swordUid)).toBe(false);
  });

  it('적 사망 시 다음 인덱스 재타깃, 전멸 시 승리로 종료한다', () => {
    const db = testDb();
    let state = newCombat(['frail', 'dummy']);
    // 방패+검 2개 소환 후 턴 종료: 검(trait)이 frail(3HP) 처치 후 추가 검 소환분이 dummy 타격
    state = useSkillAt(state, 0, db, { chosenEquipment: id<EquipmentDefId>('mana-sword') }).state;
    const dummyHp = state.enemies[1]!.hp;
    const ended = endTurn(state, db);
    expect(ended.state.enemies[0]?.hp).toBe(0);
    // 두 번째 검 행동은 살아있는 최소 인덱스(=1)로 재타깃
    expect(ended.state.enemies[1]!.hp).toBeLessThan(dummyHp);
  });

  it('결정론: 같은 시드·같은 커맨드 열이면 소환 상태가 동일하다', () => {
    const db = testDb();
    const play = () => {
      let state = newCombat(['dummy'], 'SUMMON-DET');
      state = useSkillAt(state, 0, db, { chosenEquipment: id<EquipmentDefId>('mana-shield') }).state;
      const ended = endTurn(state, db);
      return JSON.stringify({
        summons: ended.state.summons,
        hp: ended.state.enemies[0]?.hp,
        block: ended.state.player.block
      });
    };
    expect(play()).toBe(play());
  });
});
