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
import { createCombat, deriveUpgradedSkill, legalCommands, rewardEligibleSkillIds, statusStacks, statusTurns, step, validateContentDb } from '@game/core';
import { describe, expect, it } from 'vitest';

import { characters, coins, CONTENT_VERSION, LEGACY_CONTENT_VERSIONS, contentDb, enemies, equipment, events, passives, skills } from './index';

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
    index === 0 ? { ...candidate, skillId: skillId(value), cooldownRemaining: 0, usedThisCombat: false } : candidate
  )
});

const withEquippedSkills = (state: CombatState, values: readonly string[]): CombatState => ({
  ...state,
  slots: state.slots.map((candidate, index) =>
    values[index] === undefined
      ? candidate
      : { ...candidate, skillId: skillId(values[index]), cooldownRemaining: 0, usedThisCombat: false }
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

describe('P9 latest design sync', () => {
  it('ships the revised starters while retaining legacy reward ids', () => {
    expect(characters.warrior.startingSkills.map(String)).toEqual(['jab', 'fist-guard', 'burning-fist', 'flame-hook']);
    expect(skills['flame-hook']).toMatchObject({ name: '잿불 베기', cost: 1 });
    expect(skills['inner-passion']).toBeDefined();
    expect(characters.sorcerer.startingSkills.map(String)).toEqual(['slash', 'guard', 'attaque', 'parade']);
    expect(Object.values(contentDb.skills).filter((entry) => String(entry.exclusiveTo) === 'sorcerer')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '팡트' }),
        expect.objectContaining({ name: '뇌정 처형' })
      ])
    );
  });

  it('resolves 르미즈 heads-heads as one free reuse with one cooldown and one discard', () => {
    let state = withEquippedSkill(combat('p9-remise', 'sorcerer'), 'attaque');
    state = withFaces(state, ['heads', 'heads', 'tails']);
    const coin = state.zones.hand[0]!;
    const result = useFlip(state, [coin], 0);
    expect(result.events.filter((event) => event.type === 'remiseReflipped')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'remiseReused')).toHaveLength(1);
    expect(result.events.filter((event) => event.type === 'coinsDiscarded')).toEqual([
      { type: 'coinsDiscarded', coins: [coin], reason: 'skillCost' }
    ]);
    expect(result.state.slots[0]?.cooldownRemaining).toBe(1);
    expect(result.state.enemies[0]?.hp).toBe(63);
  });

  it('caps 병기 출력 at five and adds it to summon strike and ward actions', () => {
    let state = combat('p9-output', 'arcanist');
    state = {
      ...state,
      player: { ...state.player, weaponOutput: 5 },
      summons: [
        { uid: 10, defId: 'mana-sword' as never, duration: 2, enhance: 1, aoeUses: 0 },
        { uid: 11, defId: 'mana-shield' as never, duration: 2, enhance: 0, aoeUses: 0 }
      ],
      nextSummonUid: 12
    };
    const ended = step(state, { type: 'endTurn' }, contentDb);
    if (!ended.ok) throw new Error(ended.error);
    expect(ended.events).toContainEqual({ type: 'summonActed', uid: 10, equipment: 'mana-sword', bonus: 6 });
    expect(ended.events).toContainEqual({ type: 'summonActed', uid: 11, equipment: 'mana-shield', bonus: 5 });
    expect(ended.state.player.weaponOutput).toBe(5);
  });

  it('caps reactor output gains and extends the chosen summon at the summon cap', () => {
    let state = withEquippedSkills(combat('p9-reactor-clone', 'arcanist'), ['reactor-overdrive', 'arcane-duplicate']);
    state = withHandDefs(state, ['mana', 'mana', 'mana', 'mana']);
    state = {
      ...state,
      player: { ...state.player, weaponOutput: 4 },
      summons: [
        { uid: 20, defId: 'mana-sword' as never, duration: 2, enhance: 0, aoeUses: 0 },
        { uid: 21, defId: 'mana-shield' as never, duration: 2, enhance: 0, aoeUses: 0 },
        { uid: 22, defId: 'mana-sword' as never, duration: 1, enhance: 1, aoeUses: 0 }
      ],
      nextSummonUid: 23
    };
    const overdriven = useConsumeAt(state, 0, state.zones.hand.slice(0, 2));
    expect(overdriven.state.player.weaponOutput).toBe(5);
    expect(overdriven.events).toContainEqual({ type: 'weaponOutputChanged', amount: 1, value: 5 });
    const duplicated = useConsumeAt(overdriven.state, 1, overdriven.state.zones.hand.slice(0, 2), undefined, 22);
    expect(duplicated.state.summons).toHaveLength(3);
    expect(duplicated.state.summons.find((summon) => summon.uid === 22)?.duration).toBe(4);
  });

  it('fires the azure armory finisher as three plus summon-count virtual swords', () => {
    let state = withEquippedSkill(combat('p9-armory', 'arcanist'), 'azure-armory-open');
    state = {
      ...state,
      summons: [
        { uid: 30, defId: 'mana-sword' as never, duration: 2, enhance: 0, aoeUses: 0 },
        { uid: 31, defId: 'mana-shield' as never, duration: 2, enhance: 0, aoeUses: 0 }
      ],
      nextSummonUid: 32
    };
    const result = useFlip(withFaces(state, ['tails', 'tails', 'tails']), state.zones.hand.slice(0, 3));
    expect(result.state.enemies[0]?.hp).toBe(60);
    expect(result.events.filter((event) => event.type === 'damageDealt' && event.source === 'skill')).toHaveLength(5);
  });

  it('requires and preserves the selected summon for diffusion and duplication', () => {
    let state = withEquippedSkills(combat('p9-summon-choice', 'arcanist'), ['diffusion-mark', 'arcane-duplicate']);
    state = withHandDefs(state, ['basic', 'basic', 'mana', 'mana']);
    state = withFaces({
      ...state,
      summons: [
        { uid: 40, defId: 'mana-sword' as never, duration: 2, enhance: 0, aoeUses: 0 },
        { uid: 41, defId: 'mana-shield' as never, duration: 3, enhance: 0, aoeUses: 0 }
      ],
      nextSummonUid: 42
    }, ['tails', 'tails']);
    for (const coin of state.zones.hand.slice(0, 2)) {
      const placed = step(state, { type: 'placeCoin', coin, slot: slotId(0) }, contentDb);
      if (!placed.ok) throw new Error(placed.error);
      state = placed.state;
    }
    const diffusionCommands = legalCommands(state, contentDb).filter(
      (command) => command.type === 'useFlipSkill' && Number(command.slot) === 0
    );
    expect(diffusionCommands.map((command) => command.type === 'useFlipSkill' ? command.chosenSummon : undefined)).toEqual([40, 41]);
    expect(step(state, { type: 'useFlipSkill', slot: slotId(0) }, contentDb).ok).toBe(false);
    const diffused = step(state, { type: 'useFlipSkill', slot: slotId(0), chosenSummon: 41 }, contentDb);
    if (!diffused.ok) throw new Error(diffused.error);
    expect(diffused.state.summons.find((summon) => summon.uid === 40)?.duration).toBe(2);
    expect(diffused.state.summons.find((summon) => summon.uid === 41)).toMatchObject({ duration: 5, aoeUses: 1 });

    const duplicateCommands = legalCommands(diffused.state, contentDb).filter(
      (command) => command.type === 'useConsumeSkill' && Number(command.slot) === 1
    );
    expect(duplicateCommands.map((command) => command.type === 'useConsumeSkill' ? command.chosenSummon : undefined)).toEqual([40, 41]);
  });

  it('derives every confirmed P9 upgrade and leaves unconfirmed duelist upgrades absent', () => {
    const upgraded = (id: string) => deriveUpgradedSkill(contentDb.skills[id]!);
    expect((upgraded('alchemy-slash') as FlipSkillDef).tails?.mode).toBe('per');
    expect((upgraded('diffusion-mark') as FlipSkillDef).mixed?.effects).toEqual([
      { kind: 'addCoin', coin: coinId('mana'), zone: 'hand', count: 1 }
    ]);
    expect((upgraded('reactor-overdrive') as ConsumeSkillDef).consume.count).toBe(1);
    expect((upgraded('arcane-duplicate') as ConsumeSkillDef).effects[0]).toMatchObject({ fullCapExtension: 3 });
    expect((upgraded('azure-armory-open') as FlipSkillDef).base[0]).toMatchObject({ baseDamage: 4 });
    expect((upgraded('redoublement') as FlipSkillDef).base[0]).toEqual({ kind: 'readyRemise', amount: 2 });
    expect((upgraded('attaque-composee') as FlipSkillDef).remise?.addLightningToHandAfterReuse).toBe(2);
    expect((upgraded('charge-mark') as FlipSkillDef).heads?.effects[0]).toMatchObject({ stacks: 2 });
    expect((upgraded('capacitor-shield') as ConsumeSkillDef).effects[0]).toMatchObject({ base: 8, cap: 8 });
    expect(upgraded('superconduct')).toMatchObject({ oncePerCombat: undefined, cooldown: 4 });
    expect((upgraded('overload-flurry') as FlipSkillDef).base[0]).toMatchObject({ amount: 6 });
    expect((upgraded('thunder-execution') as ConsumeSkillDef).consume.count).toBe(2);
    for (const id of ['attaque', 'parade', 'fente', 'parade-riposte', 'fleche']) {
      expect(contentDb.skills[id]?.upgrade).toBeUndefined();
    }
  });

  it('doubles shock and discharges it on a failed execution', () => {
    let state = withEquippedSkills(combat('p9-shock', 'sorcerer'), ['superconduct', 'thunder-execution']);
    state = withHandDefs(state, ['lightning', 'lightning', 'lightning', 'lightning', 'lightning']);
    state = {
      ...state,
      enemies: state.enemies.map((enemy) => ({ ...enemy, statuses: { shock: { kind: 'duration', turns: 3 } } }))
    };
    const doubled = useConsumeAt(state, 0, state.zones.hand.slice(0, 2), 0);
    expect(statusTurns(doubled.state.enemies[0]?.statuses ?? {}, 'shock')).toBe(6);
    const discharged = useConsumeAt(doubled.state, 1, doubled.state.zones.hand.slice(0, 3), 0);
    expect(statusTurns(discharged.state.enemies[0]?.statuses ?? {}, 'shock')).toBe(0);
    expect(discharged.state.enemies[0]?.hp).toBeLessThan(75);
  });
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

