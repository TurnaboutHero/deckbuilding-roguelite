import type {
  CombatState,
  CoinDefId,
  CoinUid,
  ConsumeSkillDef,
  EnemyDef,
  Face,
  FlipSkillDef,
  Rng,
  RngSnapshot,
  SkillDef,
  SkillId,
  SlotId
} from '@game/core';
import { createCombat, step, validateContentDb } from '@game/core';
import { describe, expect, it } from 'vitest';

import { characters, coins, CONTENT_VERSION, contentDb, enemies, skills } from './index';

const skillId = (value: string) => value as SkillId;
const coinId = (value: string) => value as CoinDefId;
const slotId = (value: number) => value as SlotId;

const scriptedFlips = (faces: readonly Face[]): Rng => {
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
    shuffle: <T>(items: readonly T[]) => [...items],
    snapshot: (): RngSnapshot => ({ s: [index, 0, 0, 0] })
  };
};

const withFaces = (state: CombatState, faces: readonly Face[]): CombatState => ({
  ...state,
  rngImpl: { ...state.rngImpl, flip: scriptedFlips(faces) }
});

const withEquippedSkill = (state: CombatState, value: string): CombatState => ({
  ...state,
  slots: state.slots.map((candidate, index) =>
    index === 0 ? { ...candidate, skillId: skillId(value), usedThisTurn: false, usedThisCombat: false } : candidate
  )
});

const withHandDefs = (state: CombatState, defs: readonly string[]): CombatState => ({
  ...state,
  coins: {
    ...state.coins,
    ...Object.fromEntries(
      defs.map((defId, index) => {
        const coin = state.zones.hand[index];
        if (coin === undefined) throw new Error('missing hand coin');
        return [Number(coin), { ...state.coins[Number(coin)]!, defId: coinId(defId), grants: [] }];
      })
    )
  }
});

