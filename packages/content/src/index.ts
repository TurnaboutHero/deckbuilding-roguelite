import type { CharacterId, CoinDefId, EnemyDefId, SkillId } from '@game/core';
import { validateContentDb } from '@game/core';
import type { CharacterDef, CoinDef, ContentDb, EnemyDef, SkillDef } from '@game/core';

export const CONTENT_VERSION = '0.1.0-m1';

const coin = (value: string) => value as CoinDefId;
const skill = (value: string) => value as SkillId;
const character = (value: string) => value as CharacterId;
const enemy = (value: string) => value as EnemyDefId;

export const coins = {
  basic: { id: coin('basic'), element: null }
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
    // M1 intentionally starts with basic x10. M3 replaces this with basic x8 + fire x2.
    startingBag: Array.from({ length: 10 }, () => coin('basic')),
    startingSkills: [skill('slash'), skill('guard')],
    trait: {
      id: 'ember-pouch',
      name: '불씨 주머니',
      hook: 'combatStart',
      effects: []
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