const useFlipAt = (
  state: CombatState,
  slot: number,
  coinsToUse: readonly CoinUid[],
  target?: number,
  chosen?: CoinUid[]
) => {
  let current = state;
  for (const coin of coinsToUse) {
    const placed = step(current, { type: 'placeCoin', coin, slot: slotId(slot) }, contentDb);
    if (!placed.ok) throw new Error(placed.error);
    current = placed.state;
  }
  const result = step(current, { type: 'useFlipSkill', slot: slotId(slot), target, chosen }, contentDb);
  if (!result.ok) throw new Error(result.error);
  return result;
};

const useConsumeAt = (
  state: CombatState,
  slot: number,
  coins: readonly CoinUid[],
  target?: number,
  chosenSummon?: number
) => {
  const result = step(
    state,
    { type: 'useConsumeSkill', slot: slotId(slot), coins: [...coins], target, chosenSummon },
    contentDb
  );
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

describe('turn trigger content lint (P3.3)', () => {
  const triggerSkill = (trigger: unknown): SkillDef =>
    flipSkill({ base: [{ kind: 'addTurnTrigger', trigger } as never] });

  it('accepts a well-formed turn trigger', () => {
    expect(
      validateSkill(
        triggerSkill({
          id: 'ok-trigger',
          hook: 'onDamageDealt',
          effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }]
        })
      )
    ).toEqual([]);
  });

  it('rejects malformed trigger id, hook, and empty effects', () => {
    expect(
      validateSkill(triggerSkill({ id: '', hook: 'onDamageDealt', effects: [{ kind: 'damage', amount: 1 }] }))
    ).toContain('skill test-flip: turn trigger id must be a non-empty string');
    expect(
      validateSkill(triggerSkill({ id: 'bad-hook', hook: 'onTurnStart', effects: [{ kind: 'damage', amount: 1 }] }))
    ).toContain('skill test-flip: unknown turn trigger hook onTurnStart');
    expect(
      validateSkill(triggerSkill({ id: 'empty', hook: 'onDamageDealt', effects: [] }))
    ).toContain('skill test-flip: turn trigger empty must declare at least one effect');
  });

  it('rejects nested addTurnTrigger inside a trigger (cyclic surface)', () => {
    expect(
      validateSkill(
        triggerSkill({
          id: 'outer',
          hook: 'onDamageDealt',
          effects: [
            {
              kind: 'addTurnTrigger',
              trigger: { id: 'inner', hook: 'onDamageDealt', effects: [{ kind: 'damage', amount: 1 }] }
            }
          ]
        })
      )
    ).toContain('skill test-flip trigger outer: nested addTurnTrigger inside a trigger is not allowed');
  });
});

