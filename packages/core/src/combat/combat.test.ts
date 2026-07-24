import { describe, expect, it } from 'vitest';

import type { Rng, RngSnapshot } from '../rng';
import type { CoinDefId, CoinUid, SkillId, SlotId } from '../ids';
import type { ContentDb, FlipSkillDef } from '../content-types';
import { createCombat, step, zoneCoinCount } from './reducer';
import { legalCommands } from './commands';
import type { Command } from './commands';
import { statusStacks } from './state';
import type { CombatState } from './state';

const id = <T extends string>(value: string) => value as T;
const slot = (value: number) => value as SlotId;

const scriptedFlips = (faces: readonly ('heads' | 'tails')[]): Rng => {
  let index = 0;
  return {
    float: () => 0,
    int: () => 0,
    flip: () => {
      const face = faces[index];
      if (face === undefined) {
        throw new Error('scripted flip exhausted');
      }
      index += 1;
      return face;
    },
    shuffle: <T>(xs: readonly T[]) => [...xs],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>('basic'), element: null },
    fire: {
      id: id<CoinDefId>('fire'),
      element: 'fire',
      // P7 D4 — 양면 속성 코인: 앞 화상 1 / 뒤 피해 1 (v1.3 표)
      procs: {
        heads: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }],
        tails: [{ kind: 'damage', amount: 1 }]
      }
    }
  },
  skills: {
    slash: {
      id: id<SkillId>('slash'),
      name: '공격',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'damage', amount: 6 }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
    },
    guard: {
      id: id<SkillId>('guard'),
      name: '방어',
      type: 'flip',
      rarity: 'common',
      tags: ['defense'],
      targetType: 'self',
      cost: 1,
      base: [{ kind: 'block', amount: 5 }],
      tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
    },
    'burning-strike': {
      id: id<SkillId>('burning-strike'),
      name: '불타는 일격',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 2,
      base: [
        { kind: 'damage', amount: 8 },
        { kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'discard', count: 1 }
      ],
      heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] }
    },
    ignite: {
      id: id<SkillId>('ignite'),
      name: '점화',
      type: 'flip',
      rarity: 'common',
      tags: ['attack'],
      targetType: 'single-enemy',
      cost: 1,
      base: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }],
      heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] },
      tails: { mode: 'any', effects: [{ kind: 'damage', amount: 3 }] }
    },
    'ignite-sword': {
      id: id<SkillId>('ignite-sword'),
      name: '점화 검술',
      type: 'consume',
      rarity: 'advanced',
      tags: ['attack'],
      targetType: 'single-enemy',
      consume: { element: 'fire', count: 1 },
      effects: [
        { kind: 'damage', amount: 10 },
        { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
      ]
    },
    'flame-rampage': {
      id: id<SkillId>('flame-rampage'),
      name: '화염 폭주',
      type: 'flip',
      rarity: 'rare',
      tags: ['utility'],
      targetType: 'self',
      oncePerCombat: true,
      cost: 1,
      base: [{ kind: 'grantElement', element: 'fire', scope: 'allBasicInHand' }],
      heads: { mode: 'any', effects: [{ kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'hand', count: 1 }] },
      tails: { mode: 'any', effects: [{ kind: 'selfDamage', amount: 2 }] }
    }
  },
  enemies: {
    raider: {
      id: id('raider'),
      name: '약탈자',
      maxHp: 75,
      intents: [
        { id: 'slam', actions: [{ kind: 'attack', damage: 11 }] },
        { id: 'double', actions: [{ kind: 'attack', damage: 4 }, { kind: 'attack', damage: 4 }] }
      ]
    }
  },
  characters: {
    warrior: {
      id: id('warrior'),
      name: '전사',
      maxHp: 70,
      startingBag: Array.from({ length: 10 }, () => id<CoinDefId>('basic')),
      startingSkills: [
        id<SkillId>('slash'),
        id<SkillId>('guard'),
        id<SkillId>('burning-strike'),
        id<SkillId>('ignite'),
        id<SkillId>('ignite-sword'),
        id<SkillId>('flame-rampage')
      ],
      trait: {
        id: 'ember-pouch',
        name: '불씨 주머니',
        hook: 'combatStart',
        effects: []
      }
    }
  },
  validate: () => []
});

const replaceFlipRng = (state: CombatState, faces: readonly ('heads' | 'tails')[]): CombatState => ({
  ...state,
  rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
});

const firstHandCoin = (state: CombatState): CoinUid => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error('missing hand coin');
  return coin;
};

