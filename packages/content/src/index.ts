import type { CharacterId, CoinDefId, EnemyDefId, SkillId } from '@game/core';
import { validateContentDb } from '@game/core';
import type { CharacterDef, CoinDef, ContentDb, EnemyDef, SkillDef } from '@game/core';

// P3.2 승격: 수호자·마나 스킬·exclusiveTo 시대. m5 콘텐츠는 현 버전의 부분집합이고
// 기존 수치가 불변이므로 m5 저장은 안전하게 로드(마이그레이션)할 수 있다.
export const CONTENT_VERSION = '0.9.0-p4';
export const LEGACY_CONTENT_VERSIONS: readonly string[] = ['0.8.0-p3.4', '0.7.0-p3.3', '0.6.0-p3.2', '0.5.0-m5'];
// p3.4→p4 호환 근거: 몬스터 6종 가산뿐(플레이어 콘텐츠·기존 수치 불변)이라 기존 저장의
// 모든 참조가 유효하다. 신규 적은 신규 조우(P4.2+ 그래프)에서만 등장한다.
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
  },
  // P3.4 — 냉기·전기 (PRD 코인 표 168~169행 그대로: 앞면 proc, 지속형 상태 1턴)
  frost: {
    id: coin('frost'),
    element: 'frost',
    proc: { face: 'heads', effects: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }] }
  },
  lightning: {
    id: coin('lightning'),
    element: 'lightning',
    proc: { face: 'heads', effects: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }] }
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
  ,
  // ---- P3.4 술사 전용 (감전·연계 폭딜) — 수치는 기준표 안 임시값, balance-provisional ----
  'spark-strike': {
    id: skill('spark-strike'),
    name: '뇌격',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'damage', amount: 5 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }] }
  },
  'chain-surge': {
    id: skill('chain-surge'),
    name: '연쇄 방전',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    base: [{ kind: 'damage', amount: 7 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] }
  },
  'static-field': {
    id: skill('static-field'),
    name: '정전기장',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }],
    heads: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
  },
  'volt-lash': {
    id: skill('volt-lash'),
    name: '뇌전 개방',
    exclusiveTo: character('sorcerer'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    consume: { element: 'lightning', count: 1 },
    effects: [
      { kind: 'damage', amount: 6 },
      { kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }
    ]
  },
  // ---- P3.4 냉기 기사 전용 (약화·지연·방어 운영) — balance-provisional ----
  'frost-slash': {
    id: skill('frost-slash'),
    name: '서리 베기',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'damage', amount: 5 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }] }
  },
  'glacial-wall': {
    id: skill('glacial-wall'),
    name: '빙벽',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cost: 2,
    base: [{ kind: 'block', amount: 9 }],
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 3 }] }
  },
  'chilling-field': {
    id: skill('chilling-field'),
    name: '한파',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
  },
  'glacier-strike': {
    id: skill('glacier-strike'),
    name: '빙결 일격',
    exclusiveTo: character('frost-knight'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    consume: { element: 'frost', count: 1 },
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }
    ]
  }
  ,
  // ---- P3.4 후속: 비시작 전용 보상 스킬 (도달성 게이트 — 각 캐릭터 보상 풀에 최소 1종) ----
  // 수치는 기준표 안 임시값, balance-provisional
  overload: {
    id: skill('overload'),
    name: '과부하',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    base: [
      { kind: 'damage', amount: 6 },
      { kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }
    ],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
  },
  'winters-grasp': {
    id: skill('winters-grasp'),
    name: '동장군',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    base: [
      { kind: 'damage', amount: 4 },
      { kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }
    ],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
  },
  'aegis-surge': {
    id: skill('aegis-surge'),
    name: '수호 파동',
    exclusiveTo: character('guardian'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['defense'],
    targetType: 'self',
    consume: { element: 'mana', count: 2 },
    effects: [{ kind: 'block', amount: 10 }]
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
  },
  // P4.2 선행 다중 적 콘텐츠 — D2 정본 수치 그대로, 전부 balance-provisional.
  // 조우 대역 산술(D2): goblin+ghoul=70, thief+goblin=58(감전 압박 예외), ghoul+goblin+slime=86.
  goblin: {
    id: enemy('goblin'),
    name: '고블린',
    maxHp: 32,
    intents: [
      { id: 'stab', actions: [{ kind: 'attack', damage: 7 }] },
      { id: 'hide', actions: [{ kind: 'block', amount: 5 }] },
      { id: 'flurry', actions: [{ kind: 'attack', damage: 10 }] }
    ]
  },
  thief: {
    id: enemy('thief'),
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
  },
  ghoul: {
    id: enemy('ghoul'),
    name: '구울',
    maxHp: 38,
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
  },
  mage: {
    id: enemy('mage'),
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
  },
  slime: {
    id: enemy('slime'),
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
  },
  'ember-archmage': {
    id: enemy('ember-archmage'),
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
  ,
  // P3.4 — 술사·냉기 기사 (PRD 캐릭터 표 263~264행, 수치는 기준표 규격 그대로)
  sorcerer: {
    id: character('sorcerer'),
    name: '술사',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('lightning'), coin('lightning')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('spark-strike'),
      skill('chain-surge'),
      skill('static-field'),
      skill('volt-lash')
    ],
    trait: {
      id: 'charged-focus',
      name: '대전된 집중',
      hook: 'combatStart',
      effects: [{ kind: 'addCoin', coin: coin('lightning'), zone: 'draw', count: 1 }]
    }
  },
  'frost-knight': {
    id: character('frost-knight'),
    name: '냉기 기사',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('frost'), coin('frost')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('frost-slash'),
      skill('glacial-wall'),
      skill('chilling-field'),
      skill('glacier-strike')
    ],
    trait: {
      id: 'winter-mantle',
      name: '겨울 외투',
      hook: 'combatStart',
      effects: [{ kind: 'addCoin', coin: coin('frost'), zone: 'draw', count: 1 }]
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