describe('P3.3 heart-of-flame interaction regressions', () => {
  // 감시자 함정 회귀: 하트 활성 중 utility 셋업(화염검) 사용은 하트를 발동시키지 않고
  // 셀프 화상도 만들지 않는다. 실제 공격은 적에게 화상 +2를 얹는다.
  const armedHeart = () => {
    let state = withEquippedSkills(combat('p33-heart-regression'), [
      'heart-of-flame',
      'slash',
      'flame-sword',
      'guard',
      'ignite',
      'flame-rampage'
    ]);
    state = withHandDefs(state, ['fire', 'fire', 'fire', 'fire', 'basic']);
    const coins = state.zones.hand.slice(0, 3);
    const heart = useConsumeAt(state, 0, coins, 0);
    return heart.state;
  };

  it('does not fire heart-of-flame nor burn the player when flame-sword resolves', () => {
    const state = armedHeart();
    const fuel = state.zones.hand.find((coin) => {
      const instance = state.coins[Number(coin)];
      return String(instance?.defId) === 'fire';
    });
    if (fuel === undefined) throw new Error('missing fuel');
    const setup = useConsumeAt(state, 2, [fuel]);

    expect(
      setup.events.filter(
        (event) => event.type === 'turnTriggerFired' && event.trigger === 'heart-of-flame'
      )
    ).toHaveLength(0);
    expect(statusStacks(setup.state.player.statuses, 'burn')).toBe(0);
  });

  it('fires heart-of-flame on a real attack and burns the enemy by 2', () => {
    const state = armedHeart();
    const coin = state.zones.hand[0];
    if (coin === undefined) throw new Error('missing coin');
    const placed = step(state, { type: 'placeCoin', coin, slot: slotId(1) }, contentDb);
    if (!placed.ok) throw new Error(placed.error);
    const attack = step(
      withFaces(placed.state, ['tails']),
      { type: 'useFlipSkill', slot: slotId(1), target: 0 },
      contentDb
    );
    if (!attack.ok) throw new Error(attack.error);

    expect(
      attack.events.filter(
        (event) => event.type === 'turnTriggerFired' && event.trigger === 'heart-of-flame'
      )
    ).toHaveLength(1);
    expect(statusStacks(attack.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(2);
    expect(statusStacks(attack.state.player.statuses, 'burn')).toBe(0);
  });

  it('rejects attack-tagged skills without an enemy targetType (structural lint)', () => {
    expect(
      validateSkill(flipSkill({ tags: ['attack'], targetType: 'self' }))
    ).toContain('skill test-flip: attack tag requires an enemy targetType (got self)');
  });
});

describe('P3.4 shipped content goldens', () => {
  it('ships the p7 version with legacy allowlist', () => {
    // P7: 쿨다운 행동 모델·8슬롯·양면 코인·과열 출하에 결속된 버전 승격, 직전 p6는 레거시로
    expect(CONTENT_VERSION).toBe('1.3.0-p9');
    expect(LEGACY_CONTENT_VERSIONS[0]).toBe('1.2.0-p7');
    expect(LEGACY_CONTENT_VERSIONS).toContain('1.0.0-rc.1');
    expect(LEGACY_CONTENT_VERSIONS).toContain('0.9.0-p4');
    expect(LEGACY_CONTENT_VERSIONS).toContain('0.8.0-p3.4');
    expect(LEGACY_CONTENT_VERSIONS).toContain('0.7.0-p3.3');
    expect(LEGACY_CONTENT_VERSIONS).toContain('0.6.0-p3.2');
    expect(LEGACY_CONTENT_VERSIONS).toContain('0.5.0-m5');
  });

  // P7 D4 — 모든 속성 코인은 양면 고유 효과 (v1.3 표 그대로)
  it('ships frost and lightning coins with two-sided procs', () => {
    expect(coins.frost).toEqual({
      id: coinId('frost'),
      element: 'frost',
      procs: {
        heads: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }],
        tails: [{ kind: 'block', amount: 1 }]
      }
    });
    expect(coins.lightning).toEqual({
      id: coinId('lightning'),
      element: 'lightning',
      procs: {
        heads: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }],
        tails: [{ kind: 'damage', amount: 1 }]
      }
    });
  });

  it('ships sorcerer and frost-knight with the standard character shape', () => {
    const sorcerer = characters.sorcerer;
    expect(sorcerer.maxHp).toBe(70);
    expect(sorcerer.startingBag.filter((coin) => String(coin) === 'lightning')).toHaveLength(2);
    expect(sorcerer.startingBag.filter((coin) => String(coin) === 'basic')).toHaveLength(8);
    // P7 D2 — 시작 4스킬: 공용 기본기 2 + 캐릭터 스킬 2 (빠진 스킬은 보상/상점 풀 존속)
    expect(sorcerer.name).toBe('번개 결투사');
    expect(sorcerer.startingSkills.map(String)).toEqual(['slash', 'guard', 'attaque', 'parade']);
    expect(sorcerer.trait.mechanic).toBe('remise');
    expect(sorcerer.trait.hook).toBe('combatStart');

    const frostKnight = characters['frost-knight'];
    expect(frostKnight.maxHp).toBe(70);
    expect(frostKnight.startingBag.filter((coin) => String(coin) === 'frost')).toHaveLength(2);
    expect(frostKnight.startingSkills.map(String)).toEqual([
      'slash', 'guard', 'frost-slash', 'glacial-wall'
    ]);
  });

  it('keeps every new skill exclusive to its character and lint-clean', () => {
    const sorcererSkills = ['spark-strike', 'chain-surge', 'static-field', 'volt-lash'];
    const frostSkills = ['frost-slash', 'glacial-wall', 'chilling-field', 'glacier-strike'];
    for (const skill of sorcererSkills) {
      expect(String(contentDb.skills[skill]?.exclusiveTo)).toBe('sorcerer');
    }
    for (const skill of frostSkills) {
      expect(String(contentDb.skills[skill]?.exclusiveTo)).toBe('frost-knight');
    }
    expect(contentDb.validate()).toEqual([]);
  });

  it('creates Fire Fist temporary fuel even when its overheat hit ends combat', () => {
    let state = withEquippedSkill(combat('fire-fist-finisher'), 'fire-fist');
    state = withFaces(
      {
        ...state,
        player: { ...state.player, overheat: true },
        enemies: state.enemies.map((enemy) => ({ ...enemy, hp: 14, maxHp: 14 }))
      },
      ['tails', 'tails']
    );
    const result = useFlip(state, state.zones.hand.slice(0, 2), 0);
    expect(result.state.phase).toBe('victory');
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'coinCreated', defId: 'fire', zone: 'draw' })
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'damageDealt', amount: 14, target: { type: 'enemy', index: 0 } })
    );
  });
});

