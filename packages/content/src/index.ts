import type { CharacterId, CoinDefId, EnemyDefId, SkillId } from '@game/core';
import { validateContentDb } from '@game/core';
import type { CharacterDef, CoinDef, ContentDb, EnemyDef, SkillDef } from '@game/core';

export const CONTENT_VERSION = '0.3.0-m3';

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
  }
} satisfies Record<string, CharacterDef>;

export const contentDb: ContentDb = {
  coins,
  skills,
  enemies,
  characters,
  validate: () => validateContentDb({ coins, skills, enemies, characters })
};
