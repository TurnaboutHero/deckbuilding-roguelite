import { describe, expect, it } from 'vitest';

import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import { legalCommands } from './commands';
import { createCombat, step, MAX_SKILL_SLOTS } from './reducer';
import type { CombatState } from './state';

// P7 계약 테스트 — 쿨다운 행동 모델(D1)·8슬롯(D2)·양면 코인(D4)·과열(D5)·드로우(D3).
// 결정 로그: PRD/P7_NEW_DESIGN_DECISIONS.md

const id = <T extends string>(value: string): T => value as T;
const slot = (value: number): SlotId => value as SlotId;

const testDb = (): ContentDb => {
  const db: Omit<ContentDb, 'validate'> = {
    coins: {
      basic: { id: id<CoinDefId>('basic'), element: null },
      fire: {
        id: id<CoinDefId>('fire'),
        element: 'fire',
        procs: {
          heads: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }],
          tails: [{ kind: 'damage', amount: 1 }]
        }
      },
      blood: {
        id: id<CoinDefId>('blood'),
        element: 'blood',
        procs: {
          heads: [{ kind: 'heal', amount: 1 }],
          tails: [{ kind: 'block', amount: 1 }]
        }
      }
    },
    skills: {
      basicStrike: {
        id: id<SkillId>('basicStrike'),
        name: '기본 타격',
        rarity: 'common',
        tags: ['attack'],
        targetType: 'single-enemy',
        cooldown: 0,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'damage', amount: 4 }]
      },
      onceAtBat: {
        id: id<SkillId>('onceAtBat'),
        name: '일회성',
        rarity: 'rare',
        tags: ['attack'],
        targetType: 'single-enemy',
        oncePerCombat: true,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'damage', amount: 2 }]
      },
      slowBlow: {
        id: id<SkillId>('slowBlow'),
        name: '느린 강타',
        rarity: 'advanced',
        tags: ['attack'],
        targetType: 'single-enemy',
        cooldown: 3,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'damage', amount: 9 }]
      },
      guardSelf: {
        id: id<SkillId>('guardSelf'),
        name: '자기 방어',
        rarity: 'common',
        tags: ['defense'],
        targetType: 'self',
        type: 'flip',
        cost: 1,
        base: [{ kind: 'block', amount: 3 }]
      },
      igniteSpirit: {
        id: id<SkillId>('igniteSpirit'),
        name: '점화 정신',
        rarity: 'common',
        tags: ['utility'],
        targetType: 'none',
        cooldown: 3,
        type: 'consume',
        consume: { element: 'fire', count: 1 },
        effects: [{ kind: 'enterOverheat' }, { kind: 'draw', count: 1 }]
      },
      overheatPunch: {
        id: id<SkillId>('overheatPunch'),
        name: '과열 타격',
        rarity: 'advanced',
        tags: ['attack'],
        targetType: 'single-enemy',
        cooldown: 1,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'damage', amount: 5 }],
        overheatBonus: [{ kind: 'damage', amount: 4 }]
      },
      sweepKick: {
        id: id<SkillId>('sweepKick'),
        name: '전체 타격',
        rarity: 'common',
        tags: ['attack'],
        targetType: 'all-enemies',
        cooldown: 0,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'damage', amount: 2 }]
      },
      bigDraw: {
        id: id<SkillId>('bigDraw'),
        name: '대량 드로우',
        rarity: 'advanced',
        tags: ['utility'],
        targetType: 'self',
        cooldown: 1,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'draw', count: 9 }]
      },
      refresher: {
        id: id<SkillId>('refresher'),
        name: '재정비 시험',
        rarity: 'advanced',
        tags: ['utility'],
        targetType: 'self',
        cooldown: 2,
        type: 'flip',
        cost: 1,
        base: [{ kind: 'reduceCooldown', amount: 2 }]
      }
    },
    enemies: {
      dummy: {
        id: id<EnemyDefId>('dummy'),
        name: '허수아비',
        maxHp: 200,
        intents: [{ id: 'poke', actions: [{ kind: 'attack', damage: 1 }] }]
      }
    },
    characters: {
      tester: {
        id: id<CharacterId>('tester'),
        name: '시험체',
        maxHp: 50,
        startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
        startingSkills: [id<SkillId>('basicStrike'), id<SkillId>('guardSelf')],
        trait: { id: 'none', name: '없음', hook: 'combatStart', effects: [] }
      }
    }
  };
  return { ...db, validate: () => [] };
};