describe('P4.2 provisional enemy content goldens', () => {
  // D2 조우 대역 산술: goblin+ghoul=70(2마리 65~85), thief+goblin=58(감전 압박 예외),
  // ghoul+goblin+slime=86(3마리 75~95). 수치 전부 balance-provisional.
  it('pins the six enemy definitions — P9(1.3.0-p9)에서도 적 6종 정의는 불변이어야 한다', () => {
    expect(CONTENT_VERSION).toBe('1.3.0-p9');
    expect(enemies.goblin).toEqual({
      id: 'goblin',
      name: '고블린',
      maxHp: 32,
      intents: [
        { id: 'stab', actions: [{ kind: 'attack', damage: 7 }] },
        { id: 'hide', actions: [{ kind: 'block', amount: 5 }] },
        { id: 'flurry', actions: [{ kind: 'attack', damage: 10 }] }
      ]
    });
    expect(enemies.thief).toEqual({
      id: 'thief',
      name: '도적',
      maxHp: 26,
      intents: [
        { id: 'ambush', actions: [{ kind: 'attack', damage: 6 }] },
        {
          id: 'weak-point',
          actions: [
            { kind: 'attack', damage: 6 },
            { kind: 'applyStatus', status: 'shock', stacks: 1 }
          ]
        },
        { id: 'evade', actions: [{ kind: 'block', amount: 7 }] }
      ]
    });
    expect(enemies.ghoul).toEqual({
      id: 'ghoul',
      name: '구울',
      maxHp: 38,
      // P5.6 몬스터 패시브 수직 슬라이스 — balance-provisional (포식 회복과 의도적 공존)
      passive: {
        id: 'rotting-flesh',
        name: '썩은 육체',
        description: '자신의 턴이 시작될 때 HP를 1 회복한다',
        hook: 'enemyTurnStart',
        effects: [{ kind: 'heal', amount: 1 }]
      },
      intents: [
        { id: 'rotting-touch', actions: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1 }] },
        { id: 'bite', actions: [{ kind: 'attack', damage: 8 }] },
        {
          id: 'devour',
          actions: [
            { kind: 'attack', damage: 7 },
            { kind: 'heal', amount: 5 }
          ]
        }
      ]
    });
    expect(enemies.mage).toEqual({
      id: 'mage',
      name: '마도사',
      maxHp: 22,
      intents: [
        { id: 'mana-focus', actions: [{ kind: 'buffNextAttack', amount: 5 }] },
        {
          id: 'firebolt',
          actions: [
            { kind: 'attack', damage: 11 },
            { kind: 'applyStatus', status: 'burn', stacks: 1 }
          ]
        },
        { id: 'barrier', actions: [{ kind: 'block', amount: 8 }] }
      ]
    });
    expect(enemies.slime).toEqual({
      id: 'slime',
      name: '슬라임',
      maxHp: 16,
      intents: [
        { id: 'cling', actions: [{ kind: 'block', amount: 4 }] },
        {
          id: 'acidic-slime',
          actions: [
            { kind: 'attack', damage: 5 },
            { kind: 'nextDrawPenalty', amount: 1 }
          ]
        },
        { id: 'bounce', actions: [{ kind: 'attack', damage: 8 }] }
      ]
    });
    expect(enemies['ember-archmage']).toEqual({
      id: 'ember-archmage',
      name: '잿불 마도왕',
      maxHp: 150,
      intents: [
        { id: 'arcane-amplification', actions: [{ kind: 'buffNextAttack', amount: 8 }] },
        { id: 'doom-fireball', actions: [{ kind: 'attack', damage: 20 }] },
        {
          id: 'ember-barrier',
          actions: [
            { kind: 'block', amount: 12 },
            { kind: 'nextDrawPenalty', amount: 1 }
          ]
        }
      ]
    });
    expect(contentDb.validate()).toEqual([]);
  });

  it('keeps the D2 encounter band arithmetic visible', () => {
    expect(enemies.goblin.maxHp + enemies.ghoul.maxHp).toBe(70);
    expect(enemies.thief.maxHp + enemies.goblin.maxHp).toBe(58);
    expect(enemies.ghoul.maxHp + enemies.goblin.maxHp + enemies.slime.maxHp).toBe(86);
  });
});