const useFirstCoin = (state: CombatState, slotIndex: number, target = 0, db = testDb()) => {
  const used = step(state, { type: 'useImmediateFlipSkill', slot: slot(slotIndex), coins: [firstHandCoin(state)], target }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

const useHandCoins = (state: CombatState, slotIndex: number, coins: readonly CoinUid[], target = 0, db = testDb()) => {
  const used = step(state, { type: 'useImmediateFlipSkill', slot: slot(slotIndex), coins: [...coins], target }, db);
  if (!used.ok) throw new Error(used.error);
  return used;
};

const withHandDefs = (state: CombatState, defs: readonly string[]): CombatState => {
  const updates = Object.fromEntries(
    defs.map((defId, index) => {
      const coin = state.zones.hand[index];
      if (coin === undefined) throw new Error('missing hand coin');
      return [Number(coin), { ...state.coins[Number(coin)]!, defId: id<CoinDefId>(defId) }];
    })
  );
  return { ...state, coins: { ...state.coins, ...updates } };
};

describe('combat golden traces', () => {
  it('slash deals 10 on heads and 6 on tails', () => {
    const db = testDb();
    const headsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'heads'
    ]);
    expect(useFirstCoin(headsState, 0).state.enemies[0]?.hp).toBe(65);

    const tailsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'tails'
    ]);
    expect(useFirstCoin(tailsState, 0).state.enemies[0]?.hp).toBe(69);
  });

  it('slash with a fire coin applies burn on heads and 1 proc damage on tails', () => {
    const db = testDb();
    const headsState = withHandDefs(
      replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'slash-fire'), ['heads']),
      ['fire']
    );
    const heads = useFirstCoin(headsState, 0);
    expect(heads.state.enemies[0]?.hp).toBe(65);
    expect(statusStacks(heads.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(1);

    // P7 D4: 화염 뒷면 proc = 피해 1 — slash 6 + proc 1 = 7
    const tailsState = withHandDefs(
      replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'slash-fire'), ['tails']),
      ['fire']
    );
    const tails = useFirstCoin(tailsState, 0);
    expect(tails.state.enemies[0]?.hp).toBe(68);
    expect(statusStacks(tails.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(0);
  });

  it('guard gains 5 on heads and 8 on tails', () => {
    const db = testDb();
    const headsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'heads'
    ]);
    expect(useFirstCoin(headsState, 1).state.player.block).toBe(5);

    const tailsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'golden'), [
      'tails'
    ]);
    expect(useFirstCoin(tailsState, 1).state.player.block).toBe(8);
  });

  it('burning strike deals per-head damage and creates a temporary fire coin in discard', () => {
    const db = testDb();
    const cases: Array<[readonly ('heads' | 'tails')[], number]> = [
      [['heads', 'heads'], 61],
      [['heads', 'tails'], 64],
      [['tails', 'tails'], 67]
    ];

    for (const [faces, hp] of cases) {
      const state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, `burning-${faces.join('')}`), faces);
      const result = useHandCoins(state, 2, state.zones.hand.slice(0, 2));
      expect(result.state.enemies[0]?.hp).toBe(hp);
      const created = result.events.find((event) => event.type === 'coinCreated');
      expect(created).toMatchObject({ type: 'coinCreated', defId: 'fire', zone: 'discard' });
      if (created?.type === 'coinCreated') {
        expect(result.state.coins[Number(created.coin)]?.permanent).toBe(false);
        expect(result.state.zones.discard).toContain(created.coin);
      }
    }
  });

  it('burning strike with two fire coins applies burn per coin', () => {
    const db = testDb();
    const state = withHandDefs(
      replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'burning-fire'), [
        'heads',
        'heads'
      ]),
      ['fire', 'fire']
    );
    const result = useHandCoins(state, 2, state.zones.hand.slice(0, 2));
    expect(result.state.enemies[0]?.hp).toBe(61);
    expect(statusStacks(result.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(2);
  });

  it('ignite applies base burn, face effects, and fire coin proc', () => {
    const db = testDb();
    const headsState = withHandDefs(
      replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'ignite'), ['heads']),
      ['fire']
    );
    const heads = useFirstCoin(headsState, 3);
    expect(statusStacks(heads.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(3);

    const tailsState = withHandDefs(
      replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'ignite'), ['tails']),
      ['fire']
    );
    const tails = useFirstCoin(tailsState, 3);
    expect(statusStacks(tails.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(1);
    // 뒷면 효과 3 + 화염 뒷면 proc 1 (P7 D4) = 4
    expect(tails.state.enemies[0]?.hp).toBe(71);
  });
});