const start = (
  skills: (SkillId | null)[],
  bag?: CoinDefId[],
  db: ContentDb = testDb()
): CombatState =>
  createCombat(
    {
      character: id<CharacterId>('tester'),
      enemies: [id<EnemyDefId>('dummy')],
      equippedSkills: skills,
      bag
    },
    db,
    'p7-contract-seed'
  );

let lastEvents: readonly unknown[] = [];

const useLoaded = (
  state: CombatState,
  db: ContentDb,
  slotIndex: number,
  target?: number
): CombatState => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('no coin in hand');
  const placed = step(state, { type: 'placeCoin', coin, slot: slot(slotIndex) }, db);
  if (!placed.ok) throw new Error(placed.error);
  const used = step(placed.state, { type: 'useFlipSkill', slot: slot(slotIndex), target }, db);
  if (!used.ok) throw new Error(used.error);
  lastEvents = used.events;
  return used.state;
};

const lastEventTypes = (): string[] => lastEvents.map((event) => (event as { type: string }).type);

describe('P7 D1 — 쿨다운 행동 모델', () => {
  it('쿨다운 0(반복) 스킬은 같은 턴에 코인이 남는 한 4회 이상 사용 가능하다', () => {
    const db = testDb();
    let state = start([id<SkillId>('basicStrike')], undefined, db);
    const suppliedCoin = state.zones.draw[0]!;
    state = {
      ...state,
      zones: {
        ...state.zones,
        hand: [...state.zones.hand, suppliedCoin],
        draw: state.zones.draw.slice(1)
      }
    };
    for (let i = 0; i < 4; i += 1) {
      state = useLoaded(state, db, 0, 0);
      expect(state.slots[0]!.cooldownRemaining).toBe(0);
    }
    // 4회 = 구 3회 캡 초과 — 캡 카운터가 존재하지 않음을 증명
    expect(state.enemies[0]!.hp).toBe(200 - 16);
  });

  it('미지정 쿨다운(기본 1)은 같은 턴 재사용을 거부하고 다음 턴 가용이다', () => {
    const db = testDb();
    let state = start([id<SkillId>('guardSelf')], undefined, db);
    state = useLoaded(state, db, 0);
    expect(state.slots[0]!.cooldownRemaining).toBe(1);
    const coin = state.zones.hand[0]!;
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(0) }, db);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const again = step(placed.state, { type: 'useFlipSkill', slot: slot(0) }, db);
    expect(again).toEqual({ ok: false, error: 'skill is cooling down' });
    const ended = step(placed.state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.slots[0]!.cooldownRemaining).toBe(0);
  });

  it('쿨다운 3은 두 플레이어 턴 봉인 후 세 번째 턴에 가용하다', () => {
    const db = testDb();
    let state = start([id<SkillId>('slowBlow')], undefined, db);
    state = useLoaded(state, db, 0, 0);
    expect(state.slots[0]!.cooldownRemaining).toBe(3);
    for (const expected of [2, 1, 0]) {
      const ended = step(state, { type: 'endTurn' }, db);
      expect(ended.ok).toBe(true);
      if (!ended.ok) return;
      state = ended.state;
      expect(state.slots[0]!.cooldownRemaining).toBe(expected);
    }
  });

  it('legalCommands는 쿨다운 중·빈 슬롯을 제안하지 않고 카운터 캡도 없다', () => {
    const db = testDb();
    let state = start([id<SkillId>('basicStrike'), id<SkillId>('guardSelf')], undefined, db);
    state = useLoaded(state, db, 1);
    const commands = legalCommands(state, db);
    expect(commands.some((cmd) => cmd.type === 'placeCoin' && cmd.slot === slot(1))).toBe(false);
    expect(commands.some((cmd) => cmd.type === 'placeCoin' && cmd.slot === slot(0))).toBe(true);
    // 빈 슬롯(2~7)은 어떤 커맨드도 제안되지 않는다
    for (let empty = 2; empty < MAX_SKILL_SLOTS; empty += 1) {
      expect(commands.some((cmd) => 'slot' in cmd && cmd.slot === slot(empty))).toBe(false);
    }
  });

  it('reduceCooldown은 자기 슬롯을 제외하고 대기 중 슬롯만 줄인다', () => {
    const db = testDb();
    let state = start([id<SkillId>('slowBlow'), id<SkillId>('refresher')], undefined, db);
    state = useLoaded(state, db, 0, 0);
    expect(state.slots[0]!.cooldownRemaining).toBe(3);
    state = useLoaded(state, db, 1);
    // slowBlow 3-2=1, refresher 자신은 사용 직후 2 유지 (자기 제외)
    expect(state.slots[0]!.cooldownRemaining).toBe(1);
    expect(state.slots[1]!.cooldownRemaining).toBe(2);
    expect(lastEventTypes()).toContain('cooldownReduced');
  });

  it('전투당 1회는 쿨다운과 무관하게 잠기고 새 전투에서 리셋된다', () => {
    const db = testDb();
    let state = start([id<SkillId>('onceAtBat')], undefined, db);
    state = useLoaded(state, db, 0, 0);
    expect(state.slots[0]!.usedThisCombat).toBe(true);
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.slots[0]!.usedThisCombat).toBe(true);
    const fresh = start([id<SkillId>('onceAtBat')], undefined, db);
    expect(fresh.slots[0]!.usedThisCombat).toBe(false);
  });
});