describe('P4.4 provisional event content goldens', () => {
  it('ships the four D10 event definitions', () => {
    expect(Object.keys(events).sort()).toEqual([
      'ambush-bounty',
      'blood-offering',
      'coin-sacrifice',
      'transmute-altar'
    ]);
    expect(events['ambush-bounty']).toMatchObject({
      risk: 'combat',
      elitePool: [['raider-plus'], ['gatekeeper-plus']],
      goldReward: 70,
      rareSkillOptions: 2
    });
    expect(events['blood-offering']).toMatchObject({
      risk: 'hp',
      hpCost: 5,
      requireCurrentHpAbove: 5
    });
    expect(events['transmute-altar']).toMatchObject({ risk: 'gold', goldCost: 100 });
    expect(events['coin-sacrifice']).toMatchObject({
      risk: 'coin',
      sacrifice: { coin: 'basic', reward: 'signatureCoin', minimumBagSize: 1 }
    });
  });
});

describe('P3.4 exclusive reward reachability (dead-option gate)', () => {
  // 감사 결함 봉인: 시작 장착 전용 스킬만 있으면 보상 도달이 구조적으로 불가능해
  // 지배/사장 감사가 공회전한다 — 캐릭터마다 비시작 전용 보상 스킬 ≥1을 보장
  it.each([
    ['sorcerer', 'overload'],
    ['frost-knight', 'winters-grasp'],
    ['guardian', 'aegis-surge']
  ])('offers %s at least one non-starting exclusive skill (%s)', (character, expected) => {
    const def = contentDb.characters[character];
    if (def === undefined) throw new Error('missing character');
    const eligible = rewardEligibleSkillIds(
      contentDb.skills,
      def.id,
      def.startingSkills
    ).map(String);
    expect(eligible).toContain(expected);
  });
});

