import type { CharacterId, CoinDefId, EnemyDefId, SkillId } from '@game/core';
import { validateContentDb } from '@game/core';
import type { CharacterDef, CoinDef, ContentDb, EnemyDef, SkillDef } from '@game/core';

// P3.2 승격: 수호자·마나 스킬·exclusiveTo 시대. m5 콘텐츠는 현 버전의 부분집합이고
// 기존 수치가 불변이므로 m5 저장은 안전하게 로드(마이그레이션)할 수 있다.
export const CONTENT_VERSION = '0.7.0-p3.3';
export const LEGACY_CONTENT_VERSIONS: readonly string[] = ['0.6.0-p3.2', '0.5.0-m5'];
// p3.2→p3.3 호환 근거: 스킬 3종 가산뿐(수치 불변)이라 기존 저장의 모든 참조가 유효하다.
// rewards 저장의 유일한 위험 형상(공용 풀 소진 fallback)은 p3.2 실콘텐츠에서 도달 불가
// (전사 공용 9종 − 장착 6 = 미보유 ≥3 ≥ 2) — 공허 엣지, run-storage 테스트로 고정.

const coin = (value: string) => value as CoinDefId;
const skill = (value: string) => value as SkillId;
const character = (value: string) => value as CharacterId;
const enemy = (value: string) => value as EnemyDefId;

export const coins = {
  basic: { id: coin('basic'), element: null },
  fire: {
    id: coin('fire'),
    element: 'fire',
    proc: { face: 'heads', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] }
  },
  mana: {
    id: coin('mana'),
    element: 'mana',
    proc: { face: 'heads', effects: [{ kind: 'block', amount: 2 }] }
  }
} satisfies Record<string, CoinDef>;

export const skills = {
  slash: {
    id: skill('slash'),
    name: '베기',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'damage', amount: 6 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
  },
  guard: {
    id: skill('guard'),
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
    id: skill('burning-strike'),
    name: '불타는 일격',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    base: [
      { kind: 'damage', amount: 8 },
      { kind: 'addCoin', coin: coin('fire'), zone: 'discard', count: 1 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] }
  },
  ignite: {
    id: skill('ignite'),
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
    id: skill('ignite-sword'),
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
    id: skill('flame-rampage'),
    name: '화염 폭주',
    type: 'flip',
    rarity: 'rare',
    tags: ['utility'],
    targetType: 'self',
    oncePerCombat: true,
    cost: 1,
    base: [{ kind: 'grantElement', element: 'fire', scope: 'allBasicInHand' }],
    heads: { mode: 'any', effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'hand', count: 1 }] },
    tails: { mode: 'any', effects: [{ kind: 'selfDamage', amount: 2 }] }
  },
  'flame-sword': {
    id: skill('flame-sword'),
    name: '화염검',
    type: 'consume',
    rarity: 'advanced',
    // 셋업 버프 스킬 — attack 태그면 onAttackSkillResolved가 self 대상으로 발동해
    // 셀프 화상 함정이 된다 (P3.3 감사 결정: utility + 구조 lint로 클래스 차단)
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
      }
    ]
  },
  'heart-of-flame': {
    id: skill('heart-of-flame'),
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
      }
    ]
  },
  conflagration: {
    id: skill('conflagration'),
    name: '대화재',
    type: 'flip',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'single-enemy',
    oncePerCombat: true,
    cost: 5,
    base: [
      { kind: 'damage', amount: 18 },
      { kind: 'applyStatus', status: 'burn', stacks: 4, to: 'target' }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 4 }] }
  },
  smash: {
    id: skill('smash'),
    name: '강타',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    base: [{ kind: 'damage', amount: 8 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 5 }] }
  },
  'fire-infusion': {
    id: skill('fire-infusion'),
    name: '화염 주입',
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack', 'utility'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'addCoin', coin: coin('fire'), zone: 'draw', count: 1 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 4 }] }
  },
  furnace: {
    id: skill('furnace'),
    name: '용광로',
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack', 'utility'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'grantElement', element: 'fire', scope: 'chooseBasicInHand' }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
  },
  'warding-strike': {
    id: skill('warding-strike'),
    exclusiveTo: character('guardian'),
    name: '수호 타격',
    type: 'flip',
    rarity: 'common',
    tags: ['attack', 'defense'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'damage', amount: 5 }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 4 }] }
  },
  'mana-bulwark': {
    id: skill('mana-bulwark'),
    exclusiveTo: character('guardian'),
    name: '마나 방벽',
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cost: 2,
    base: [{ kind: 'block', amount: 8 }],
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 3 }] }
  },
  'shield-reprisal': {
    id: skill('shield-reprisal'),
    exclusiveTo: character('guardian'),
    name: '방패 반격',
    type: 'flip',
    rarity: 'common',
    tags: ['attack', 'defense'],
    targetType: 'single-enemy',
    cost: 2,
    base: [
      { kind: 'block', amount: 6 },
      { kind: 'damage', amount: 4 }
    ],
    tails: { mode: 'per', effects: [{ kind: 'damage', amount: 4 }] }
  },
  'mana-well': {
    id: skill('mana-well'),
    exclusiveTo: character('guardian'),
    name: '마나 샘',
    type: 'flip',
    rarity: 'advanced',
    tags: ['defense', 'utility'],
    targetType: 'self',
    cost: 1,
    base: [{ kind: 'addCoin', coin: coin('mana'), zone: 'discard', count: 1 }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 4 }] }
  }
} satisfies Record<string, SkillDef>;