describe('M4 consume skills, grants, and once per combat', () => {
  it('ignite sword consumes one fire coin for fixed damage and burn without flips or procs', () => {
    const db = testDb();
    const state = withHandDefs(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'ignite-sword'), [
      'fire'
    ]);
    const fuel = firstHandCoin(state);
    const result = step(state, { type: 'useConsumeSkill', slot: slot(4), coins: [fuel], target: 0 }, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.enemies[0]?.hp).toBe(65);
    expect(statusStacks(result.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(2);
    expect(result.state.zones.exhausted).toContain(fuel);
    expect(result.state.zones.hand).not.toContain(fuel);
    expect(result.events).toContainEqual({ type: 'coinsConsumed', coins: [fuel] });
    expect(result.events.filter((event) => event.type === 'coinFlipped')).toHaveLength(0);
  });

  it('flame rampage granted basic coins count as ignite sword fuel and are consumed to exhausted', () => {
    const db = testDb();
    let state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'rampage-combo'), [
      'tails'
    ]);
    const cost = firstHandCoin(state);
    const rampage = step(state, { type: 'useImmediateFlipSkill', slot: slot(5), coins: [cost] }, db);
    expect(rampage.ok).toBe(true);
    if (!rampage.ok) return;
    state = rampage.state;

    const consume = legalCommands(state, db).find((command) => command.type === 'useConsumeSkill' && command.slot === slot(4));
    expect(consume).toBeDefined();
    if (consume?.type !== 'useConsumeSkill') return;
    expect(state.coins[Number(consume.coins[0])]?.grants).toContain('fire');

    const result = step(state, consume, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.zones.exhausted).toContain(consume.coins[0]);
    expect(result.state.enemies[0]?.hp).toBe(65);
  });

  it('clears grants from every zone at turn end, including exhausted', () => {
    const db = testDb();
    const state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'grant-expire'), [
      'tails'
    ]);
    const rampage = step(state, { type: 'useImmediateFlipSkill', slot: slot(5), coins: [firstHandCoin(state)] }, db);
    expect(rampage.ok).toBe(true);
    if (!rampage.ok) return;
    const consume = legalCommands(rampage.state, db).find((command) => command.type === 'useConsumeSkill' && command.slot === slot(4));
    expect(consume?.type).toBe('useConsumeSkill');
    if (consume?.type !== 'useConsumeSkill') return;
    const consumed = step(rampage.state, consume, db);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(Object.values(consumed.state.coins).some((coin) => coin.grants.length > 0)).toBe(true);

    const ended = step(consumed.state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(Object.values(ended.state.coins).every((coin) => coin.grants.length === 0)).toBe(true);
    expect(ended.state.zones.exhausted).toContain(consume.coins[0]);
  });

  it('flame rampage tags only the hand snapshot, excludes its placed cost, and resolves both faces', () => {
    const db = testDb();
    const headsState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'rampage-heads'), [
      'heads'
    ]);
    const cost = firstHandCoin(headsState);
    const snapshot = headsState.zones.hand.slice(1);
    const heads = step(headsState, { type: 'useImmediateFlipSkill', slot: slot(5), coins: [cost] }, db);
    expect(heads.ok).toBe(true);
    if (!heads.ok) return;
    expect(heads.state.coins[Number(cost)]?.grants).toEqual([]);
    for (const coin of snapshot) expect(heads.state.coins[Number(coin)]?.grants).toContain('fire');
    const created = heads.events.find((event) => event.type === 'coinCreated');
    expect(created).toMatchObject({ type: 'coinCreated', defId: 'fire', zone: 'hand' });
    if (created?.type === 'coinCreated') expect(heads.state.coins[Number(created.coin)]?.grants).toEqual([]);

    const tailsState = {
      ...replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'rampage-tails'), ['tails']),
      player: { ...headsState.player, block: 1 }
    };
    const tails = step(tailsState, { type: 'useImmediateFlipSkill', slot: slot(5), coins: [firstHandCoin(tailsState)] }, db);
    expect(tails.ok).toBe(true);
    if (!tails.ok) return;
    expect(tails.state.player.hp).toBe(69);
    expect(tails.state.player.block).toBe(0);
    expect(tails.events).toContainEqual({ type: 'damageDealt', target: { type: 'player' }, amount: 1, blocked: 1, source: 'self' });
  });

  it('rejects flame rampage after it was used once, even on later turns', () => {
    const db = testDb();
    let state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'once'), ['tails']);
    const first = step(state, { type: 'useImmediateFlipSkill', slot: slot(5), coins: [firstHandCoin(state)] }, db);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    expect(step(state, { type: 'useImmediateFlipSkill', slot: slot(5), coins: [firstHandCoin(state)] }, db).ok).toBe(false);

    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.slots[5]?.usedThisCombat).toBe(true);
    expect(legalCommands(ended.state, db).some((command) => command.type === 'useImmediateFlipSkill' && command.slot === slot(5))).toBe(false);
  });

  it('keeps exhausted coins isolated from reshuffle and draw', () => {
    const db = testDb();
    const state = withHandDefs(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'exhausted'), [
      'fire'
    ]);
    const fuel = firstHandCoin(state);
    const consumed = step(state, { type: 'useConsumeSkill', slot: slot(4), coins: [fuel], target: 0 }, db);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    const rigged = {
      ...consumed.state,
      zones: {
        ...consumed.state.zones,
        draw: [],
        hand: [],
        discard: consumed.state.zones.hand,
        exhausted: consumed.state.zones.exhausted
      }
    };
    const ended = step(rigged, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.zones.exhausted).toContain(fuel);
    expect(ended.state.zones.hand).not.toContain(fuel);
  });

  // P7 D1: 턴당 3회 캡 폐지 — 소비 포함 4번째 스킬 사용도 합법이다
  it('allows a fourth skill use in the same turn, consume included (cap removed)', () => {
    const db = testDb();
    const initial = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'consume-cap');
    const suppliedCoin = initial.zones.draw[0]!;
    const supplied = {
      ...initial,
      zones: {
        ...initial.zones,
        hand: [...initial.zones.hand, suppliedCoin],
        draw: initial.zones.draw.slice(1)
      }
    };
    let state = withHandDefs(
      replaceFlipRng(supplied, [
        'heads',
        'heads',
        'heads',
        'heads'
      ]),
      ['basic', 'basic', 'fire', 'basic']
    );
    state = useFirstCoin(state, 0, 0, db).state; // slash: 75 → 65
    state = useFirstCoin(state, 1, 0, db).state; // guard
    const fire = state.zones.hand.find((coin) => state.coins[Number(coin)]?.defId === 'fire');
    expect(fire).toBeDefined();
    if (fire === undefined) return;
    const consume = step(state, { type: 'useConsumeSkill', slot: slot(4), coins: [fire], target: 0 }, db);
    expect(consume.ok).toBe(true);
    if (!consume.ok) return; // ignite-sword: 65 → 55, 화상 2
    const fourth = step(consume.state, { type: 'useImmediateFlipSkill', slot: slot(3), coins: [firstHandCoin(consume.state)], target: 0 }, db);
    expect(fourth.ok).toBe(true);
    if (!fourth.ok) return;
    // ignite 앞면: 기본 화상 1 + 앞면 화상 1 → 총 4
    expect(statusStacks(fourth.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(4);
    expect(fourth.state.enemies[0]?.hp).toBe(55);
  });

  it('omits consume legal commands when hand has no fire or fire grant', () => {
    const db = testDb();
    const state = withHandDefs(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'no-fuel'), [
      'basic',
      'basic',
      'basic'
    ]);
    expect(legalCommands(state, db).some((command) => command.type === 'useConsumeSkill')).toBe(false);
  });
});