describe('P3.4 reward-skill definitions and resolution goldens', () => {
  it('pins the three reachable exclusive skills (definition + exclusiveTo)', () => {
    expect(skills.overload).toMatchObject({
      name: '과부하',
      exclusiveTo: 'sorcerer',
      type: 'flip',
      cost: 2,
      base: [
        { kind: 'damage', amount: 6 },
        { kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }
      ],
      heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
    });
    expect(skills['winters-grasp']).toMatchObject({
      name: '동장군',
      exclusiveTo: 'frost-knight',
      cost: 1,
      base: [
        { kind: 'damage', amount: 4 },
        { kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }
      ]
    });
    expect(skills['aegis-surge']).toMatchObject({
      name: '수호 파동',
      exclusiveTo: 'guardian',
      type: 'consume',
      consume: { element: 'mana', count: 2 },
      effects: [{ kind: 'block', amount: 10 }]
    });
  });

  // 감전의 해결 내 증폭: base [피해 6 → 감전 1] 뒤 heads 피해 4는 floor(4×1.5)=6으로
  // 들어와 총 12 — 원자 순차 적용의 일관 귀결이며 술사 '연계 폭딜' 정체성에 부합 (의도 골든)
  it('resolves overload heads for 12 damage (shock amplifies the same resolution) and shock 1', () => {
    let state = withEquippedSkill(combat('p34-overload'), 'overload');
    state = withHandDefs(state, ['basic', 'basic']);
    const coins = state.zones.hand.slice(0, 2);
    const result = useFlip(withFaces(state, ['heads', 'heads']), coins, 0);

    expect(
      result.events
        .filter((event) => event.type === 'damageDealt' && event.target.type === 'enemy')
        .reduce((sum, event) => sum + (event.type === 'damageDealt' ? event.amount : 0), 0)
    ).toBe(12);
    expect(statusTurns(result.state.enemies[0]?.statuses ?? {}, 'shock')).toBe(1);
  });

  it('resolves aegis-surge by consuming two mana for 10 block without flipping', () => {
    let state = withEquippedSkill(combat('p34-aegis'), 'aegis-surge');
    state = withHandDefs(state, ['mana', 'mana', 'basic']);
    const fuel = state.zones.hand.slice(0, 2);
    const result = useConsumeAt(state, 0, fuel);

    expect(result.state.player.block).toBe(10);
    expect(result.events.some((event) => event.type === 'coinFlipped')).toBe(false);
    expect(result.state.zones.exhausted).toHaveLength(2);
  });
});

describe('P3.4 hostile coin proc rerouting regressions', () => {
  // 감시자 결함 회귀: self 스킬(guard)에 냉기/전기 코인 앞면 — 상태는 적에게, 플레이어 0
  const procCase = (defId: string) => {
    let state = withEquippedSkill(combat(`proc-${defId}`), 'guard');
    state = withHandDefs(state, [defId]);
    const coinUid = state.zones.hand[0];
    if (coinUid === undefined) throw new Error('missing coin');
    const result = useFlip(withFaces(state, ['heads']), [coinUid], 0);
    return result;
  };

  it('sends a frost coin proc on guard to the enemy, not the player', () => {
    const result = procCase('frost');
    expect(statusTurns(result.state.enemies[0]?.statuses ?? {}, 'frostbite')).toBe(1);
    expect(statusTurns(result.state.player.statuses, 'frostbite')).toBe(0);
  });

  it('sends a lightning coin proc on guard to the enemy, not the player', () => {
    const result = procCase('lightning');
    expect(statusTurns(result.state.enemies[0]?.statuses ?? {}, 'shock')).toBe(1);
    expect(statusTurns(result.state.player.statuses, 'shock')).toBe(0);
  });
});