export const enemies = {
  raider: {
    id: enemy('raider'),
    name: '약탈자',
    maxHp: 75,
    intents: [
      { id: 'slam', actions: [{ kind: 'attack', damage: 11 }] },
      { id: 'double-strike', actions: [{ kind: 'attack', damage: 4, hits: 2 }] },
      { id: 'slam-2', actions: [{ kind: 'attack', damage: 11 }] }
    ]
  },
  gatekeeper: {
    id: enemy('gatekeeper'),
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
  shaman: {
    id: enemy('shaman'),
    name: '주술사',
    maxHp: 60,
    intents: [
      { id: 'wither', actions: [{ kind: 'nextDrawPenalty', amount: 1 }] },
      { id: 'hex-strike', actions: [{ kind: 'attack', damage: 9 }] }
    ]
  },
  'raider-plus': {
    id: enemy('raider-plus'),
    name: '강화 약탈자',
    maxHp: 84,
    intents: [
      { id: 'slam', actions: [{ kind: 'attack', damage: 12 }] },
      { id: 'double-strike', actions: [{ kind: 'attack', damage: 5, hits: 2 }] },
      { id: 'slam-2', actions: [{ kind: 'attack', damage: 12 }] }
    ]
  },
  'gatekeeper-plus': {
    id: enemy('gatekeeper-plus'),
    name: '강화 수문장',
    maxHp: 78,
    intents: [
      {
        id: 'guarded-strike',
        actions: [
          { kind: 'block', amount: 9 },
          { kind: 'attack', damage: 5 }
        ]
      },
      {
        id: 'guarded-strike-2',
        actions: [
          { kind: 'block', amount: 9 },
          { kind: 'attack', damage: 6 }
        ]
      },
      {
        id: 'fortified-strike',
        actions: [
          { kind: 'block', amount: 13 },
          { kind: 'attack', damage: 6 }
        ]
      }
    ]
  }
} satisfies Record<string, EnemyDef>;

export const characters = {
  warrior: {
    id: character('warrior'),
    name: '전사',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('fire'), coin('fire')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('burning-strike'),
      skill('ignite'),
      skill('ignite-sword'),
      skill('flame-rampage')
    ],
    trait: {
      id: 'ember-pouch',
      name: '불씨 주머니',
      hook: 'combatStart',
      effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'draw', count: 1 }]
    }
  },
  guardian: {
    id: character('guardian'),
    name: '수호자',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('mana'), coin('mana')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('warding-strike'),
      skill('mana-bulwark'),
      skill('shield-reprisal'),
      skill('mana-well')
    ],
    trait: {
      id: 'quiet-spring',
      name: '고요한 샘',
      hook: 'combatStart',
      effects: [{ kind: 'addCoin', coin: coin('mana'), zone: 'draw', count: 1 }]
    }
  }
} satisfies Record<string, CharacterDef>;

export const contentDb: ContentDb = {
  coins,
  skills,
  enemies,
  characters,
  validate: () => validateContentDb({ coins, skills, enemies, characters })
};