describe('combat determinism and D0', () => {
  it('replays identical events for the same seed and commands', () => {
    const db = testDb();
    const run = () => {
      let state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'same-seed');
      const coin = firstHandCoin(state);
      const commands: Command[] = [
        { type: 'useImmediateFlipSkill', slot: slot(0), coins: [coin], target: 0 },
        { type: 'endTurn' }
      ];
      return commands.flatMap((cmd) => {
        const result = step(state, cmd, db);
        expect(result.ok).toBe(true);
        if (!result.ok) return [];
        state = result.state;
        return result.events;
      });
    };

    expect(run()).toEqual(run());
  });

  // P7 D1: 같은 턴 재사용은 쿨다운(기본 1)이 거부하고, 4번째 스킬 사용은 합법이며,
  // 쿨다운은 다음 플레이어 턴 시작에 감소해 재사용이 가능해진다.
  it('rejects a same-turn reuse via cooldown, allows a fourth use, then frees the skill next turn', () => {
    const db = testDb();
    const initial = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'd0');
    const suppliedCoin = initial.zones.draw[0]!;
    const supplied = {
      ...initial,
      zones: {
        ...initial.zones,
        hand: [...initial.zones.hand, suppliedCoin],
        draw: initial.zones.draw.slice(1)
      }
    };
    let state = replaceFlipRng(supplied, [
      'heads',
      'heads',
      'heads',
      'heads',
      'heads',
      'heads'
    ]);
    const first = useFirstCoin(state, 0);
    state = first.state;
    expect(state.slots[0]?.cooldownRemaining).toBe(1);

    const reuse = step(state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [firstHandCoin(state)], target: 0 }, db);
    expect(reuse).toEqual({ ok: false, error: 'skill is cooling down' });

    const second = useFirstCoin(state, 1);
    state = second.state;
    state.slots[2] = { skillId: id<SkillId>('slash'), cooldownRemaining: 0, usedThisCombat: false };
    state.slots[3] = { skillId: id<SkillId>('guard'), cooldownRemaining: 0, usedThisCombat: false };
    state = useFirstCoin(state, 2).state;
    // 4번째 스킬 사용 — 구 3회 캡이 사라져 합법이다
    const fourth = useFirstCoin(state, 3);
    expect(fourth.state.slots[3]?.cooldownRemaining).toBe(1);

    const ended = step(fourth.state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      // 턴 시작 감소: 쿨1 스킬 전부 다시 가용
      expect(ended.state.slots.every((s) => s.cooldownRemaining === 0)).toBe(true);
      expect(
        step(ended.state, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [firstHandCoin(ended.state)], target: 0 }, db).ok
      ).toBe(true);
    }
  });
});