describe('P7 D2 — 8슬롯·빈 슬롯', () => {
  it('시작 4스킬이면 슬롯 4~7이 null로 패딩된다', () => {
    const db = testDb();
    const state = start(
      [id<SkillId>('basicStrike'), id<SkillId>('guardSelf'), id<SkillId>('slowBlow'), id<SkillId>('onceAtBat')],
      undefined,
      db
    );
    expect(state.slots).toHaveLength(MAX_SKILL_SLOTS);
    expect(state.slots.slice(4).every((candidate) => candidate.skillId === null)).toBe(true);
  });

  it('빈 슬롯 장전은 거부된다', () => {
    const db = testDb();
    const state = start([id<SkillId>('basicStrike')], undefined, db);
    const coin = state.zones.hand[0]!;
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(5) }, db);
    expect(placed).toEqual({ ok: false, error: 'slot is empty' });
  });

  it('9개 이상 스킬은 거부된다', () => {
    const db = testDb();
    expect(() =>
      start(Array.from({ length: 9 }, () => id<SkillId>('basicStrike')), undefined, db)
    ).toThrow(/between 1 and 8/);
  });
});

describe('P7 D4 — 양면 코인·회복', () => {
  it('혈액 코인 앞면 회복은 maxHp 상한, 뒷면은 방어로 플레이어에 귀속된다', () => {
    const db = testDb();
    const bag = Array.from({ length: 10 }, () => id<CoinDefId>('blood'));
    let state = start([id<SkillId>('guardSelf')], bag, db);
    state = { ...state, player: { ...state.player, hp: 49 } };
    const coin = state.zones.hand[0]!;
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(0) }, db);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const used = step(placed.state, { type: 'useFlipSkill', slot: slot(0) }, db);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const healEvents = used.events.filter((event) => event.type === 'healed');
    const blockEvents = used.events.filter(
      (event) => event.type === 'blockGained' && event.target.type === 'player'
    );
    // 앞이든 뒤든 정확히 한쪽 효과가 플레이어에게 발동
    expect(healEvents.length + blockEvents.length).toBeGreaterThanOrEqual(1);
    expect(used.state.player.hp).toBeLessThanOrEqual(50);
  });

  it('자기 대상 스킬의 화염 뒷면 피해는 살아있는 적에게 간다', () => {
    const db = testDb();
    const bag = Array.from({ length: 10 }, () => id<CoinDefId>('fire'));
    let state = start([id<SkillId>('guardSelf')], bag, db);
    // 뒷면이 나올 때까지 최대 6회 시도 (플립 rng 결정론 — 시드 고정이라 한 궤적)
    let sawTailsDamage = false;
    for (let i = 0; i < 6 && !sawTailsDamage; i += 1) {
      const coin = state.zones.hand[0];
      if (coin === undefined) break;
      const placed = step(state, { type: 'placeCoin', coin, slot: slot(0) }, db);
      if (!placed.ok) break;
      const used = step(placed.state, { type: 'useFlipSkill', slot: slot(0), target: 0 }, db);
      if (!used.ok) break;
      sawTailsDamage = used.events.some(
        (event) =>
          event.type === 'damageDealt' && event.target.type === 'enemy' && event.source === 'skill'
      );
      const ended = step(used.state, { type: 'endTurn' }, db);
      if (!ended.ok) break;
      state = ended.state;
    }
    expect(sawTailsDamage).toBe(true);
  });

  it('소비 스킬은 어떤 면 proc도 발동하지 않는다', () => {
    const db = testDb();
    const bag = Array.from({ length: 10 }, () => id<CoinDefId>('fire'));
    const state = start([id<SkillId>('igniteSpirit')], bag, db);
    const fuel = state.zones.hand[0]!;
    const used = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [fuel as CoinUid] }, db);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(used.events.some((event) => event.type === 'coinFlipped')).toBe(false);
    expect(used.events.some((event) => event.type === 'statusApplied')).toBe(false);
  });
});