const useFlip = (state: CombatState, coinsToUse: readonly CoinUid[], target?: number, chosen?: CoinUid[]) => {
  let current = state;
  for (const coin of coinsToUse) {
    const placed = step(current, { type: 'placeCoin', coin, slot: slotId(0) }, contentDb);
    if (!placed.ok) throw new Error(placed.error);
    current = placed.state;
  }
  const result = step(current, { type: 'useFlipSkill', slot: slotId(0), target, chosen }, contentDb);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const combat = (seed: string, character = 'warrior'): CombatState =>
  createCombat({ character: character as never, enemies: ['raider' as never] }, contentDb, seed);

const averageAction = (enemy: EnemyDef, kind: 'attack' | 'block'): number =>
  enemy.intents.reduce(
    (total, intent) =>
      total +
      intent.actions.reduce((sum, action) => {
        if (kind === 'attack' && action.kind === 'attack') return sum + action.damage * (action.hits ?? 1);
        if (kind === 'block' && action.kind === 'block') return sum + action.amount;
        return sum;
      }, 0),
    0
  ) / enemy.intents.length;

const flipSkill = (overrides: Partial<FlipSkillDef> = {}): FlipSkillDef => ({
  id: skillId('test-flip'),
  name: '테스트 장전 스킬',
  type: 'flip',
  rarity: 'common',
  tags: ['attack'],
  targetType: 'single-enemy',
  cost: 1,
  base: [{ kind: 'damage', amount: 1 }],
  ...overrides
});

const consumeSkill = (overrides: Partial<ConsumeSkillDef> = {}): ConsumeSkillDef => ({
  id: skillId('test-consume'),
  name: '테스트 소비 스킬',
  type: 'consume',
  rarity: 'common',
  tags: ['utility'],
  targetType: 'none',
  consume: { element: 'fire', count: 1 },
  effects: [],
  ...overrides
});

const validateSkill = (skill: SkillDef): string[] =>
  validateContentDb({
    coins: {},
    skills: { [String(skill.id)]: skill },
    enemies: {},
    characters: {}
  });

describe('content cost lint (A18)', () => {
  it('accepts the shipped content database', () => {
    expect(contentDb.validate()).toEqual([]);
  });

  it('accepts ordinary flip costs through 4', () => {
    expect(validateSkill(flipSkill({ cost: 4 }))).toEqual([]);
  });

  it('accepts cost 5 only for rare once-per-combat or ultimate skills', () => {
    expect(validateSkill(flipSkill({ cost: 5, rarity: 'rare', oncePerCombat: true }))).toEqual([]);
    expect(validateSkill(flipSkill({ cost: 5, rarity: 'rare', tags: ['attack', 'ultimate'] }))).toEqual([]);
  });

  it('rejects invalid or over-limit flip costs', () => {
    expect(validateSkill(flipSkill({ cost: 0 }))).toContain('skill test-flip: flip cost must be a positive integer');
    expect(validateSkill(flipSkill({ cost: 1.5 }))).toContain('skill test-flip: flip cost must be a positive integer');
    expect(validateSkill(flipSkill({ cost: 5, rarity: 'advanced', oncePerCombat: true }))).toContain(
      'skill test-flip: flip cost 5 requires rare rarity and oncePerCombat or ultimate'
    );
    expect(validateSkill(flipSkill({ cost: 5, rarity: 'rare' }))).toContain(
      'skill test-flip: flip cost 5 requires rare rarity and oncePerCombat or ultimate'
    );
    expect(validateSkill(flipSkill({ cost: 6, rarity: 'rare', oncePerCombat: true }))).toContain(
      'skill test-flip: flip cost 6 exceeds the maximum of 5'
    );
  });

  it('accepts consume counts 1 through 3 and rejects all other values', () => {
    expect(validateSkill(consumeSkill({ consume: { element: 'fire', count: 1 } }))).toEqual([]);
    expect(validateSkill(consumeSkill({ consume: { element: 'fire', count: 3 } }))).toEqual([]);
    expect(validateSkill(consumeSkill({ consume: { element: 'fire', count: 0 } }))).toContain(
      'skill test-consume: consume count must be an integer from 1 to 3'
    );
    expect(validateSkill(consumeSkill({ consume: { element: 'fire', count: 4 } }))).toContain(
      'skill test-consume: consume count must be an integer from 1 to 3'
    );
    expect(validateSkill(consumeSkill({ consume: { element: 'fire', count: 1.5 } }))).toContain(
      'skill test-consume: consume count must be an integer from 1 to 3'
    );
  });
});

describe('M5 shipped content', () => {
  it('ships the M5 version, mana coin, skills, and fixed enemy definitions', () => {
    expect(CONTENT_VERSION).toBe('0.6.0-p3.2');
    expect(coins.mana).toEqual({
      id: coinId('mana'),
      element: 'mana',
      proc: { face: 'heads', effects: [{ kind: 'block', amount: 2 }] }
    });
    expect(skills.smash).toMatchObject({
      name: '강타',
      type: 'flip',
      cost: 2,
      base: [{ kind: 'damage', amount: 8 }],
      heads: { mode: 'per', effects: [{ kind: 'damage', amount: 5 }] }
    });
    expect(skills['fire-infusion']).toMatchObject({
      name: '화염 주입',
      cost: 1,
      base: [{ kind: 'addCoin', coin: coinId('fire'), zone: 'draw', count: 1 }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] },
      tails: { mode: 'any', effects: [{ kind: 'block', amount: 4 }] }
    });
    expect(skills.furnace).toMatchObject({
      name: '용광로',
      cost: 1,
      base: [{ kind: 'grantElement', element: 'fire', scope: 'chooseBasicInHand' }],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
    });
    expect(skills['warding-strike']).toMatchObject({
      name: '수호 타격',
      cost: 1,
      base: [{ kind: 'damage', amount: 5 }],
      tails: { mode: 'any', effects: [{ kind: 'block', amount: 4 }] }
    });
    expect(skills['mana-bulwark']).toMatchObject({
      name: '마나 방벽',
      cost: 2,
      base: [{ kind: 'block', amount: 8 }],
      tails: { mode: 'per', effects: [{ kind: 'block', amount: 3 }] }
    });
    expect(skills['shield-reprisal']).toMatchObject({
      name: '방패 반격',
      cost: 2,
      base: [
        { kind: 'block', amount: 6 },
        { kind: 'damage', amount: 4 }
      ],
      tails: { mode: 'per', effects: [{ kind: 'damage', amount: 4 }] }
    });
    expect(skills['mana-well']).toMatchObject({
      name: '마나 샘',
      cost: 1,
      base: [{ kind: 'addCoin', coin: coinId('mana'), zone: 'discard', count: 1 }],
      tails: { mode: 'any', effects: [{ kind: 'block', amount: 4 }] }
    });
    expect(enemies.gatekeeper.maxHp).toBe(70);
    expect(enemies.shaman.maxHp).toBe(60);
    expect(averageAction(enemies.shaman, 'attack')).toBe(4.5);
    expect(enemies.shaman.intents[0]?.actions).toEqual([{ kind: 'nextDrawPenalty', amount: 1 }]);
    expect(JSON.parse(JSON.stringify(enemies.shaman))).toEqual(enemies.shaman);
  });

  it('defines Guardian with the fixed mana starting kit and combat-start trait', () => {
    expect(characters.guardian).toEqual({
      id: 'guardian',
      name: '수호자',
      maxHp: 70,
      startingBag: [
        coinId('basic'),
        coinId('basic'),
        coinId('basic'),
        coinId('basic'),
        coinId('basic'),
        coinId('basic'),
        coinId('basic'),
        coinId('basic'),
        coinId('mana'),
        coinId('mana')
      ],
      startingSkills: [
        skillId('slash'),
        skillId('guard'),
        skillId('warding-strike'),
        skillId('mana-bulwark'),
        skillId('shield-reprisal'),
        skillId('mana-well')
      ],
      trait: {
        id: 'quiet-spring',
        name: '고요한 샘',
        hook: 'combatStart',
        effects: [{ kind: 'addCoin', coin: coinId('mana'), zone: 'draw', count: 1 }]
      }
    });

    const state = combat('guardian-start', 'guardian');
    const bagDefs = Object.values(state.coins).map((coin) => String(coin.defId));
    expect(bagDefs.filter((def) => def === 'basic')).toHaveLength(8);
    expect(bagDefs.filter((def) => def === 'mana')).toHaveLength(3);
    expect(Object.values(state.coins).filter((coin) => !coin.permanent && String(coin.defId) === 'mana')).toHaveLength(1);
  });

  it('marks guardian skills exclusiveTo guardian while keeping them enumerable', () => {
    const guardianSkills = ['warding-strike', 'mana-bulwark', 'shield-reprisal', 'mana-well'];
    // 정본 스킬 레코드는 전부 열거 가능해야 한다 — 숨김 프로퍼티 경계 금지 (P3.2 결정)
    const enumerated = Object.values(contentDb.skills).map((candidate) => String(candidate.id));
    expect(enumerated).toEqual(expect.arrayContaining(guardianSkills));
    for (const id of guardianSkills) {
      expect(String(contentDb.skills[id]?.exclusiveTo)).toBe('guardian');
    }
    // JSON 직렬화 왕복에서도 사라지지 않는다
    const roundTrip = JSON.parse(JSON.stringify(contentDb.skills)) as Record<string, unknown>;
    for (const id of guardianSkills) expect(roundTrip[id]).toBeDefined();
    // 전사 전용이 아닌 기존 스킬은 exclusiveTo가 없다
    expect(contentDb.skills['slash']?.exclusiveTo).toBeUndefined();
  });

  it('keeps upgraded encounter enemies 10-15 percent stronger without conditional AI', () => {
    const upgrades = [
      [enemies.raider, enemies['raider-plus']],
      [enemies.gatekeeper, enemies['gatekeeper-plus']]
    ] as const;

    for (const [base, upgraded] of upgrades) {
      expect(upgraded.maxHp / base.maxHp).toBeGreaterThanOrEqual(1.1);
      expect(upgraded.maxHp / base.maxHp).toBeLessThanOrEqual(1.15);
      expect(averageAction(upgraded, 'attack') / averageAction(base, 'attack')).toBeGreaterThanOrEqual(1.1);
      expect(averageAction(upgraded, 'attack') / averageAction(base, 'attack')).toBeLessThanOrEqual(1.15);
    }

    expect(averageAction(enemies['gatekeeper-plus'], 'block') / averageAction(enemies.gatekeeper, 'block')).toBeGreaterThanOrEqual(1.1);
    expect(averageAction(enemies['gatekeeper-plus'], 'block') / averageAction(enemies.gatekeeper, 'block')).toBeLessThanOrEqual(1.15);
  });

  it('mana heads grants exactly two player block in attack, defense, and self-target contexts', () => {
    const cases = [
      { skill: 'slash', expectedBlock: 2, target: 0 },
      { skill: 'guard', expectedBlock: 7, target: undefined },
      { skill: 'flame-rampage', expectedBlock: 2, target: undefined }
    ] as const;

    for (const testCase of cases) {
      let state = withFaces(combat(`mana-${testCase.skill}`), ['heads']);
      state = withEquippedSkill(state, testCase.skill);
      state = withHandDefs(state, ['mana']);
      const cost = state.zones.hand[0];
      if (cost === undefined) throw new Error('missing mana coin');
      const result = useFlip(state, [cost], testCase.target);

      expect(result.state.player.block).toBe(testCase.expectedBlock);
      expect(result.events.filter((event) => event.type === 'blockGained' && event.amount === 2)).toHaveLength(1);
    }
  });

  it.each([
    [['heads', 'heads'], 18],
    [['heads', 'tails'], 13],
    [['tails', 'heads'], 13],
    [['tails', 'tails'], 8]
  ] as const)('Smash %j deals %i base damage before coin procs', (faces, expectedDamage) => {
    let state = withFaces(combat(`smash-${faces.join('-')}`), faces);
    state = withEquippedSkill(state, 'smash');
    state = withHandDefs(state, ['basic', 'basic']);
    const costs = state.zones.hand.slice(0, 2);
    const hpBefore = state.enemies[0]?.hp ?? 0;
    const result = useFlip(state, costs, 0);
    expect(hpBefore - (result.state.enemies[0]?.hp ?? 0)).toBe(expectedDamage);
  });

  it('Fire Infusion creates a temporary fire coin in draw and resolves both face branches', () => {
    let headsState = withFaces(combat('fire-infusion-heads'), ['heads']);
    headsState = withEquippedSkill(headsState, 'fire-infusion');
    headsState = withHandDefs(headsState, ['basic']);
    const headsCost = headsState.zones.hand[0];
    if (headsCost === undefined) throw new Error('missing heads cost');
    const heads = useFlip(headsState, [headsCost], 0);
    const created = heads.events.find((event) => event.type === 'coinCreated');

    expect(heads.state.enemies[0]?.hp).toBe(71);
    expect(heads.state.player.block).toBe(0);
    expect(created).toMatchObject({ type: 'coinCreated', defId: 'fire', zone: 'draw' });
    if (created?.type === 'coinCreated') {
      expect(heads.state.zones.draw).toContain(created.coin);
      expect(heads.state.coins[Number(created.coin)]?.permanent).toBe(false);
    }

    let tailsState = withFaces(combat('fire-infusion-tails'), ['tails']);
    tailsState = withEquippedSkill(tailsState, 'fire-infusion');
    tailsState = withHandDefs(tailsState, ['basic']);
    const tailsCost = tailsState.zones.hand[0];
    if (tailsCost === undefined) throw new Error('missing tails cost');
    const tails = useFlip(tailsState, [tailsCost], 0);

    expect(tails.state.enemies[0]?.hp).toBe(75);
    expect(tails.state.player.block).toBe(4);
    expect(tails.events).toContainEqual(expect.objectContaining({ type: 'coinCreated', defId: 'fire', zone: 'draw' }));
  });

  it('Furnace grants fire only to basic coins remaining in hand and resolves heads damage', () => {
    let state = withFaces(combat('furnace-heads'), ['heads']);
    state = withEquippedSkill(state, 'furnace');
    state = withHandDefs(state, ['basic', 'basic', 'basic', 'fire', 'mana']);
    const [cost, basicOne, basicTwo, fire, mana] = state.zones.hand;
    if (cost === undefined || basicOne === undefined || basicTwo === undefined || fire === undefined || mana === undefined) {
      throw new Error('missing furnace hand');
    }

    const result = useFlip(state, [cost], 0, [basicTwo]);
    expect(result.state.enemies[0]?.hp).toBe(71);
    expect(result.events).toContainEqual({ type: 'elementGranted', coins: [basicTwo], element: 'fire' });
    expect(result.state.coins[Number(cost)]?.grants).toEqual([]);
    expect(result.state.coins[Number(basicOne)]?.grants).toEqual([]);
    expect(result.state.coins[Number(basicTwo)]?.grants).toEqual(['fire']);
    expect(result.state.coins[Number(fire)]?.grants).toEqual([]);
    expect(result.state.coins[Number(mana)]?.grants).toEqual([]);
  });

  it.each([
    ['heads', 70, 0],
    ['tails', 70, 4]
  ] as const)('Warding Strike %s keeps base damage and uses tails as block', (face, expectedHp, expectedBlock) => {
    let state = withFaces(combat(`warding-strike-${face}`), [face]);
    state = withEquippedSkill(state, 'warding-strike');
    state = withHandDefs(state, ['basic']);
    const cost = state.zones.hand[0];
    if (cost === undefined) throw new Error('missing warding strike cost');
    const result = useFlip(state, [cost], 0);

    expect(result.state.enemies[0]?.hp).toBe(expectedHp);
    expect(result.state.player.block).toBe(expectedBlock);
  });

  it.each([
    [['heads', 'heads'], 8],
    [['heads', 'tails'], 11],
    [['tails', 'heads'], 11],
    [['tails', 'tails'], 14]
  ] as const)('Mana Bulwark %j scales block per tails', (faces, expectedBlock) => {
    let state = withFaces(combat(`mana-bulwark-${faces.join('-')}`), faces);
    state = withEquippedSkill(state, 'mana-bulwark');
    state = withHandDefs(state, ['basic', 'basic']);
    const costs = state.zones.hand.slice(0, 2);
    const result = useFlip(state, costs);

    expect(result.state.player.block).toBe(expectedBlock);
    expect(result.state.enemies[0]?.hp).toBe(75);
  });

  it.each([
    [['heads', 'heads'], 71, 6],
    [['heads', 'tails'], 67, 6],
    [['tails', 'heads'], 67, 6],
    [['tails', 'tails'], 63, 6]
  ] as const)('Shield Reprisal %j approximates shield-bash via base block and tails damage', (faces, expectedHp, expectedBlock) => {
    let state = withFaces(combat(`shield-reprisal-${faces.join('-')}`), faces);
    state = withEquippedSkill(state, 'shield-reprisal');
    state = withHandDefs(state, ['basic', 'basic']);
    const costs = state.zones.hand.slice(0, 2);
    const result = useFlip(state, costs, 0);

    expect(result.state.enemies[0]?.hp).toBe(expectedHp);
    expect(result.state.player.block).toBe(expectedBlock);
  });

  it.each([
    ['heads', 0],
    ['tails', 4]
  ] as const)('Mana Well %s creates temporary mana in discard and uses tails as fallback block', (face, expectedBlock) => {
    let state = withFaces(combat(`mana-well-${face}`), [face]);
    state = withEquippedSkill(state, 'mana-well');
    state = withHandDefs(state, ['basic']);
    const cost = state.zones.hand[0];
    if (cost === undefined) throw new Error('missing mana well cost');
    const result = useFlip(state, [cost]);
    const created = result.events.find((event) => event.type === 'coinCreated' && event.defId === 'mana');

    expect(result.state.player.block).toBe(expectedBlock);
    expect(created).toMatchObject({ type: 'coinCreated', defId: 'mana', zone: 'discard' });
    if (created?.type === 'coinCreated') {
      expect(result.state.zones.discard).toContain(created.coin);
      expect(result.state.coins[Number(created.coin)]?.permanent).toBe(false);
    }
  });
});