describe('draw and win loss', () => {
  it('draws 3, reshuffles discard when draw is depleted, and permits partial draw', () => {
    const db = testDb();
    let state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'draw');
    expect(state.zones.hand).toHaveLength(3);

    state = {
      ...state,
      zones: { ...state.zones, hand: [], draw: [], discard: [1 as CoinUid, 2 as CoinUid, 3 as CoinUid], exhausted: [] }
    };
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.state.zones.hand).toHaveLength(3);
      expect(ended.events).toContainEqual({ type: 'pileShuffled', count: 3 });
    }
  });

  it('emits discard lifecycle events for skill costs and unused end-turn coins', () => {
    const db = testDb();
    const flipState = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'discard-event'), [
      'tails'
    ]);
    const cost = firstHandCoin(flipState);
    const used = useFirstCoin(flipState, 0, 0, db);
    expect(used.events).toContainEqual({ type: 'coinsDiscarded', coins: [cost], reason: 'skillCost' });

    const turnState = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'turn-discard-event');
    const unused = [...turnState.zones.hand];
    const ended = step(turnState, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.events).toContainEqual({ type: 'coinsDiscarded', coins: unused, reason: 'turnEnd' });
  });

  it('ends on enemy hp zero, player hp zero, and checks after each atom', () => {
    const db = testDb();
    const state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'win'), [
      'heads'
    ]);
    state.enemies[0]!.hp = 10;
    const lethalCost = firstHandCoin(state);
    const victory = useFirstCoin(state, 0);
    expect(victory.state.phase).toBe('victory');
    expect(victory.state.zones.placed[slot(0)]).toEqual([]);
    expect(victory.state.zones.discard).toContain(lethalCost);
    expect(victory.events).toContainEqual({ type: 'coinsDiscarded', coins: [lethalCost], reason: 'skillCost' });

    const losing = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'loss');
    const lost = step({ ...losing, player: { ...losing.player, hp: 1 } }, { type: 'endTurn' }, db);
    expect(lost.ok).toBe(true);
    if (lost.ok) expect(lost.state.phase).toBe('defeat');
  });

  it('enemy burn ticks through block and decays by one', () => {
    const db = testDb();
    db.enemies.raider = {
      ...db.enemies.raider!,
      intents: [{ id: 'brace', actions: [{ kind: 'block', amount: 99 }] }]
    };
    const state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'burn-tick');
    state.enemies[0] = { ...state.enemies[0]!, statuses: { burn: { kind: 'stack', stacks: 3 } } };
    const ended = step(state, { type: 'endTurn' }, db);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.state.enemies[0]?.hp).toBe(72);
      expect(ended.state.enemies[0]?.block).toBe(99);
      expect(statusStacks(ended.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(2);
    }
  });

  it('ember pouch adds one temporary fire coin to draw before the opening draw and emits an event', () => {
    const db = testDb();
    db.characters.warrior = {
      ...db.characters.warrior!,
      startingBag: [...Array.from({ length: 8 }, () => id<CoinDefId>('basic')), id<CoinDefId>('fire'), id<CoinDefId>('fire')],
      trait: {
        id: 'ember-pouch',
        name: '불씨 주머니',
        hook: 'combatStart',
        effects: [{ kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'draw', count: 1 }]
      }
    };
    const state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'ember');
    const allCoins = [...state.zones.draw, ...state.zones.hand];
    const fireCoins = allCoins.filter((coin) => state.coins[Number(coin)]?.defId === 'fire');
    const temporaryFire = fireCoins.filter((coin) => state.coins[Number(coin)]?.permanent === false);

    expect(allCoins).toHaveLength(11);
    expect(fireCoins).toHaveLength(3);
    expect(temporaryFire).toHaveLength(1);
    expect(state.events.some((event) => event.type === 'traitTriggered' && event.trait === 'ember-pouch')).toBe(true);
  });

  it('preserves block granted by a combat-start hook through the opening turn', () => {
    const db = testDb();
    db.characters.warrior = {
      ...db.characters.warrior!,
      trait: {
        id: 'opening-guard',
        name: '선제 방어',
        hook: 'combatStart',
        effects: [{ kind: 'block', amount: 6 }]
      }
    };

    const state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'opening-guard');

    expect(state.player.block).toBe(6);
    expect(state.events).not.toContainEqual({
      type: 'blockCleared',
      target: { type: 'player' },
      amount: 6
    });
  });

  it('addCoin to hand over the cap sends overflow to discard', () => {
    const db = testDb();
    db.skills.slash = {
      ...(db.skills.slash as FlipSkillDef),
      base: [{ kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'hand', count: 1 }],
      heads: undefined
    };
    const state = replaceFlipRng(createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'hand-cap'), [
      'tails'
    ]);
    const loadedCoin = state.zones.hand[0]!;
    const extra = [11, 12, 13, 14, 15, 16, 17, 18].map((value) => value as CoinUid);
    const capped = {
      ...state,
      nextUid: 19,
      zones: {
        ...state.zones,
        hand: [loadedCoin, ...state.zones.hand.slice(1), ...extra]
      },
      coins: {
        ...state.coins,
        ...Object.fromEntries(extra.map((coin) => [Number(coin), { uid: coin, defId: id<CoinDefId>('basic'), permanent: true, grants: [] }]))
      }
    };
    const result = step(capped, { type: 'useImmediateFlipSkill', slot: slot(0), coins: [loadedCoin], target: 0 }, db);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.zones.hand).toHaveLength(10);
    const created = result.events.find((event) => event.type === 'coinCreated');
    expect(created).toMatchObject({ type: 'coinCreated', zone: 'discard' });
  });

  it('addCoin to draw consumes the shuffle stream deterministically', () => {
    const db = testDb();
    db.characters.warrior = {
      ...db.characters.warrior!,
      trait: {
        id: 'ember-pouch',
        name: '불씨 주머니',
        hook: 'combatStart',
        effects: [{ kind: 'addCoin', coin: id<CoinDefId>('fire'), zone: 'draw', count: 1 }]
      }
    };

    const first = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'shuffle-consume');
    const second = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, 'shuffle-consume');
    expect(first.rng.shuffle).toEqual(second.rng.shuffle);
    expect(first.zones.draw).toEqual(second.zones.draw);
    expect(first.rng.shuffle).not.toEqual(createCombat({ character: id('warrior'), enemies: [id('raider')] }, testDb(), 'shuffle-consume').rng.shuffle);
  });
});

describe('combat fuzz smoke', () => {
  it('keeps core invariants for 100 deterministic games', () => {
    const db = testDb();
    for (let game = 0; game < 100; game += 1) {
      let state = createCombat({ character: id('warrior'), enemies: [id('raider')] }, db, `fuzz-${game}`);
      for (let i = 0; i < 50 && state.phase === 'player'; i += 1) {
        const legal = legalCommands(state, db);
        const cmd =
          legal.find((candidate) => candidate.type === 'useImmediateFlipSkill') ??
          ({ type: 'endTurn' } as Command);
        const result = step(state, cmd, db);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
        expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
        expect(state.player.block).toBeGreaterThanOrEqual(0);
        expect(Object.keys(state.coins).length).toBeGreaterThanOrEqual(10);
        expect(zoneCoinCount(state.zones, state.custody)).toBe(Object.keys(state.coins).length);
      }
    }
  });
});