describe('P7 D5 — 과열', () => {
  const withOverheat = (db: ContentDb): CombatState => {
    const bag = [id<CoinDefId>('fire'), ...Array.from({ length: 9 }, () => id<CoinDefId>('basic'))];
    let state = start([id<SkillId>('igniteSpirit'), id<SkillId>('overheatPunch')], bag, db);
    // 화염 코인이 손에 올 때까지 턴을 넘긴다
    for (let i = 0; i < 5; i += 1) {
      const fuel = state.zones.hand.find((coin) => state.coins[Number(coin)]?.defId === id<CoinDefId>('fire'));
      if (fuel !== undefined) {
        const used = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [fuel] }, db);
        if (!used.ok) throw new Error(used.error);
        lastEvents = used.events;
        return used.state;
      }
      const ended = step(state, { type: 'endTurn' }, db);
      if (!ended.ok) throw new Error(ended.error);
      state = ended.state;
    }
    throw new Error('no fire coin drawn');
  };

  it('화염 소비로 진입하고 턴을 넘겨도 유지된다', () => {
    const db = testDb();
    const state = withOverheat(db);
    expect(state.player.overheat).toBe(true);
    expect(lastEventTypes()).toContain('overheatEntered');
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.player.overheat).toBe(true);
  });

  it('과열 강화 스킬 성공 해결이 보너스를 적용하고 과열을 소비한다', () => {
    const db = testDb();
    let state = withOverheat(db);
    const before = state.enemies[0]!.hp;
    state = useLoaded(state, db, 1, 0);
    expect(before - state.enemies[0]!.hp).toBe(9); // 5 + 과열 4
    expect(state.player.overheat).toBe(false);
    expect(lastEventTypes()).toContain('overheatConsumed');
    // 두 번째 사용(다음 턴)은 보너스 없음
    const ended = step(state, { type: 'endTurn' }, db);
    if (!ended.ok) throw new Error(ended.error);
    const mid = ended.state.enemies[0]!.hp;
    const again = useLoaded(ended.state, db, 1, 0);
    expect(mid - again.enemies[0]!.hp).toBe(5);
  });

  it('불법 사용(쿨다운)은 과열을 소비하지 않는다', () => {
    const db = testDb();
    let state = withOverheat(db);
    state = useLoaded(state, db, 1, 0); // 소비됨
    state = withOverheatAgain(state);
    // 쿨다운 중 재사용 시도 → 오류 → 과열 유지
    const coin = state.zones.hand[0]!;
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(1) }, db);
    if (placed.ok) {
      const used = step(placed.state, { type: 'useFlipSkill', slot: slot(1), target: 0 }, db);
      expect(used.ok).toBe(false);
      expect(placed.state.player.overheat).toBe(true);
    }
  });

  it('중복 진입은 무스택 no-op이다', () => {
    const db = testDb();
    const bag = Array.from({ length: 10 }, () => id<CoinDefId>('fire'));
    let state = start([id<SkillId>('igniteSpirit')], bag, db);
    const first = state.zones.hand[0]!;
    const entered = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [first] }, db);
    if (!entered.ok) throw new Error(entered.error);
    expect(entered.events.filter((event) => event.type === 'overheatEntered')).toHaveLength(1);

    // 재진입 원자 자체를 검증하기 위해 테스트에서만 쿨다운을 해제한다.
    state = {
      ...entered.state,
      slots: entered.state.slots.map((candidate, index) =>
        index === 0 ? { ...candidate, cooldownRemaining: 0 } : candidate
      )
    };
    const second = state.zones.hand.find((coin) => state.coins[Number(coin)]?.defId === id<CoinDefId>('fire'))!;
    const reentered = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [second] }, db);
    if (!reentered.ok) throw new Error(reentered.error);
    expect(reentered.state.player.overheat).toBe(true);
    expect(reentered.events.some((event) => event.type === 'overheatEntered')).toBe(false);
  });
});