describe('M5 shipped content', () => {
  it('ships the M5 version, mana coin, skills, and fixed enemy definitions', () => {
    expect(CONTENT_VERSION).toBe('1.3.0-p9');
    // P7 D4 — mana 앞면 2→1 하향 + 뒷면 2 신설 (v1.3 표 우선)
    expect(coins.mana).toEqual({
      id: coinId('mana'),
      element: 'mana',
      procs: {
        heads: [{ kind: 'block', amount: 1 }],
        tails: [{ kind: 'block', amount: 2 }]
      }
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
    expect(skills['flame-sword']).toMatchObject({
      // P6 D5: 표시명만 격투 문구로 전환 (화염검 → 화염 붕대, ID·수치 불변)
      name: '화염 붕대',
      type: 'consume',
      rarity: 'advanced',
      tags: ['utility'],
      targetType: 'self',
      consume: { element: 'fire', count: 1 },
      effects: [
        {
          kind: 'addTurnTrigger',
          trigger: {
            id: 'flame-sword',
            hook: 'onDamageDealt',
            effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }]
          }
        },
        // P7 D3 — 지원 스킬 즉시 리턴 표준: draw 1 라이더
        { kind: 'draw', count: 1 }
      ]
    });
    expect(skills['heart-of-flame']).toMatchObject({
      name: '불의 심장',
      type: 'consume',
      rarity: 'rare',
      tags: ['utility'],
      targetType: 'self',
      consume: { element: 'fire', count: 3 },
      effects: [
        {
          kind: 'addTurnTrigger',
          trigger: {
            id: 'heart-of-flame',
            hook: 'onAttackSkillResolved',
            effects: [{ kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }]
          }
        },
        // P7 D3 — 지원 스킬 즉시 리턴 표준: draw 1 라이더
        { kind: 'draw', count: 1 }
      ]
    });
    expect(skills.conflagration).toMatchObject({
      name: '대화재',
      type: 'flip',
      rarity: 'rare',
      tags: ['attack', 'ultimate'],
      targetType: 'single-enemy',
      oncePerCombat: true,
      cost: 5,
      base: [
        { kind: 'damage', amount: 18 },
        { kind: 'applyStatus', status: 'burn', stacks: 4, to: 'target' },
        // P7 D3 — 4+비용 표준: 다음 턴 이득 라이더
        { kind: 'nextTurnDraw', count: 1 }
      ],
      heads: { mode: 'per', effects: [{ kind: 'damage', amount: 4 }] }
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
      // P7 D2 — 시작 4스킬 (shield-reprisal/mana-well은 보상·상점 풀 존속)
      startingSkills: [
        skillId('slash'),
        skillId('guard'),
        skillId('warding-strike'),
        skillId('mana-bulwark')
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

  // P7 D4 — mana 양면: 앞 방어 1 / 뒤 방어 2, 스킬 대상과 무관하게 항상 플레이어
  it('mana procs grant player block on both faces in attack, defense, and self-target contexts', () => {
    const cases = [
      // guard 기본 방어 4 (P7 기본기 하향) + 앞 proc 1 = 5, 뒤는 +3 면 보너스 포함 4+3+2 = 9
      { skill: 'slash', face: 'heads', procBlock: 1, expectedBlock: 1, target: 0 },
      { skill: 'guard', face: 'heads', procBlock: 1, expectedBlock: 5, target: undefined },
      { skill: 'flame-rampage', face: 'heads', procBlock: 1, expectedBlock: 1, target: undefined },
      { skill: 'slash', face: 'tails', procBlock: 2, expectedBlock: 2, target: 0 },
      { skill: 'guard', face: 'tails', procBlock: 2, expectedBlock: 9, target: undefined }
    ] as const;

    for (const testCase of cases) {
      let state = withFaces(combat(`mana-${testCase.skill}-${testCase.face}`), [testCase.face]);
      state = withEquippedSkill(state, testCase.skill);
      state = withHandDefs(state, ['mana']);
      const cost = state.zones.hand[0];
      if (cost === undefined) throw new Error('missing mana coin');
      const result = useFlip(state, [cost], testCase.target);

      expect(result.state.player.block).toBe(testCase.expectedBlock);
      expect(
        result.events.filter((event) => event.type === 'blockGained' && event.amount === testCase.procBlock)
      ).toHaveLength(1);
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

  it('Flame Sword adds one burn for each later damage packet this turn', () => {
    let state = withFaces(combat('flame-sword-trigger'), ['tails', 'tails']);
    state = withEquippedSkills(state, ['flame-sword', 'slash', 'slash']);
    state = withHandDefs(state, ['fire', 'basic', 'basic']);
    const [fuel] = state.zones.hand;
    if (fuel === undefined) throw new Error('missing flame sword fuel');

    const setup = useConsumeAt(state, 0, [fuel]);
    const firstCost = setup.state.zones.hand[0];
    if (firstCost === undefined) throw new Error('missing first attack cost');
    const first = useFlipAt(setup.state, 1, [firstCost], 0);
    expect(statusStacks(first.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(1);

    const secondCost = first.state.zones.hand[0];
    if (secondCost === undefined) throw new Error('missing second attack cost');
    const second = useFlipAt(first.state, 2, [secondCost], 0);
    expect(second.events).toContainEqual({ type: 'turnTriggerFired', trigger: 'flame-sword', hook: 'onDamageDealt' });
    expect(statusStacks(second.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(2);
  });

  it('Heart of Flame adds two burn after each later attack skill this turn', () => {
    let state = withFaces(combat('heart-of-flame-trigger'), ['tails', 'tails']);
    state = withEquippedSkills(state, ['heart-of-flame', 'slash', 'slash']);
    state = withHandDefs(state, ['fire', 'fire', 'fire', 'basic', 'basic']);
    const fuel = state.zones.hand.slice(0, 3);
    expect(fuel).toHaveLength(3);

    const setup = useConsumeAt(state, 0, fuel);
    const firstCost = setup.state.zones.hand[0];
    if (firstCost === undefined) throw new Error('missing first attack cost');
    const first = useFlipAt(setup.state, 1, [firstCost], 0);
    expect(first.events).toContainEqual({ type: 'turnTriggerFired', trigger: 'heart-of-flame', hook: 'onAttackSkillResolved' });
    expect(statusStacks(first.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(2);

    const secondCost = first.state.zones.hand[0];
    if (secondCost === undefined) throw new Error('missing second attack cost');
    const second = useFlipAt(first.state, 2, [secondCost], 0);
    expect(statusStacks(second.state.enemies[0]?.statuses ?? {}, 'burn')).toBe(4);
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

describe('P6 shipped content goldens (1.1.0-p6)', () => {
  it('renames warrior to 화염 격투가 with the new fist starting kit (id 불변)', () => {
    // D5: id 'warrior' 유지 + 표시명 전환, 시작 기본기 3종은 신규 격투 전용 ID
    const warrior = characters.warrior;
    expect(String(warrior.id)).toBe('warrior');
    expect(warrior.name).toBe('화염 격투가');
    // P7 D2 — 시작 4스킬: 반복 기본기 2 + 버닝 스트라이크 + 과열 인에이블러
    expect(warrior.startingSkills.map(String)).toEqual(['jab', 'fist-guard', 'burning-fist', 'flame-hook']);
    // 기존 검술 기본기는 공용 defs로 존치 (타 캐릭터 시작 셋·구 세이브 참조 유효)
    for (const legacy of ['slash', 'guard', 'burning-strike']) {
      expect(contentDb.skills[legacy]).toBeDefined();
      expect(contentDb.skills[legacy]?.exclusiveTo).toBeUndefined();
    }
    for (const fist of ['jab', 'fist-guard', 'burning-fist', 'flame-hook', 'inner-passion']) {
      expect(String(contentDb.skills[fist]?.exclusiveTo)).toBe('warrior');
    }
  });

  it('ships the arcanist as a separate character with the turn-start summon trait', () => {
    // D6: guardian 무변경 원칙 — 마도기사는 별도 신규 캐릭터
    const arcanist = characters.arcanist;
    expect(String(arcanist.id)).toBe('arcanist');
    expect(arcanist.name).toBe('마도기사');
    expect(arcanist.maxHp).toBe(65);
    expect(arcanist.trait.hook).toBe('turnStart');
    // P7 D2 — 시작 4스킬 (aegis-pulse/shield-summon은 보상·상점 풀 존속)
    expect(arcanist.startingSkills.map(String)).toEqual([
      'slash', 'guard', 'arcane-charge', 'arcane-command'
    ]);
    expect(characters.guardian.name).toBe('수호자');
  });

  it('ships the acquired-passive pool with one-line descriptions, prices, and character boundaries', () => {
    // D2: 획득 패시브는 innate trait과 구분되는 별도 사전 — 전부 exclusiveTo 경계 안
    expect(Object.values(passives).filter((entry) => String(entry.exclusiveTo) === 'sorcerer')).toHaveLength(8);
    for (const passive of Object.values(passives)) {
      expect(passive.description.length).toBeGreaterThan(0);
      expect(passive.price).toBeGreaterThan(0);
      expect(['combatStart', 'turnStart']).toContain(passive.hook);
      expect(['warrior', 'arcanist', 'sorcerer']).toContain(String(passive.exclusiveTo));
    }
  });

  it('ships the two summon equipment definitions (D6)', () => {
    expect(Object.keys(equipment).sort()).toEqual(['mana-shield', 'mana-sword']);
    expect(equipment['mana-sword']).toMatchObject({
      name: '마나 검',
      action: { kind: 'strike', damage: 3 }
    });
    expect(equipment['mana-shield']).toMatchObject({
      name: '마나 방패',
      action: { kind: 'ward', block: 2 }
    });
    expect(contentDb.validate()).toEqual([]);
  });
});

describe('P9 shipped content goldens (1.3.0-p9)', () => {
  it('ships the blood coin with heal heads and block tails (D4)', () => {
    expect(coins.blood).toEqual({
      id: coinId('blood'),
      element: 'blood',
      procs: {
        heads: [{ kind: 'heal', amount: 1 }],
        tails: [{ kind: 'block', amount: 1 }]
      }
    });
  });

  it('ships repeatable basics at 4 (+3) with cooldown 0 (D1/D2 — v1.3 하향)', () => {
    for (const [attack, defense] of [
      ['slash', 'guard'],
      ['jab', 'fist-guard']
    ] as const) {
      expect(contentDb.skills[attack]).toMatchObject({
        cooldown: 0,
        cost: 1,
        base: [{ kind: 'damage', amount: 4 }],
        heads: { mode: 'any', effects: [{ kind: 'damage', amount: 3 }] }
      });
      expect(contentDb.skills[defense]).toMatchObject({
        cooldown: 0,
        cost: 1,
        base: [{ kind: 'block', amount: 4 }],
        tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
      });
    }
  });

  it('pins the warrior overheat kit and the new draw/cooldown utilities (D3/D5)', () => {
    expect(skills['inner-passion']).toMatchObject({
      type: 'consume',
      cooldown: 3,
      consume: { element: 'fire', count: 1 },
      effects: [{ kind: 'enterOverheat' }, { kind: 'draw', count: 1 }]
    });
    expect(skills['fire-fist']).toMatchObject({
      cost: 2,
      cooldown: 1,
      base: [
        { kind: 'addCoin', coin: coinId('fire'), zone: 'draw', count: 1 },
        { kind: 'damage', amount: 10 }
      ],
      heads: { mode: 'per', effects: [{ kind: 'damage', amount: 1 }] },
      // '화염 앞면 +2'는 일반 앞면 +1과 합산되는 추가 +1로 구현 (모호성 결정 11)
      elementFaces: [{ element: 'fire', face: 'heads', effects: [{ kind: 'damage', amount: 1 }] }],
      overheatBonus: [{ kind: 'damage', amount: 4 }]
    });
    // 재설계된 과열 스킬은 damagePerFireInHand 없이 overheatBonus 분기만 갖는다
    expect(skills['overheat-strike']).toMatchObject({
      cooldown: 1,
      overheatBonus: [{ kind: 'damage', amount: 4 }]
    });
    expect(skills['overheat-vent']).toMatchObject({
      oncePerCombat: true,
      overheatBonus: [{ kind: 'damage', amount: 10 }]
    });
    // 4+비용 대표 2종 (D3 표준: 강한 기본치 + 즉시/다음 턴 리턴)
    expect(skills['comet-blow']).toMatchObject({ cost: 4, cooldown: 2 });
    expect(skills['arsenal-barrage']).toMatchObject({ cost: 4, cooldown: 2 });
    // 공용 유틸리티
    expect(skills['battle-focus']).toMatchObject({
      cooldown: 2,
      base: [{ kind: 'draw', count: 2 }]
    });
    expect(skills.regroup).toMatchObject({
      cooldown: 3,
      base: [
        { kind: 'reduceCooldown', amount: 1 },
        { kind: 'draw', count: 1 }
      ]
    });
    expect(contentDb.validate()).toEqual([]);
  });
});