// 과열 재진입 헬퍼 — overheatPunch 사용 직후(쿨다운 1) 상태에서 igniteSpirit이 쿨다운이면
// 수동으로 과열만 세팅해 '불법 사용 비소비' 검증에 집중한다 (진입 경로는 위에서 검증됨).
const withOverheatAgain = (state: CombatState): CombatState => ({
  ...state,
  player: { ...state.player, overheat: true }
});

describe('P7 감사 보정 회귀 (D9)', () => {
  it('reduceCooldown은 전투당 1회 슬롯을 건드리지 않는다', () => {
    const db = testDb();
    let state = start([id<SkillId>('onceAtBat'), id<SkillId>('refresher')], undefined, db);
    state = useLoaded(state, db, 0, 0); // onceAtBat: usedThisCombat만으로 잠금
    expect(state.slots[0]!.cooldownRemaining).toBe(0);
    state = useLoaded(state, db, 1); // refresher: reduceCooldown 2
    expect(state.slots[0]!.cooldownRemaining).toBe(0); // 쿨다운 상태 자체가 없음
    expect(state.slots[0]!.usedThisCombat).toBe(true);
  });

  it('드로우는 손 상한 10을 넘지 않는다', () => {
    const db = testDb();
    const bag = Array.from({ length: 20 }, () => id<CoinDefId>('basic'));
    const state = start([id<SkillId>('bigDraw')], bag, db);
    expect(state.zones.hand.length).toBe(3);
    const coin = state.zones.hand[0]!;
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(0) }, db);
    if (!placed.ok) throw new Error(placed.error);
    const used = step(placed.state, { type: 'useFlipSkill', slot: slot(0) }, db);
    if (!used.ok) throw new Error(used.error);
    // 장전 1 소모 후 2 + draw 9 → 상한 10에서 정지 (11 아님)
    expect(used.state.zones.hand.length).toBe(10);
  });

  it('피해 전용 과열 보너스는 기본 피해와 단일 타격으로 합산된다', () => {
    const db = testDb();
    let state = start([id<SkillId>('igniteSpirit'), id<SkillId>('overheatPunch')], [id<CoinDefId>('fire'), ...Array.from({ length: 9 }, () => id<CoinDefId>('basic'))], db);
    for (let i = 0; i < 5; i += 1) {
      const fuel = state.zones.hand.find((coin) => state.coins[Number(coin)]?.defId === id<CoinDefId>('fire'));
      if (fuel !== undefined) {
        const usedFuel = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [fuel] }, db);
        if (!usedFuel.ok) throw new Error(usedFuel.error);
        state = usedFuel.state;
        break;
      }
      const ended = step(state, { type: 'endTurn' }, db);
      if (!ended.ok) throw new Error(ended.error);
      state = ended.state;
    }
    expect(state.player.overheat).toBe(true);
    const coin = state.zones.hand.find((candidate) => state.coins[Number(candidate)]?.defId === id<CoinDefId>('basic'))!;
    const placed = step(state, { type: 'placeCoin', coin, slot: slot(1) }, db);
    if (!placed.ok) throw new Error(placed.error);
    const used = step(placed.state, { type: 'useFlipSkill', slot: slot(1), target: 0 }, db);
    if (!used.ok) throw new Error(used.error);
    const skillHits = used.events.filter(
      (event) => event.type === 'damageDealt' && event.source === 'skill' && event.target.type === 'enemy'
    );
    expect(skillHits).toHaveLength(1); // 5+4가 두 타격으로 갈라지지 않는다
    expect((skillHits[0] as { amount: number }).amount).toBe(9);
  });

  it('전체 대상 스킬의 공격형 코인 proc은 모든 생존 적에게 간다', () => {
    const db = testDb();
    const bag = Array.from({ length: 10 }, () => id<CoinDefId>('fire'));
    let state = createCombat(
      {
        character: id<CharacterId>('tester'),
        enemies: [id<EnemyDefId>('dummy'), id<EnemyDefId>('dummy')],
        equippedSkills: [id<SkillId>('sweepKick')],
        bag
      },
      db,
      'p7-aoe-seed'
    );
    // 뒷면(피해 1 proc)이 관측될 때까지 반복 사용 — 반복 스킬이라 같은 턴 다회 가능
    let sawBothHit = false;
    for (let i = 0; i < 8 && !sawBothHit; i += 1) {
      const coin = state.zones.hand[0];
      if (coin === undefined) break;
      const placed = step(state, { type: 'placeCoin', coin, slot: slot(0) }, db);
      if (!placed.ok) break;
      const before = placed.state.enemies.map((enemy) => enemy.hp);
      const used = step(placed.state, { type: 'useFlipSkill', slot: slot(0) }, db);
      if (!used.ok) break;
      // 스킬 본체 피해도 proc과 동일하게 모든 생존 적에게 적용되어야 한다.
      expect(used.state.enemies[0]!.hp).toBeLessThan(before[0]!);
      expect(used.state.enemies[1]!.hp).toBeLessThan(before[1]!);
      const tails = used.events.some((event) => event.type === 'coinFlipped' && event.face === 'tails');
      if (tails) {
        const procHits = used.events.filter(
          (event) => event.type === 'damageDealt' && event.source === 'skill' && event.amount + ('blocked' in event ? event.blocked : 0) === 1
        );
        const hitIndexes = new Set(
          procHits.flatMap((event) =>
            event.type === 'damageDealt' && event.target.type === 'enemy' ? [event.target.index] : []
          )
        );
        sawBothHit = hitIndexes.has(0) && hitIndexes.has(1);
      }
      state = used.state;
      if (state.zones.hand.length === 0) {
        const ended = step(state, { type: 'endTurn' }, db);
        if (!ended.ok) break;
        state = ended.state;
      }
    }
    expect(sawBothHit).toBe(true);
  });

  it('자기 대상 스킬의 공격형 proc은 명시 target을 우선한다', () => {
    const db = testDb();
    const bag = Array.from({ length: 10 }, () => id<CoinDefId>('fire'));
    let state = createCombat(
      {
        character: id<CharacterId>('tester'),
        enemies: [id<EnemyDefId>('dummy'), id<EnemyDefId>('dummy')],
        equippedSkills: [id<SkillId>('guardSelf')],
        bag
      },
      db,
      'p7-explicit-target-seed'
    );
    const firstCoin = state.zones.hand[0]!;
    const firstPlaced = step(state, { type: 'placeCoin', coin: firstCoin, slot: slot(0) }, db);
    if (!firstPlaced.ok) throw new Error(firstPlaced.error);
    expect(
      legalCommands(firstPlaced.state, db)
        .filter((command) => command.type === 'useFlipSkill' && command.slot === slot(0))
        .map((command) => command.type === 'useFlipSkill' ? command.target : undefined)
    ).toEqual([0, 1]);
    const missingTarget = step(firstPlaced.state, { type: 'useFlipSkill', slot: slot(0) }, db);
    expect(missingTarget).toEqual({ ok: false, error: 'target enemy is not alive' });
    const restored = step(firstPlaced.state, { type: 'unplaceCoin', coin: firstCoin }, db);
    if (!restored.ok) throw new Error(restored.error);
    state = restored.state;
    let sawExplicitHit = false;
    for (let i = 0; i < 6 && !sawExplicitHit; i += 1) {
      const coin = state.zones.hand[0];
      if (coin === undefined) break;
      const placed = step(state, { type: 'placeCoin', coin, slot: slot(0) }, db);
      if (!placed.ok) break;
      const used = step(placed.state, { type: 'useFlipSkill', slot: slot(0), target: 1 }, db);
      if (!used.ok) break;
      sawExplicitHit = used.events.some(
        (event) => event.type === 'damageDealt' && event.source === 'skill' && event.target.type === 'enemy' && event.target.index === 1
      );
      const ended = step(used.state, { type: 'endTurn' }, db);
      if (!ended.ok) break;
      state = ended.state;
    }
    expect(sawExplicitHit).toBe(true);
  });
});

describe('P7 D3 — 드로우', () => {
  it('draw 원자는 즉시 뽑고, 소진 시 부분 드로우한다', () => {
    const db = testDb();
    const bag = Array.from({ length: 6 }, () => id<CoinDefId>('fire'));
    const state = start([id<SkillId>('igniteSpirit')], bag, db);
    const fuel = state.zones.hand[0]!;
    const before = state.zones.hand.length;
    const used = step(state, { type: 'useConsumeSkill', slot: slot(0), coins: [fuel] }, db);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    // 연료 1 소모 + draw 1 = 손 크기 유지 (뽑을 코인이 남아 있는 한)
    expect(used.state.zones.hand.length).toBe(before);
  });
});
