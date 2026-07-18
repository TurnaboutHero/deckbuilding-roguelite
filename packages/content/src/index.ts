import type {
  CharacterId,
  CoinDefId,
  CoinEnchantId,
  EnemyDefId,
  EquipmentDefId,
  EventDefId,
  PassiveId,
  SkillId
} from '@game/core';
import { validateContentDb } from '@game/core';
import type {
  CharacterDef,
  CoinDef,
  CoinEnchantDef,
  ContentDb,
  EnemyAction,
  EnemyDef,
  EnemyIntent,
  EquipmentDef,
  EventDef,
  PassiveDef,
  SkillDef
} from '@game/core';

declare const __VITE_PRODUCTION_BUILD__: boolean | undefined;

// Production UI ships verified static content; retain the synchronous validator for tests, dev, and direct tsx imports.
const shouldValidateContent = typeof __VITE_PRODUCTION_BUILD__ === 'undefined' || !__VITE_PRODUCTION_BUILD__;

// P3.2 승격: 수호자·마나 스킬·exclusiveTo 시대. m5 콘텐츠는 현 버전의 부분집합이고
// 기존 수치가 불변이므로 m5 저장은 안전하게 로드(마이그레이션)할 수 있다.
export const CONTENT_VERSION = '1.7.0-revision';
export const LEGACY_CONTENT_VERSIONS: readonly string[] = [
  '1.6.0-blood',
  '1.5.0-p11',
  '1.4.0-p10',
  '1.3.0-p9',
  '1.2.0-p7',
  '1.1.0-p6',
  '1.0.0-rc.1',
  '0.10.0-p4.4',
  '0.9.0-p4',
  '0.8.0-p3.4',
  '0.7.0-p3.3',
  '0.6.0-p3.2',
  '0.5.0-m5'
];
// p4→p4.4 호환 근거: 이벤트 4종 가산·기존 플레이어/전투 콘텐츠 수치 불변.
// p3.4→p4 호환 근거: 몬스터 6종 가산뿐(플레이어 콘텐츠·기존 수치 불변)이라 기존 저장의
// 모든 참조가 유효하다. 신규 적은 신규 조우(P4.2+ 그래프)에서만 등장한다.
// p3.2→p3.3 호환 근거: 스킬 3종 가산뿐(수치 불변)이라 기존 저장의 모든 참조가 유효하다.
// rewards 저장의 유일한 위험 형상(공용 풀 소진 fallback)은 p3.2 실콘텐츠에서 도달 불가
// (전사 공용 9종 − 장착 6 = 미보유 ≥3 ≥ 2) — 공허 엣지, run-storage 테스트로 고정.

const coin = (value: string) => value as CoinDefId;
const enchant = (value: string) => value as CoinEnchantId;
const skill = (value: string) => value as SkillId;
const character = (value: string) => value as CharacterId;
const enemy = (value: string) => value as EnemyDefId;
const event = (value: string) => value as EventDefId;
const passive = (value: string) => value as PassiveId;
const equip = (value: string) => value as EquipmentDefId;

// P7 D4 — 양면 속성 코인 (v1.3 표 그대로): 공격형 proc 대상은 단일 스킬→그 적,
// 전체 스킬→모든 생존 적, 자기 대상 스킬→선택한 적. 우호형(방어·회복)은 항상 플레이어.
export const coins = {
  basic: { id: coin('basic'), element: null },
  counterfeit: { id: coin('counterfeit'), element: null, counterfeit: true },
  fire: {
    id: coin('fire'),
    element: 'fire',
    procs: {
      heads: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }],
      tails: [{ kind: 'damage', amount: 1 }]
    }
  },
  mana: {
    id: coin('mana'),
    element: 'mana',
    procs: {
      heads: [{ kind: 'block', amount: 1 }],
      tails: [{ kind: 'block', amount: 2 }]
    }
  },
  frost: {
    id: coin('frost'),
    element: 'frost',
    procs: {
      heads: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }],
      tails: [{ kind: 'block', amount: 1 }]
    }
  },
  lightning: {
    id: coin('lightning'),
    element: 'lightning',
    procs: {
      heads: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }],
      tails: [{ kind: 'damage', amount: 1 }]
    }
  },
  // P7 D4 — 피 코인: 비시그니처 단독 드래프트 가치(회복/방어 유지 픽)
  blood: {
    id: coin('blood'),
    element: 'blood',
    procs: {
      heads: [{ kind: 'coinDamage', amount: 1 }],
      tails: [
        { kind: 'loseHp', amount: 1 },
        { kind: 'coinDamage', amount: 2 }
      ]
    }
  }
} satisfies Record<string, CoinDef>;

export const enchants = {
  sharpness: {
    id: enchant('sharpness'),
    name: '예리함',
    description: '공격 스킬에서 이 코인이 성공하면 피해 +1.',
    mechanic: 'sharpness'
  },
  'heads-polish': {
    id: enchant('heads-polish'),
    name: '양각 연마',
    description: '이 코인의 앞면 확률이 60%가 된다.',
    mechanic: 'heads-polish'
  },
  'tails-polish': {
    id: enchant('tails-polish'),
    name: '음각 연마',
    description: '이 코인의 뒷면 확률이 60%가 된다.',
    mechanic: 'tails-polish'
  },
  echo: {
    id: enchant('echo'),
    name: '메아리',
    description: '매 전투에서 이 코인을 처음 사용한 후 손패로 되돌아온다.',
    mechanic: 'echo'
  },
  pendulum: {
    id: enchant('pendulum'),
    name: '시계추',
    description: '매 전투에서 처음 사용할 때 현재 스킬의 성공면으로 확정 판정한다.',
    mechanic: 'pendulum'
  }
} satisfies Record<string, CoinEnchantDef>;

export const skills = {
  slash: {
    id: skill('slash'),
    name: '공격',
    upgrade: {
      name: '단련된 공격',
      description: '성공 피해 4 → 5',
      patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
    },
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    // P7 D2 — 반복 기본기 (쿨다운 0): 코인이 남는 한 같은 턴 반복 사용
    cooldown: 0,
    cost: 1,
    successFace: 'heads',
    successLadder: [[], [{ kind: 'damage', amount: 4 }]]
  },
  guard: {
    id: skill('guard'),
    name: '방어',
    upgrade: {
      name: '견고한 방어',
      description: '성공 방어 4 → 5',
      patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
    },
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cooldown: 0,
    cost: 1,
    successFace: 'tails',
    successLadder: [[], [{ kind: 'block', amount: 4 }]]
  },
  'burning-strike': {
    id: skill('burning-strike'),
    name: '불타는 일격',
    exclusiveTo: character('warrior'),
    upgrade: {
      name: '여열',
      description: '사용 시 임시 화염 코인 1개를 추가로 만든다',
      patch: { kind: 'addCoinOnUse', coin: coin('fire'), zone: 'discard', count: 1 }
    },
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
    exclusiveTo: character('warrior'),
    upgrade: { name: '들불', description: '뒷면 피해 +3 효과 추가', patch: { kind: 'addFaceEffect', face: 'tails', effect: { kind: 'damage', amount: 3 } } },
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
    name: '점화권',
    exclusiveTo: character('warrior'),
    upgrade: { name: '작열권', description: '피해 +3', patch: { kind: 'baseAmount', index: 0, delta: 3 } },
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
    exclusiveTo: character('warrior'),
    upgrade: { name: '연쇄 폭주', description: '전투당 1회 제한 해제', patch: { kind: 'removeOncePerCombat' } },
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
    name: '화염 붕대',
    exclusiveTo: character('warrior'),
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
      },
      // P7 D3 — 지원 스킬 즉시 리턴 표준: draw 1 동반
      { kind: 'draw', count: 1 }
    ]
  },
  'heart-of-flame': {
    id: skill('heart-of-flame'),
    name: '불의 심장',
    exclusiveTo: character('warrior'),
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
      { kind: 'draw', count: 1 }
    ]
  },
  conflagration: {
    id: skill('conflagration'),
    name: '대화재',
    exclusiveTo: character('warrior'),
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
    exclusiveTo: character('warrior'),
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
    exclusiveTo: character('warrior'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack', 'utility'],
    targetType: 'single-enemy',
    cost: 1,
    base: [{ kind: 'grantElement', element: 'fire', scope: 'chooseBasicInHand' }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] }
  },
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
  // ── P11 냉기 도적: 보존 동전과 냉기 밀수 빌드 ──
  'ice-claw': {
    id: skill('ice-claw'),
    name: '얼음 발톱',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 2,
    base: [
      { kind: 'damage', amount: 8 },
      { kind: 'applyStatus', status: 'frostbite', stacks: 2, to: 'target' }
    ],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    upgrade: {
      name: '빙점 발톱',
      description: '코스트 1, 앞면 피해 +5',
      patch: {
        kind: 'multi',
        patches: [
          { kind: 'costDelta', delta: -1 },
          { kind: 'replaceEffect', section: 'heads', index: 0, effect: { kind: 'damage', amount: 5 } }
        ]
      }
    }
  },
  'ice-sleight': {
    id: skill('ice-sleight'),
    name: '얼음 밑장빼기',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 2,
    cost: 2,
    base: [{ kind: 'nextTurnDraw', count: 1 }],
    heads: { mode: 'any', effects: [{ kind: 'addCoin', coin: coin('frost'), zone: 'draw', count: 1 }] },
    upgrade: {
      name: '깊은 밑장',
      description: '다음 턴 뽑기 +2',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'nextTurnDraw', count: 2 } }
    }
  },
  'frost-mark': {
    id: skill('frost-mark'),
    name: '서리 표식',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack', 'utility'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    base: [
      { kind: 'damage', amount: 3 },
      { kind: 'drawSpecific', coins: [coin('basic'), coin('frost')], count: 1 }
    ],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: {
      name: '남겨진 표식',
      description: '앞면이면 버림 더미에 임시 냉기 동전 1개',
      patch: { kind: 'addFaceEffect', face: 'heads', effect: { kind: 'addCoin', coin: coin('frost'), zone: 'discard', count: 1 } }
    }
  },
  'frost-fur-cloak': {
    id: skill('frost-fur-cloak'),
    name: '서리털 망토',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    base: [{ kind: 'block', amount: 5 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '두꺼운 서리털', description: '기본 방어 7', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'freezing-incision': {
    id: skill('freezing-incision'),
    name: '빙점 절개',
    exclusiveTo: character('frost-knight'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 2,
    consume: { element: 'frost', count: 3, mode: 'upTo' },
    effects: [{ kind: 'damageByConsumed', base: 5, perCoin: 5 }],
    upgrade: {
      name: '예리한 빙점',
      description: '냉기 동전당 피해 6',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'damageByConsumed', base: 5, perCoin: 6 } }
    }
  },
  'emergency-ice-pouch': {
    id: skill('emergency-ice-pouch'),
    name: '비상용 얼음주머니',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    oncePerCombat: true,
    cooldown: 3,
    cost: 1,
    base: [
      { kind: 'addCoin', coin: coin('frost'), zone: 'hand', count: 2 },
      { kind: 'increasePreserveCapacity', count: 1 }
    ],
    upgrade: { name: '재사용 주머니', description: '일회성 제거, 코스트 2, 쿨타임 3', patch: { kind: 'removeOncePerCombat', cooldown: 3, costDelta: 1 } }
  },
  'freeze-dry': {
    id: skill('freeze-dry'),
    name: '동결 건조',
    exclusiveTo: character('frost-knight'),
    type: 'consume',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'single-enemy',
    cooldown: 3,
    consume: { element: 'frost', count: 3, mode: 'all' },
    effects: [{ kind: 'damageByConsumed', base: 0, perCoin: 8, frostbittenBonusPerCoin: 2 }],
    upgrade: { name: '급속 건조', description: '최소 소비 3 → 2', patch: { kind: 'costDelta', delta: -1 } }
  },
  'preserved-pickpocket': {
    id: skill('preserved-pickpocket'),
    name: '보존품 소매치기',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    treatPreservedBasicAsElement: 'frost',
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    preservedBonus: [{ kind: 'drawSpecific', coins: [coin('basic'), coin('frost')], count: 1 }],
    upgrade: {
      name: '노련한 소매치기',
      description: '앞면 피해 +4',
      patch: { kind: 'replaceEffect', section: 'heads', index: 0, effect: { kind: 'damage', amount: 4 } }
    }
  },
  'hidden-inner-pocket': {
    id: skill('hidden-inner-pocket'),
    name: '숨은 안주머니',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'common',
    tags: ['defense', 'utility'],
    targetType: 'single-enemy',
    cooldown: 2,
    cost: 1,
    base: [
      { kind: 'block', amount: 3 },
      { kind: 'preserveChosenCoin', count: 1 }
    ],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '빈틈없는 안주머니', description: '코스트 0', patch: { kind: 'costDelta', delta: -1 } }
  },
  'trackless-raid': {
    id: skill('trackless-raid'),
    name: '발자국 없는 습격',
    exclusiveTo: character('frost-knight'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 2,
    base: [
      { kind: 'damage', amount: 6 },
      { kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }
    ],
    preservedBonus: [
      { kind: 'damage', amount: 4 },
      { kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }
    ],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 3 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] },
    upgrade: { name: '흔적 소거', description: '코스트 1', patch: { kind: 'costDelta', delta: -1 } }
  },
  'loot-swap': {
    id: skill('loot-swap'),
    name: '장물 바꿔치기',
    exclusiveTo: character('frost-knight'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['defense', 'utility'],
    targetType: 'self',
    cooldown: 2,
    consume: { element: 'frost', count: 1 },
    effects: [
      { kind: 'block', amount: 5 },
      { kind: 'drawSpecific', coins: [coin('basic'), coin('frost')], count: 1, preserve: true }
    ],
    preservedBonus: [{ kind: 'block', amount: 3 }],
    upgrade: { name: '값비싼 교환', description: '기본 방어 8', patch: { kind: 'baseAmount', index: 0, delta: 3 } }
  },
  'subzero-perfect-crime': {
    id: skill('subzero-perfect-crime'),
    name: '영하의 완전범죄',
    exclusiveTo: character('frost-knight'),
    type: 'consume',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'single-enemy',
    cooldown: 3,
    consume: { element: 'frost', count: 1 },
    effects: [{ kind: 'damageByTargetFrostbite', base: 6, multiplier: 3, cap: 24 }],
    preservedBonus: [{ kind: 'drawSpecific', coins: [coin('basic'), coin('frost')], count: 1, preserve: true }],
    upgrade: {
      name: '완벽한 알리바이',
      description: '동상 배수 4, 상한 30',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'damageByTargetFrostbite', base: 6, multiplier: 4, cap: 30 } }
    }
  },
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
  // ── P9 번개 결투사: 르미즈 5종 + 감전 처형 5종 ──
  attaque: {
    id: skill('attaque'),
    name: '아따끄',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    base: [{ kind: 'damage', amount: 6 }]
  },
  parade: {
    id: skill('parade'),
    name: '빠라드',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['defense', 'utility'],
    targetType: 'self',
    cooldown: 2,
    cost: 2,
    base: [{ kind: 'block', amount: 6 }],
    heads: { mode: 'per', effects: [{ kind: 'draw', count: 1 }] },
    tails: { mode: 'per', effects: [{ kind: 'addCoin', coin: coin('lightning'), zone: 'draw', count: 1 }] }
  },
  fente: {
    id: skill('fente'),
    name: '팡트',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    base: [{ kind: 'damage', amount: 6 }],
    remise: { onRepeatFinish: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }] },
    upgrade: {
      name: '강화',
      description: '반복 종료 감전 1 → 2',
      patch: { kind: 'replaceEffect', section: 'onRepeatFinish', index: 0, effect: { kind: 'applyStatus', status: 'shock', stacks: 2, to: 'target' } }
    }
  },
  'parade-riposte': {
    id: skill('parade-riposte'),
    name: '파라드-리포스트',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack', 'defense'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    base: [{ kind: 'block', amount: 5 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] }
  },
  redoublement: {
    id: skill('redoublement'),
    name: '레두블망',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 3,
    cost: 2,
    base: [
      { kind: 'damage', amount: 5 },
      { kind: 'readyRemise', amount: 1 }
    ],
    upgrade: {
      name: '강화',
      description: '르미즈 스택 생성 1 → 2',
      patch: { kind: 'replaceEffect', section: 'base', index: 1, effect: { kind: 'readyRemise', amount: 2 } }
    }
  },
  fleche: {
    id: skill('fleche'),
    name: '플레슈',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 2,
    cost: 2,
    base: [
      { kind: 'damage', amount: 8 },
      { kind: 'damageIfReused', amount: 4 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'draw', count: 1 }] }
  },
  'attaque-composee': {
    id: skill('attaque-composee'),
    name: '아타크 콩포제',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'single-enemy',
    cooldown: 4,
    cost: 3,
    base: [
      { kind: 'damage', amount: 10 },
      { kind: 'readyRemise', amount: 1 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '강화', description: '사용 시 임시 번개 동전 1개를 손패에 추가한다', patch: { kind: 'addCoinOnUse', coin: coin('lightning'), zone: 'hand', count: 1 } }
  },
  'charge-mark': {
    id: skill('charge-mark'),
    name: '전하 각인',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    base: [{ kind: 'damage', amount: 3 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }] },
    tails: { mode: 'any', effects: [{ kind: 'damageIfTargetShocked', amount: 2 }] },
    upgrade: {
      name: '강화',
      description: '앞면 감전 1 → 2',
      patch: { kind: 'replaceEffect', section: 'heads', index: 0, effect: { kind: 'applyStatus', status: 'shock', stacks: 2, to: 'target' } }
    }
  },
  'capacitor-shield': {
    id: skill('capacitor-shield'),
    name: '축전 방패',
    exclusiveTo: character('sorcerer'),
    type: 'consume',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'single-enemy',
    cooldown: 2,
    consume: { element: 'lightning', count: 1 },
    effects: [{ kind: 'blockPerTargetShock', base: 7, cap: 5 }],
    upgrade: {
      name: '강화',
      description: '기본 방어 7 → 8, 감전 상한 5 → 8',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'blockPerTargetShock', base: 8, cap: 8 } }
    }
  },
  superconduct: {
    id: skill('superconduct'),
    name: '과전도',
    exclusiveTo: character('sorcerer'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'single-enemy',
    oncePerCombat: true,
    consume: { element: 'lightning', count: 2 },
    effects: [{ kind: 'doubleTargetShock' }],
    upgrade: { name: '강화', description: '일회성 제거, 쿨타임 4', patch: { kind: 'removeOncePerCombat', cooldown: 4 } }
  },
  'overload-flurry': {
    id: skill('overload-flurry'),
    name: '과부하 연격',
    exclusiveTo: character('sorcerer'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 2,
    cost: 2,
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'shock', stacks: 2, to: 'target' }] },
    tails: { mode: 'per', effects: [{ kind: 'damageIfTargetShocked', amount: 2 }] },
    upgrade: { name: '강화', description: '기본 피해 4 → 6', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'thunder-execution': {
    id: skill('thunder-execution'),
    name: '뇌정 처형',
    exclusiveTo: character('sorcerer'),
    type: 'consume',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'single-enemy',
    oncePerCombat: true,
    consume: { element: 'lightning', count: 3 },
    effects: [{ kind: 'executeOrDischargeShock' }],
    upgrade: { name: '강화', description: '번개 코인 소비 3개 → 2개', patch: { kind: 'costDelta', delta: -1 } }
  },
  // ── P6 D5 — 화염 격투가 스킬 (exclusiveTo warrior, balance-provisional) ──
  jab: {
    id: skill('jab'),
    name: '공격',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 0,
    cost: 1,
    exclusiveTo: character('warrior'),
    successFace: 'heads',
    successLadder: [[], [{ kind: 'damage', amount: 4 }]],
    upgrade: {
      name: '묵직한 공격',
      description: '성공 피해 4 → 5',
      patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
    }
  },
  'fist-guard': {
    id: skill('fist-guard'),
    name: '방어',
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cooldown: 0,
    cost: 1,
    exclusiveTo: character('warrior'),
    successFace: 'tails',
    successLadder: [[], [{ kind: 'block', amount: 4 }]],
    upgrade: {
      name: '철벽 방어',
      description: '성공 방어 4 → 5',
      patch: { kind: 'ladderAmount', tier: 1, index: 0, delta: 1 }
    }
  },
  'burning-fist': {
    id: skill('burning-fist'),
    name: '불꽃 스트레이트',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damage', amount: 8 },
      { kind: 'addCoin', coin: coin('fire'), zone: 'discard', count: 1 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] },
    upgrade: {
      name: '불꽃 원투',
      description: '사용 시 임시 화염 코인 1개 추가 생성',
      patch: { kind: 'addCoinOnUse', coin: coin('fire'), zone: 'discard', count: 1 }
    }
  },
  'flame-hook': {
    id: skill('flame-hook'),
    name: '불씨권',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 5 }],
    heads: {
      mode: 'any',
      effects: [
        { kind: 'damage', amount: 2 },
        { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
      ]
    },
    elementFaces: [
      { element: 'fire', face: 'heads', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] },
      { element: 'fire', face: 'tails', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] }
    ]
    // P10: 최신 통합안에서 강화 수치는 미정이다.
  },
  'ember-weave': {
    id: skill('ember-weave'),
    name: '잿불 갑주',
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'block', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'discard', count: 1 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: {
      name: '강화 갑주',
      description: '뒷면 방어 +2 → +3',
      patch: { kind: 'replaceEffect', section: 'tails', index: 0, effect: { kind: 'block', amount: 3 } }
    }
  },
  'second-wind': {
    id: skill('second-wind'),
    name: '들숨 고르기',
    type: 'flip',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    oncePerCombat: true,
    cost: 1,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'block', amount: 4 },
      { kind: 'addCoin', coin: coin('fire'), zone: 'draw', count: 3 }
    ],
    upgrade: { name: '긴 호흡', description: '전투당 1회 제한 해제', patch: { kind: 'removeOncePerCombat' } }
  },
  'warrior-flame-rampage': {
    id: skill('warrior-flame-rampage'),
    name: '화염 폭주',
    type: 'flip',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'all-enemies',
    oncePerCombat: true,
    cost: 2,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'addCoin', coin: coin('fire'), zone: 'hand', count: 2 },
      { kind: 'applyStatus', status: 'burn', stacks: 3, to: 'target' }
    ],
    upgrade: {
      name: '연쇄 폭주',
      description: '코스트 3, 전투당 1회 제거',
      patch: { kind: 'removeOncePerCombat', cooldown: 1, costDelta: 1 }
    }
  },
  'fire-flurry': {
    id: skill('fire-flurry'),
    name: '홍련 선풍각',
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'all-enemies',
    cost: 2,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 3 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] },
    elementFaces: [{ element: 'fire', face: 'heads', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }] }],
    upgrade: { name: '폭풍 연화각', description: '기본 피해 3 → 4', patch: { kind: 'baseAmount', index: 0, delta: 1 } }
  },
  'burnout-blow': {
    id: skill('burnout-blow'),
    name: '업화폭권',
    type: 'consume',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'single-enemy',
    oncePerCombat: true,
    exclusiveTo: character('warrior'),
    consume: { element: 'fire', count: 3 },
    effects: [
      { kind: 'damage', amount: 6 },
      { kind: 'damagePerTargetBurn', amountPerStack: 3 }
    ],
    upgrade: { name: '대폭렬권', description: '화염 코인 소비 3개 → 2개', patch: { kind: 'costDelta', delta: -1 } }
  },
  // 보조 아키타입: 진짜 과열 (P7 D5 — 화염 소비로 진입, 과열 강화 스킬 해결 후 소비)
  'inner-passion': {
    id: skill('inner-passion'),
    name: '내면의 열정',
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'single-enemy',
    cooldown: 3,
    cost: 1,
    exclusiveTo: character('warrior'),
    retiredFromRewards: true,
    requiredElement: 'fire',
    base: [{ kind: 'enterOverheat' }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 5 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
    // P10: 기존 임시 강화안은 폐기됐으며 대체 강화안은 미정이다.
  },
  'fire-fist': {
    id: skill('fire-fist'),
    name: '화염권',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    element: 'fire',
    exclusiveTo: character('warrior'),
    successFace: 'heads',
    successLadder: [
      [{ kind: 'damage', amount: 2 }],
      [
        { kind: 'damage', amount: 4 },
        { kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }
      ],
      [
        { kind: 'damage', amount: 7 },
        { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
      ]
    ],
    resonance: {
      element: 'fire',
      effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }]
    },
    upgrade: {
      name: '작열권',
      description: '앞면 2개 성공 시 피해 9, 화상 3',
      patch: {
        kind: 'multi',
        patches: [
          { kind: 'ladderAmount', tier: 2, index: 0, delta: 2 },
          { kind: 'ladderAmount', tier: 2, index: 1, field: 'stacks', delta: 1 }
        ]
      }
    }
  },
  'direct-hit': {
    id: skill('direct-hit'),
    name: '직격타',
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    element: 'fire',
    exclusiveTo: character('warrior'),
    successFace: 'heads',
    successLadder: [
      [{ kind: 'damage', amount: 1 }],
      [
        { kind: 'damage', amount: 4 },
        { kind: 'addCoin', coin: coin('fire'), zone: 'draw', position: 'top', count: 1 }
      ],
      [
        { kind: 'damage', amount: 6 },
        { kind: 'addCoin', coin: coin('fire'), zone: 'draw', position: 'top', count: 1 }
      ]
    ],
    upgrade: {
      name: '정타',
      description: '앞면 0개 성공 시 피해 1 → 2',
      patch: { kind: 'ladderAmount', tier: 0, index: 0, delta: 1 }
    }
  },
  'overheat-strike': {
    id: skill('overheat-strike'),
    name: '과열권',
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 1,
    exclusiveTo: character('warrior'),
    retiredFromRewards: true,
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    overheatBonus: [{ kind: 'damage', amount: 4 }],
    upgrade: { name: '초과열권', description: '기본 피해 +3', patch: { kind: 'baseAmount', index: 0, delta: 3 } }
  },
  'overheat-vent': {
    id: skill('overheat-vent'),
    name: '배기 폭발',
    type: 'flip',
    rarity: 'rare',
    tags: ['attack'],
    targetType: 'single-enemy',
    oncePerCombat: true,
    cost: 2,
    exclusiveTo: character('warrior'),
    retiredFromRewards: true,
    base: [
      { kind: 'damage', amount: 8 },
      { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
    ],
    overheatBonus: [{ kind: 'damage', amount: 10 }],
    upgrade: { name: '전개 배기', description: '전투당 1회 제한 해제', patch: { kind: 'removeOncePerCombat' } }
  },
  // P7 D3 — 4비용 대표: 강한 기본치 + 임시 코인/상태 라이더 (고비용 턴의 실구성 표적)
  'comet-blow': {
    id: skill('comet-blow'),
    name: '낙성권',
    type: 'flip',
    rarity: 'rare',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 2,
    cost: 4,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damage', amount: 16 },
      { kind: 'applyStatus', status: 'burn', stacks: 3, to: 'target' },
      { kind: 'addCoin', coin: coin('fire'), zone: 'hand', count: 1 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    upgrade: { name: '대낙성권', description: '기본 피해 +4', patch: { kind: 'baseAmount', index: 0, delta: 4 } }
  },
  // ── P6 D6 — 마도기사 스킬 (exclusiveTo arcanist, balance-provisional) ──
  'arcane-charge': {
    id: skill('arcane-charge'),
    name: '마력 충전',
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 0,
    cost: 1,
    exclusiveTo: character('arcanist'),
    base: [
      { kind: 'summonEquipment', equipment: 'chosen', duration: 2, durationPerTails: 1 },
      { kind: 'addCoin', coin: coin('mana'), zone: 'hand', count: 1 }
    ],
    upgrade: { name: '증폭 충전', description: '사용 시 임시 마나 코인 1개 추가', patch: { kind: 'addCoinOnUse', coin: coin('mana'), zone: 'hand', count: 1 } }
  },
  'arcane-command': {
    id: skill('arcane-command'),
    name: '명령',
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 0,
    cost: 2,
    exclusiveTo: character('arcanist'),
    base: [
      { kind: 'commandChosenSummon', bonusPerTails: 1 },
      { kind: 'addCoin', coin: coin('mana'), zone: 'discard', count: 1 }
    ],
    upgrade: { name: '이중 명령', description: '사용 시 임시 마나 코인 1개 추가', patch: { kind: 'addCoinOnUse', coin: coin('mana'), zone: 'hand', count: 1 } }
  },
  'aegis-pulse': {
    id: skill('aegis-pulse'),
    name: '완충 방벽',
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 2,
    exclusiveTo: character('arcanist'),
    base: [
      { kind: 'block', amount: 4 },
      { kind: 'damagePerBlock', amountPerBlock: 1 }
    ],
    bloodOffering: true,
    upgrade: { name: '공명 방벽', description: '기본 방어 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'armor-counter': {
    id: skill('armor-counter'),
    name: '마력 반격',
    exclusiveTo: character('arcanist'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack', 'defense'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 2,
    base: [{ kind: 'damage', amount: 8 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: {
      name: '강화',
      description: '뒷면 방어 +2 → +3',
      patch: { kind: 'replaceEffect', section: 'tails', index: 0, effect: { kind: 'block', amount: 3 } }
    }
  },
  'armor-compression': {
    id: skill('armor-compression'),
    name: '갑주 축압',
    exclusiveTo: character('arcanist'),
    type: 'flip',
    rarity: 'common',
    tags: ['defense', 'utility'],
    targetType: 'self',
    cooldown: 1,
    cost: 2,
    base: [{ kind: 'block', amount: 6 }],
    heads: { mode: 'per', effects: [{ kind: 'echoPreheat', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: {
      name: '강화',
      description: '앞면과 뒷면이 모두 나오면 임시 마나 코인 1개를 손에 추가',
      patch: { kind: 'addMixedFaceEffect', effect: { kind: 'addCoin', coin: coin('mana'), zone: 'hand', count: 1 } }
    }
  },
  'mana-amplification': {
    id: skill('mana-amplification'),
    name: '마력 증폭막',
    exclusiveTo: character('arcanist'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['defense'],
    targetType: 'self',
    cooldown: 1,
    consume: { element: 'mana', count: 2 },
    effects: [{ kind: 'block', amount: 6 }, { kind: 'precisionDefenseArm' }],
    upgrade: { name: '강화', description: '마나 코인 소비 2개 → 1개', patch: { kind: 'costDelta', delta: -1 } }
  },
  'armor-smash': {
    id: skill('armor-smash'),
    name: '갑주 강타',
    exclusiveTo: character('arcanist'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    consume: { element: 'mana', count: 2 },
    effects: [{ kind: 'damagePlusEcho', base: 6 }],
    upgrade: {
      name: '강화',
      description: '기본 피해 6 → 8',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'damagePlusEcho', base: 8 } }
    }
  },
  'arcane-armor-release': {
    id: skill('arcane-armor-release'),
    name: '마도 갑주 해방',
    exclusiveTo: character('arcanist'),
    type: 'consume',
    rarity: 'rare',
    tags: ['defense', 'ultimate'],
    targetType: 'self',
    oncePerCombat: true,
    consume: { element: 'mana', count: 3 },
    effects: [
      { kind: 'block', amount: 8 },
      { kind: 'aoeDamagePlusEcho', base: 4 }
    ],
    upgrade: {
      name: '강화',
      description: '방어 8 → 10, 광역 기본 피해 4 → 6',
      patch: {
        kind: 'multi',
        patches: [
          { kind: 'baseAmount', index: 0, delta: 2 },
          { kind: 'replaceEffect', section: 'base', index: 1, effect: { kind: 'aoeDamagePlusEcho', base: 6 } }
        ]
      }
    }
  },
  'shield-summon': {
    id: skill('shield-summon'),
    name: '방패 전개',
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cost: 1,
    exclusiveTo: character('arcanist'),
    base: [{ kind: 'summonEquipment', equipment: equip('mana-shield'), duration: 2 }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '겹겹 전개', description: '앞면 방어 +2 효과 추가', patch: { kind: 'addFaceEffect', face: 'heads', effect: { kind: 'block', amount: 2 } } }
  },
  // 마력 갑주 빌드 (방어 참조/피해화 — 방어 비소모, '반격' 어휘 미사용)
  'mirror-plate': {
    id: skill('mirror-plate'),
    name: '마력 반사판',
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cost: 1,
    exclusiveTo: character('arcanist'),
    base: [{ kind: 'damagePerBlock', amountPerBlock: 1 }],
    bloodOffering: true,
    upgrade: {
      name: '집속 반사판',
      description: '앞면 피해 +4 효과 추가',
      patch: { kind: 'addFaceEffect', face: 'heads', effect: { kind: 'damage', amount: 4 } }
    }
  },
  'bulwark-charge': {
    id: skill('bulwark-charge'),
    name: '성채 돌진',
    type: 'consume',
    rarity: 'rare',
    tags: ['attack'],
    targetType: 'single-enemy',
    exclusiveTo: character('arcanist'),
    consume: { element: 'mana', count: 2 },
    effects: [
      { kind: 'block', amount: 6 },
      { kind: 'damagePerBlock', amountPerBlock: 1 }
    ],
    bloodOffering: true,
    upgrade: { name: '요새 돌진', description: '기본 방어 +3', patch: { kind: 'baseAmount', index: 0, delta: 3 } }
  },
  // 마나 병기 빌드 (소환 강화/유지)
  'weapon-tuning': {
    id: skill('weapon-tuning'),
    name: '병기 조율',
    type: 'flip',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    cost: 1,
    exclusiveTo: character('arcanist'),
    base: [
      { kind: 'empowerSummons', amount: 1 },
      { kind: 'draw', count: 1 }
    ],
    heads: { mode: 'any', effects: [{ kind: 'empowerSummons', amount: 1 }] },
    upgrade: { name: '정밀 조율', description: '기본 강화 +1', patch: { kind: 'baseAmount', index: 0, delta: 1 } }
  },
  'twin-armory': {
    id: skill('twin-armory'),
    name: '쌍병기 전개',
    type: 'flip',
    rarity: 'rare',
    tags: ['utility'],
    targetType: 'self',
    oncePerCombat: true,
    cost: 2,
    exclusiveTo: character('arcanist'),
    base: [
      { kind: 'summonEquipment', equipment: equip('mana-sword'), duration: 2 },
      { kind: 'summonEquipment', equipment: equip('mana-shield'), duration: 2 }
    ],
    upgrade: { name: '상비 병기고', description: '전투당 1회 제한 해제', patch: { kind: 'removeOncePerCombat' } }
  },
  'arsenal-barrage': {
    id: skill('arsenal-barrage'),
    name: '병기 일제 전개',
    type: 'flip',
    rarity: 'rare',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 2,
    cost: 4,
    exclusiveTo: character('arcanist'),
    // P7 D3 — 4비용 대표: 병기 2 전개 + 즉시 드로우 (고비용 턴 실구성 표적)
    base: [
      { kind: 'summonEquipment', equipment: equip('mana-sword'), duration: 2 },
      { kind: 'summonEquipment', equipment: equip('mana-shield'), duration: 2 },
      { kind: 'draw', count: 2 }
    ],
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '총력 전개', description: '뒷면 방어 +2 효과 추가', patch: { kind: 'addFaceEffect', face: 'tails', effect: { kind: 'block', amount: 2 } } }
  },
  // P9 마도기사 병기 출력 빌드
  'alchemy-slash': {
    id: skill('alchemy-slash'),
    name: '연성 참격',
    exclusiveTo: character('arcanist'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 2,
    base: [{ kind: 'damage', amount: 8 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] },
    tails: { mode: 'any', effects: [{ kind: 'increaseWeaponOutput', amount: 1 }] },
    upgrade: { name: '강화', description: '뒷면 하나라도 +1 → 뒷면마다 +1', patch: { kind: 'setFaceMode', face: 'tails', mode: 'per' } }
  },
  'diffusion-mark': {
    id: skill('diffusion-mark'),
    name: '확산 각인',
    exclusiveTo: character('arcanist'),
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 1,
    cost: 2,
    base: [{ kind: 'grantChosenSummonAoe', uses: 1, usesPerHeads: 1 }],
    tails: { mode: 'per', effects: [{ kind: 'extendChosenSummon', amount: 1 }] },
    upgrade: {
      name: '강화',
      description: '앞면과 뒷면이 모두 나오면 임시 마나 코인 1개를 손에 추가',
      patch: { kind: 'addMixedFaceEffect', effect: { kind: 'addCoin', coin: coin('mana'), zone: 'hand', count: 1 } }
    }
  },
  'reactor-overdrive': {
    id: skill('reactor-overdrive'),
    name: '마력로 과급',
    exclusiveTo: character('arcanist'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 2,
    consume: { element: 'mana', count: 2 },
    effects: [
      { kind: 'increaseWeaponOutput', amount: 2 },
      { kind: 'extendAllSummons', amount: 1 }
    ],
    upgrade: { name: '강화', description: '마나 코인 소비 2개 → 1개', patch: { kind: 'costDelta', delta: -1 } }
  },
  'arcane-duplicate': {
    id: skill('arcane-duplicate'),
    name: '마도식 복제',
    exclusiveTo: character('arcanist'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 2,
    consume: { element: 'mana', count: 2 },
    effects: [{ kind: 'cloneChosenSummon', duration: 2, fullCapExtension: 2 }],
    upgrade: {
      name: '강화',
      description: '복제 지속 2 → 3, 소환 한도에서는 지속 +3',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'cloneChosenSummon', duration: 3, fullCapExtension: 3 } }
    }
  },
  'azure-armory-open': {
    id: skill('azure-armory-open'),
    name: '청람 병장개문',
    exclusiveTo: character('arcanist'),
    type: 'flip',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'all-enemies',
    oncePerCombat: true,
    cost: 3,
    base: [{ kind: 'virtualManaSwordVolley', baseDamage: 3 }],
    upgrade: {
      name: '강화',
      description: '임시 마나 검 기본 수 3 → 4',
      patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'virtualManaSwordVolley', baseDamage: 3, baseCount: 4 } }
    }
  },
  // ── 혈액 마검사: 시작 세트 + 흡혈 순환 + 혈마검 각성 ──
  'blood-offering-skill': {
    id: skill('blood-offering-skill'),
    name: '혈액 공양',
    exclusiveTo: character('blood-spellblade'),
    type: 'consume',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    oncePerCombat: true,
    bloodOffering: true,
    consume: { element: 'blood', count: 5, mode: 'upTo' },
    effects: [{ kind: 'bloodOffering' }]
  },
  sacrifice: {
    id: skill('sacrifice'),
    name: '재물',
    exclusiveTo: character('blood-spellblade'),
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 1,
    cost: 0,
    base: [
      { kind: 'payHp', amount: 3 },
      { kind: 'addCoin', coin: coin('blood'), zone: 'discard', count: 2 }
    ],
    upgrade: {
      name: '풍성한 재물',
      description: '임시 혈액 동전 2개 → 3개',
      patch: {
        kind: 'addCoinOnUse',
        coin: coin('blood'),
        zone: 'discard',
        count: 1
      }
    }
  },
  'bloodsucking-slash': {
    id: skill('bloodsucking-slash'),
    name: '흡혈참',
    exclusiveTo: character('blood-spellblade'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 0,
    cost: 1,
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'lifesteal', amount: 2 }] },
    upgrade: {
      name: '깊은 흡혈',
      description: '뒷면 흡혈 2 → 3',
      patch: {
        kind: 'replaceEffect',
        section: 'tails',
        index: 0,
        effect: { kind: 'lifesteal', amount: 3 }
      }
    }
  },
  'blood-circulation': {
    id: skill('blood-circulation'),
    name: '혈액 순환',
    exclusiveTo: character('blood-spellblade'),
    type: 'flip',
    rarity: 'common',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 1,
    cost: 1,
    requiredCoin: coin('basic'),
    base: [
      { kind: 'returnDiscardCoin', coin: coin('blood'), count: 1 },
      { kind: 'heal', amount: 2 }
    ],
    upgrade: {
      name: '무비용 순환',
      description: '코스트 1 → 0',
      patch: { kind: 'costDelta', delta: -1 }
    }
  },
  feast: {
    id: skill('feast'),
    name: '포식',
    exclusiveTo: character('blood-spellblade'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    consume: { element: 'blood', count: 3, mode: 'upTo' },
    effects: [
      { kind: 'damageByConsumed', base: 0, perCoin: 5 },
      { kind: 'lifestealByConsumed', amountPerCoin: 2 }
    ]
  },
  'bloodflow-reversal': {
    id: skill('bloodflow-reversal'),
    name: '혈류 역전',
    exclusiveTo: character('blood-spellblade'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 2,
    base: [{ kind: 'damage', amount: 6 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'lifesteal', amount: 2 }] },
    returnUsedElementToDrawTop: { element: 'blood', count: 1, minimumUsed: 2 },
    upgrade: {
      name: '역류 격화',
      description: '기본 피해 6 → 8',
      patch: { kind: 'baseAmount', index: 0, delta: 2 }
    }
  },
  'blood-reincarnation': {
    id: skill('blood-reincarnation'),
    name: '혈액 윤회',
    exclusiveTo: character('blood-spellblade'),
    type: 'consume',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'all-enemies',
    oncePerCombat: true,
    consume: { element: 'blood', count: 3 },
    effects: [
      { kind: 'damage', amount: 9 },
      { kind: 'lifesteal', amount: 6 },
      { kind: 'addCoin', coin: coin('blood'), zone: 'discard', count: 2 }
    ],
    upgrade: {
      name: '끝없는 윤회',
      description: '일회성 제거, 재사용 대기 3턴',
      patch: { kind: 'removeOncePerCombat', cooldown: 3 }
    }
  },
  'blood-feeding': {
    id: skill('blood-feeding'),
    name: '혈식',
    exclusiveTo: character('blood-spellblade'),
    type: 'consume',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 0,
    bloodSword: true,
    consume: { element: 'blood', count: 1 },
    effects: [{ kind: 'investBloodSword' }, { kind: 'damageByBloodSword', base: 4, multiplier: 1 }],
    upgrade: {
      name: '탐식',
      description: '기본 피해 4 → 6',
      patch: {
        kind: 'replaceEffect',
        section: 'base',
        index: 1,
        effect: { kind: 'damageByBloodSword', base: 6, multiplier: 1 }
      }
    }
  },
  'blood-sword-draw': {
    id: skill('blood-sword-draw'),
    name: '혈마 발도',
    exclusiveTo: character('blood-spellblade'),
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 0,
    cost: 1,
    bloodSword: true,
    base: [{ kind: 'damageByBloodSword', base: 3, multiplier: 1 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] },
    upgrade: {
      name: '예리한 발도',
      description: '앞면 피해 2 → 3, 뒷면 방어 3 → 4',
      patch: {
        kind: 'multi',
        patches: [
          {
            kind: 'replaceEffect',
            section: 'heads',
            index: 0,
            effect: { kind: 'damage', amount: 3 }
          },
          {
            kind: 'replaceEffect',
            section: 'tails',
            index: 0,
            effect: { kind: 'block', amount: 4 }
          }
        ]
      }
    }
  },
  'blood-sword-combo': {
    id: skill('blood-sword-combo'),
    name: '혈마 연참',
    exclusiveTo: character('blood-spellblade'),
    type: 'consume',
    rarity: 'advanced',
    tags: ['attack'],
    targetType: 'single-enemy',
    cooldown: 1,
    bloodSword: true,
    consume: { element: 'blood', count: 2 },
    effects: [{ kind: 'investBloodSword' }, { kind: 'damageByBloodSword', base: 8, multiplier: 2 }],
    upgrade: {
      name: '난무',
      description: '기본 피해 8 → 11',
      patch: {
        kind: 'replaceEffect',
        section: 'base',
        index: 1,
        effect: { kind: 'damageByBloodSword', base: 11, multiplier: 2 }
      }
    }
  },
  'blood-sword-counter': {
    id: skill('blood-sword-counter'),
    name: '혈마 반격',
    exclusiveTo: character('blood-spellblade'),
    type: 'flip',
    rarity: 'advanced',
    tags: ['attack', 'defense'],
    targetType: 'single-enemy',
    cooldown: 1,
    cost: 2,
    bloodSword: true,
    base: [
      { kind: 'damageByBloodSword', base: 2, multiplier: 1 },
      { kind: 'block', amount: 5 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: {
      name: '견고한 반격',
      description: '기본 방어 5 → 7',
      patch: { kind: 'baseAmount', index: 1, delta: 2 }
    }
  },
  'true-blood-sword-slash': {
    id: skill('true-blood-sword-slash'),
    name: '진·혈마참',
    exclusiveTo: character('blood-spellblade'),
    type: 'consume',
    rarity: 'rare',
    tags: ['attack', 'ultimate'],
    targetType: 'all-enemies',
    oncePerCombat: true,
    bloodSword: true,
    consume: { element: 'blood', count: 3 },
    effects: [{ kind: 'investBloodSword' }, { kind: 'damageByBloodSword', base: 8, multiplier: 4 }],
    upgrade: {
      name: '진·혈마참 극',
      description: '혈마검 위력 배율 4 → 5',
      patch: {
        kind: 'replaceEffect',
        section: 'base',
        index: 1,
        effect: { kind: 'damageByBloodSword', base: 8, multiplier: 5 }
      }
    }
  },
  // ── P7 D3 — 공용 드로우/쿨다운 유틸리티 (고비용 턴 셋업 지원) ──
  'battle-focus': {
    id: skill('battle-focus'),
    name: '전투 집중',
    type: 'flip',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 2,
    cost: 1,
    base: [{ kind: 'draw', count: 2 }],
    heads: { mode: 'any', effects: [{ kind: 'nextTurnDraw', count: 1 }] },
    upgrade: {
      name: '보급 집중',
      description: '사용 시 임시 기본 코인 1개를 손에 만든다',
      patch: { kind: 'addCoinOnUse', coin: coin('basic'), zone: 'hand', count: 1 }
    }
  },
  regroup: {
    id: skill('regroup'),
    name: '재정비',
    type: 'flip',
    rarity: 'advanced',
    tags: ['utility'],
    targetType: 'self',
    cooldown: 3,
    cost: 1,
    // 쿨다운 감소는 자기 슬롯 제외(P7 D1) — 반복·전투당 1회 스킬은 구조적으로 비대상
    base: [
      { kind: 'reduceCooldown', amount: 1 },
      { kind: 'draw', count: 1 }
    ],
    upgrade: {
      name: '신속 재정비',
      description: '사용 시 임시 기본 코인 1개를 뽑기 더미에 만든다',
      patch: { kind: 'addCoinOnUse', coin: coin('basic'), zone: 'draw', count: 1 }
    }
  }
} satisfies Record<string, SkillDef>;

const aurelWindup = { turns: 1, revealAtStart: true } as const;
const aurelStrike10 = { id: 'royal-strike', actions: [{ kind: 'attack', damage: 10, ordinary: true }] } satisfies EnemyIntent;
const aurelPhaseReturn = { kind: 'returnOldestRoyalVaultCoin' } satisfies EnemyAction;

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
    // 몬스터 패시브 수직 슬라이스 (P5.6 감사) — balance-provisional.
    // '포식' intent의 회복 5와 의도적으로 공존한다: 패시브는 매 턴 미세 재생으로
    // "화상으로 회복 상쇄" 대응법(§5.2)의 상시 압박을 만들고, 포식은 3턴 주기의
    // 순간 회복이다. 수치(1)는 사람 밸런스 판정 전 확정하지 않는다.
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
  'gate-pikeman': {
    id: enemy('gate-pikeman'),
    name: '브레겐 성문 창병',
    maxHp: 50,
    intents: [
      { id: 'probe', actions: [{ kind: 'attack', damage: 8 }] },
      {
        id: 'piercing-thrust',
        windup: { turns: 1, revealAtStart: true },
        vulnerableWhileWindup: 1.5,
        actions: [{ kind: 'attack', damage: 16 }]
      },
      { id: 'keep-distance', actions: [{ kind: 'attack', damage: 7 }] }
    ]
  },
  'black-hound': {
    id: enemy('black-hound'),
    name: '도른발트 검은사냥개',
    maxHp: 42,
    intents: [
      { id: 'harry', actions: [{ kind: 'attack', damage: 7 }] },
      {
        id: 'marked-leap',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'conditionalAttack', damage: 10, bonusDamage: 5, condition: 'playerHpBelowHalf' }]
      }
    ]
  },
  'red-lancer': {
    id: enemy('red-lancer'),
    name: '로트하임 붉은기병',
    maxHp: 64,
    growthLabel: '기세',
    intents: [
      { id: 'saber-cut', actions: [{ kind: 'attack', damage: 10 }] },
      {
        id: 'red-charge',
        windup: { turns: 1, revealAtStart: true },
        cancelOn: { kind: 'skillDamage', threshold: 12 },
        vulnerableWhileWindup: 1.5,
        actions: [
          { kind: 'attack', damage: 22, damagePerGrowthPercent: 0.15 },
          {
            kind: 'growOnUnblockedDamage',
            amount: 1,
            maxStacks: 3,
            minHpDamageFraction: 0.5,
            loseOnFullBlock: false
          }
        ]
      }
    ]
  },
  'chained-berserker': {
    id: enemy('chained-berserker'),
    name: '쇠사슬 광전사',
    maxHp: 68,
    intents: [
      { id: 'chain-swing', actions: [{ kind: 'attack', damage: 10 }] },
      { id: 'drag-chain', actions: [{ kind: 'attack', damage: 6, hits: 2 }] }
    ],
    phases: [
      {
        hpBelowFraction: 0.5,
        damageTakenMultiplier: 1.25,
        intents: [
          {
            id: 'frenzied-chainstorm',
            windup: { turns: 1, revealAtStart: true },
            actions: [{ kind: 'attack', damage: 5, hits: 3 }]
          },
          {
            id: 'frenzied-cleave',
            windup: { turns: 1, revealAtStart: true },
            actions: [{ kind: 'attack', damage: 8, hits: 2 }]
          }
        ]
      }
    ]
  },
  'silverbell-healer': {
    id: enemy('silverbell-healer'),
    name: '은종 수도원의 치유사',
    maxHp: 36,
    intents: [
      {
        id: 'silver-mend',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'healAlly', amount: 12, target: 'lowestHpAlly', cleanse: 2 }]
      },
      { id: 'bell-strike', actions: [{ kind: 'attack', damage: 6 }] }
    ]
  },
  'chalice-thrall': {
    id: enemy('chalice-thrall'),
    name: '붉은성배 흡혈귀 시종',
    maxHp: 58,
    growthLabel: '만찬',
    intents: [
      {
        id: 'blood-drain',
        actions: [
          { kind: 'attack', damage: 7 },
          { kind: 'growOnUnblockedDamage', amount: 1, healOnGrow: 2, maxStacks: 5 }
        ]
      },
      {
        id: 'hungry-slash',
        actions: [
          { kind: 'attack', damage: 5, hits: 2 },
          { kind: 'growOnUnblockedDamage', amount: 1, healOnGrow: 2, maxStacks: 5 }
        ]
      },
      {
        id: 'chalice-kiss',
        actions: [
          { kind: 'attack', damage: 13 },
          { kind: 'growOnUnblockedDamage', amount: 1, healOnGrow: 2, maxStacks: 5 }
        ],
        growthBranch: {
          atLeast: 4,
          intent: {
            id: 'crimson-feast',
            windup: { turns: 1, revealAtStart: true },
            actions: [
              { kind: 'attack', damage: 7, hits: 3 },
              { kind: 'growOnUnblockedDamage', amount: 1, healOnGrow: 2, maxStacks: 5 }
            ]
          }
        }
      }
    ]
  },
  // P13 §6.2/§6.4 Batch B — balance-provisional values are taken from the owner-approved
  // 20-monster specification. Poison persists until cleansed so the advertised threshold is reachable.
  'plague-doctor': {
    id: enemy('plague-doctor'),
    name: '재부리 역병의사',
    maxHp: 50,
    intents: [
      {
        id: 'poison-injection',
        actions: [
          { kind: 'attack', damage: 7 },
          { kind: 'applyStatus', status: 'poison', stacks: 2, requiresLastAttackHpDamage: true }
        ]
      },
      {
        id: 'plague-mist',
        windup: { turns: 1, revealAtStart: true },
        actions: [
          { kind: 'applyStatus', status: 'poison', stacks: 1 },
          {
            kind: 'applyStatus',
            status: 'healLock',
            stacks: 2,
            requiresPlayerStatus: { status: 'poison', atLeast: 5 }
          }
        ]
      }
    ]
  },
  // P13 §6.2/§6.4 Batch B — returned, temporary, preserved, and grant-derived elemental
  // coins all count while they remain unspent in hand at player turn end.
  'white-wraith': {
    id: enemy('white-wraith'),
    name: '서리묘지 백색망령',
    maxHp: 48,
    playerTurnEndPunishment: {
      kind: 'unusedElementalCoinsAtLeast',
      threshold: 4,
      status: 'frostbite',
      stacks: 1
    },
    intents: [
      {
        id: 'cold-touch',
        actions: [
          { kind: 'attack', damage: 7 },
          { kind: 'applyStatus', status: 'frostbite', stacks: 1 }
        ]
      },
      {
        id: 'winters-hand',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'applyStatus', status: 'frostbite', stacks: 2 }]
      }
    ]
  },
  // P13 §6.2/§6.4 Batch B — visible post-mitigation HP damage breaks rings before the
  // mandatory round-end gain; each surviving ring supplies mitigation and action-start regeneration.
  'ancient-treant': {
    id: enemy('ancient-treant'),
    name: '흑가시 숲 고목정령',
    maxHp: 65,
    growthLabel: '나이테',
    roundGrowth: {
      gainPerRound: 1,
      maxStacks: 5,
      damageReductionPerStack: 0.08,
      healMaxHpFractionPerStack: 0.03,
      removeOneAtHpFraction: 0.15,
      removeTwoAtHpFraction: 0.25
    },
    intents: [{ id: 'root-strike', actions: [{ kind: 'attack', damage: 7 }] }]
  },
  // P13 §6.2/§6.4 Batch C — defensive roles use the shared core link/petrify/aura
  // contracts. Values are balance-provisional from the approved 20-monster catalog.
  'fortress-guard': {
    id: enemy('fortress-guard'),
    name: '아이젠발 성채수호병',
    maxHp: 78,
    threat: 4,
    protectionLink: {
      target: 'highestThreatAlly',
      redirectFraction: 0.4,
      durability: 3,
      restoreDurability: 2,
      brokenTurns: 2,
      damageTakenMultiplierWhileBroken: 1.2
    },
    intents: [
      { id: 'shield-bash', actions: [{ kind: 'attack', damage: 6 }] },
      { id: 'shield-brace', actions: [{ kind: 'block', amount: 8 }] }
    ]
  },
  'cathedral-gargoyle': {
    id: enemy('cathedral-gargoyle'),
    name: '성 오델리아의 봉헌 가고일',
    maxHp: 68,
    petrify: {
      damageReduction: 0.7,
      shatterRawDamageFraction: 0.2,
      crackedTurns: 1,
      crackedDamageTakenMultiplier: 1.3,
      cancelWindupIntentId: 'falling-assault'
    },
    intents: [
      { id: 'claw', actions: [{ kind: 'attack', damage: 7 }] },
      { id: 'petrify', entersPetrify: true, actions: [] },
      {
        id: 'falling-assault',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'attack', damage: 17 }]
      }
    ]
  },
  'war-banner-rider': {
    id: enemy('war-banner-rider'),
    name: '그리폰 왕가의 전쟁기수',
    maxHp: 48,
    threat: 3,
    warBanner: {
      attackAuraPercent: 0.1,
      march: { attackPercent: 0.2, turns: 2, shieldMaxHpFraction: 0.08 }
    },
    intents: [
      { id: 'banner-strike', actions: [{ kind: 'attack', damage: 6 }] },
      {
        id: 'royal-march',
        windup: { turns: 1, revealAtStart: true },
        groupMarch: true,
        actions: []
      }
    ]
  },
  // Directive 14 Batch D — the mechanics are declared through generic action
  // markers so combat resolution stays independent of individual enemy ids.
  'black-pouch-coin-thief': {
    id: enemy('black-pouch-coin-thief'),
    name: '검은 주머니 동전 도둑',
    maxHp: 44,
    coinSeizure: {
      target: 'mostNumerousPublicElementInHand',
      maxCoins: 2,
      capFraction: 0.5
    },
    intents: [
      {
        id: 'seize-purse',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'seizeCustody' }, { kind: 'attack', damage: 4 }]
      },
      { id: 'cutpurse-strike', actions: [{ kind: 'attack', damage: 6 }] }
    ]
  },
  'grey-tower-sealer': {
    id: enemy('grey-tower-sealer'),
    name: '회색 탑의 봉인술사',
    maxHp: 46,
    skillSeal: {
      recentPlayerTurns: 2,
      turns: 2,
      uniqueSkillEffectMultiplier: 0.75
    },
    intents: [
      { id: 'cast-seal', actions: [{ kind: 'sealRecentSkill' }] },
      { id: 'arcane-bolt', actions: [{ kind: 'attack', damage: 7 }] },
      { id: 'greater-bolt', actions: [{ kind: 'attack', damage: 5 }] }
    ]
  },
  // Directive 15 — M17/M18 remain generic resolver data; no enemy-id branches.
  'blackthorn-inquisitor-roderick': {
    id: enemy('blackthorn-inquisitor-roderick'),
    name: '검은가시 심문관 로데릭',
    maxHp: 96,
    repeatSkillPressure: {
      threshold: 3,
      maxZeal: 3,
      sameSkillGain: 1,
      differentSkillReset: 0,
      singleUsableZealEveryUses: 2,
      sealTurns: 1,
      executionIntent: {
        id: 'zeal-execution',
        windup: { turns: 1, revealAtStart: true },
        cancelOn: { kind: 'skillDamage', threshold: 15 },
        actions: [{ kind: 'attack', damage: 18 }, { kind: 'sealTriggeredSkill', turns: 1 }, { kind: 'resetRepeatSkillPressure' }]
      }
    },
    intents: [
      { id: 'warden-strike', actions: [{ kind: 'attack', damage: 8 }] },
      { id: 'warden-slash', actions: [{ kind: 'attack', damage: 10 }] }
    ]
  },
  'fallen-kings-treasurer-marcel': {
    id: enemy('fallen-kings-treasurer-marcel'),
    name: '무너진 왕의 재무관 마르셀',
    maxHp: 92,
    coinSeizure: { target: 'mostNumerousPublicElementInHand', maxCoins: 2, capFraction: 0.5 },
    royalTax: {
      denomination: 2,
      deadline: 'endNextPlayerTurn',
      counterfeitCoin: coin('counterfeit'),
      counterfeitCount: 2,
      defaultShield: 8,
      seizureAfterDefaults: 2,
      seizureIntent: {
        id: 'royal-seizure',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'seizeCustody' }, { kind: 'attack', damage: 4 }, { kind: 'resetRoyalTaxDefaults' }]
      }
    },
    intents: [
      { id: 'royal-tax', actions: [{ kind: 'royalTax', degradedDamage: 8 }] },
      { id: 'audit-eight', actions: [{ kind: 'attack', damage: 8 }] },
      { id: 'royal-tax-repeat', actions: [{ kind: 'royalTax', degradedDamage: 8 }] },
      { id: 'audit-six', actions: [{ kind: 'attack', damage: 6 }] }
    ]
  },
  // Directive 16 Batch E — summoned units are combat-only definitions and
  // never enter graph encounter pools on their own.
  'mortbell-bonebell-necromancer': {
    id: enemy('mortbell-bonebell-necromancer'),
    name: '모르트벨 뼈종 사령술사',
    maxHp: 50,
    intents: [
      { id: 'bone-shard', actions: [{ kind: 'attack', damage: 6 }] },
      {
        id: 'raise-skeleton',
        windup: aurelWindup,
        actions: [{ kind: 'summonEnemies', enemy: enemy('skeleton-servant'), maxCount: 2 }]
      }
    ]
  },
  'skeleton-servant': {
    id: enemy('skeleton-servant'),
    name: '해골 시종',
    maxHp: 15,
    intents: [{ id: 'rattle-strike', actions: [{ kind: 'attack', damage: 4 }] }]
  },
  'fenmarsh-eggkeeper-witch': {
    id: enemy('fenmarsh-eggkeeper-witch'),
    name: '펜마르시 알지기 마녀',
    maxHp: 55,
    intents: [
      { id: 'marsh-curse', actions: [{ kind: 'attack', damage: 6 }] },
      { id: 'lay-eggs', actions: [{ kind: 'summonEnemies', enemy: enemy('mud-egg'), maxCount: 2 }] },
      { id: 'accelerate-brood', actions: [{ kind: 'accelerateHatching', amount: 1 }] }
    ]
  },
  'mud-egg': {
    id: enemy('mud-egg'),
    name: '진흙 알',
    maxHp: 10,
    hatch: { into: enemy('marsh-hatchling'), turns: 2, delayAtHpFraction: 0.5 },
    intents: [{ id: 'incubate', actions: [{ kind: 'tickHatch' }] }]
  },
  'marsh-hatchling': {
    id: enemy('marsh-hatchling'),
    name: '늪지 부화체',
    maxHp: 18,
    intents: [{ id: 'marsh-bite', actions: [{ kind: 'attack', damage: 5 }] }]
  },
  'uncrowned-coin-king-aurel': {
    id: enemy('uncrowned-coin-king-aurel'),
    name: '무관의 주화왕 아우렐',
    maxHp: 180,
    royalTax: {
      denomination: 2,
      deadline: 'endNextPlayerTurn',
      counterfeitCoin: coin('counterfeit'),
      counterfeitCount: 1,
      defaultShield: 0,
      foreclosureAfterDefaults: 1,
      foreclosureIntent: {
        id: 'royal-vault-foreclose',
        windup: aurelWindup,
        actions: [{ kind: 'royalVaultForeclose' }]
      },
      foreclosureMaxCoins: 1,
      paidNextOrdinaryAttackReduction: 2
    },
    royalVault: {
      capacity: 6,
      blockLostPerRecovery: 4,
      lead: {
        generatedTemporaryElementalCount: 3,
        minRemaining: 1,
        maxWeakensPerTurn: 2,
        maxWeakensPerWindup: 2,
        damageWeakeningThreshold: 16
      },
      atCapacityIntent: {
        id: 'crown-confiscation',
        windup: aurelWindup,
        cancelOn: [
          { kind: 'vaultCoinsRecovered', count: 2 },
          { kind: 'skillDamage', threshold: 10 }
        ],
        onCancelActions: [{ kind: 'returnOldestRoyalVaultCoin', reason: 'crownCancelled' }],
        actions: [
          { kind: 'attack', damage: 22 },
          { kind: 'createCounterfeit', coin: coin('counterfeit'), count: 2 },
          { kind: 'returnOldestRoyalVaultCoin', reason: 'crownResolved' }
        ]
      }
    },
    intents: [
      { id: 'royal-tax', actions: [{ kind: 'royalTax', degradedDamage: 8 }] },
      aurelStrike10
    ],
    phases: [
      {
        hpBelowFraction: 0.7,
        transitionBeforeAction: true,
        onEnterActions: [
          { kind: 'removeCounterfeits', count: 1 },
          aurelPhaseReturn
        ],
        intents: [
          {
            id: 'lead-decree',
            windup: aurelWindup,
            actions: [{ kind: 'leadDecree' }]
          },
          aurelStrike10,
          { id: 'vault-barrier', actions: [{ kind: 'royalVaultBarrier', blockPerStoredCoin: 3 }] }
        ]
      },
      {
        hpBelowFraction: 0.35,
        transitionBeforeAction: true,
        onEnterActions: [
          { kind: 'clearLeadCoins' },
          aurelPhaseReturn
        ],
        intents: [
          { id: 'royal-strike', actions: [{ kind: 'attack', damage: 12, ordinary: true }] },
          {
            id: 'royal-seizure',
            windup: aurelWindup,
            actions: [{ kind: 'royalVaultExactSeizure', maxCoins: 3, selection: 'handFraction' }]
          }
        ]
      }
    ]
  },
  'ash-duke-valdemar': {
    id: enemy('ash-duke-valdemar'),
    name: '재의 공작 발데마르',
    maxHp: 180,
    furnace: {
      initialTemperature: 0,
      maxTemperature: 6,
      actionResolvedGain: 1,
      playerBurnDamageGain: 1,
      playerBurnClearLoss: 2,
      playerDamageThreshold: { phaseEntryHpFraction: 0.15, loss: 1 },
      atMaxIntent: {
        id: 'coronation',
        windup: { turns: 1, revealAtStart: true },
        cancelOn: { kind: 'enemyResourceAtMost', resource: 'furnaceTemperature', value: 5 },
        onCancelActions: [
          { kind: 'setEnemyResource', resource: 'furnaceTemperature', value: 3, reason: 'coronationCancelled' },
          { kind: 'reduceGrowthStacks', amount: 2 }
        ],
        actions: [
          { kind: 'attack', damage: 24, damagePerGrowthPercent: 0.08 },
          { kind: 'applyStatus', status: 'burn', stacks: 3 },
          { kind: 'setEnemyResource', resource: 'furnaceTemperature', value: 3, reason: 'coronationResolved' }
        ]
      }
    },
    intents: [
      {
        id: 'burning-slash',
        actions: [
          { kind: 'attack', damage: 10 },
          { kind: 'applyStatus', status: 'burn', stacks: 1, requiresLastAttackHpDamage: true }
        ]
      },
      {
        id: 'ember-brand',
        windup: { turns: 1, revealAtStart: true },
        actions: [{ kind: 'applyStatus', status: 'burn', stacks: 2 }]
      }
    ],
    phases: [
      {
        hpBelowFraction: 0.7,
        transitionBeforeAction: true,
        onEnterActions: [
          { kind: 'removePlayerStatus', status: 'burn', stacks: 1 },
          { kind: 'setEnemyResource', resource: 'furnaceTemperature', value: 2, reason: 'phaseEntered' },
          { kind: 'summonEnemies', enemy: enemy('ash-vassal'), maxCount: 2 }
        ],
        intents: [
          {
            id: 'burning-slash',
            actions: [
              { kind: 'attack', damage: 10 },
              { kind: 'applyStatus', status: 'burn', stacks: 1, requiresLastAttackHpDamage: true }
            ]
          },
          {
            id: 'ember-brand',
            windup: { turns: 1, revealAtStart: true },
            actions: [{ kind: 'applyStatus', status: 'burn', stacks: 2 }]
          }
        ]
      },
      {
        hpBelowFraction: 0.35,
        transitionBeforeAction: true,
        onEnterActions: [{ kind: 'setEnemyResource', resource: 'furnaceTemperature', value: 2, reason: 'phaseEntered' }],
        growthOnActionResolved: { amount: 1, maxStacks: 5 },
        intents: [
          {
            id: 'burning-slash',
            actions: [
              { kind: 'attack', damage: 10, damagePerGrowthPercent: 0.08 },
              { kind: 'applyStatus', status: 'burn', stacks: 1, requiresLastAttackHpDamage: true }
            ]
          },
          {
            id: 'ember-brand',
            windup: { turns: 1, revealAtStart: true },
            actions: [{ kind: 'applyStatus', status: 'burn', stacks: 2 }]
          }
        ]
      }
    ]
  },
  'ash-vassal': {
    id: enemy('ash-vassal'),
    name: '재의 가신',
    maxHp: 24,
    vassalGuard: { source: enemy('ash-duke-valdemar'), damageReductionPercent: 0.15, maxSources: 2 },
    intents: [
      { id: 'ash-swipe', actions: [{ kind: 'attack', damage: 6 }] },
      {
        id: 'cinder-rake',
        actions: [
          { kind: 'attack', damage: 4 },
          { kind: 'applyStatus', status: 'burn', stacks: 1 }
        ]
      }
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
  // P6 D5 — 화염 격투가 '여울' (id 'warrior' 유지 = 세이브·리플레이·골든 최안전).
  // 시작 기본기 3종은 격투 전용 신규 ID로 교체, 기존 slash/guard/burning-strike는
  // 공용 defs로 존치(타 캐릭터 시작 셋·구 세이브 참조 유효).
  warrior: {
    id: character('warrior'),
    name: '화염 격투가',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('fire'), coin('fire')],
    // v1.2 — 반복 기본기 2 + 화염 속성 성공 단계 전용기 2.
    startingSkills: [skill('jab'), skill('fist-guard'), skill('fire-fist'), skill('direct-hit')],
    trait: {
      id: 'ember-pouch',
      name: '불씨 주머니',
      hook: 'combatStart',
      effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'draw', count: 1 }]
    }
  },
  // P3.4 — 술사·냉기 기사 (PRD 캐릭터 표 263~264행, 수치는 기준표 규격 그대로)
  sorcerer: {
    id: character('sorcerer'),
    name: '번개 결투사',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('lightning'), coin('lightning')],
    startingSkills: [skill('slash'), skill('guard'), skill('attaque'), skill('parade')],
    trait: {
      id: 'remise',
      name: '르미즈',
      hook: 'combatStart',
      effects: [],
      mechanic: 'remise'
    }
  },
  'frost-knight': {
    id: character('frost-knight'),
    name: '냉기 도적',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('frost'), coin('frost')],
    startingSkills: [skill('slash'), skill('guard'), skill('ice-claw'), skill('ice-sleight')],
    trait: {
      id: 'double-pocket',
      name: '이중 주머니',
      hook: 'combatStart',
      effects: [],
      mechanic: 'preserveHand'
    }
  },
  // P6 D6 — 마도기사 (마나 속성 공유 첫 사례)
  arcanist: {
    id: character('arcanist'),
    name: '마도기사',
    maxHp: 65,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('mana'), coin('mana')],
    // P7 D2 — 시작 4스킬: 기본기 2 + 마력 충전 + 명령
    startingSkills: [skill('slash'), skill('guard'), skill('arcane-charge'), skill('arcane-command')],
    trait: {
      id: 'arcane-atelier',
      name: '마도 공방',
      hook: 'turnStart',
      effects: [{ kind: 'summonEquipment', equipment: equip('mana-sword'), duration: 1 }]
    }
  },
  'blood-spellblade': {
    id: character('blood-spellblade'),
    name: '혈액 마검사',
    maxHp: 68,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('blood'), coin('blood')],
    startingSkills: [skill('slash'), skill('guard'), skill('blood-offering-skill'), skill('sacrifice')],
    trait: {
      id: 'blood-sword',
      name: '혈마검',
      hook: 'combatStart',
      effects: [],
      mechanic: 'bloodSword'
    }
  }
} satisfies Record<string, CharacterDef>;

// P6 D6 — 소환 장비 (턴 종료 자동 행동, 결정 로그 §D6 규칙)
export const equipment = {
  'mana-sword': {
    id: equip('mana-sword'),
    name: '마나 검',
    description: '턴 종료 시 첫 적에게 피해 3',
    action: { kind: 'strike', damage: 3 }
  },
  'mana-shield': {
    id: equip('mana-shield'),
    name: '마나 방패',
    description: '턴 종료 시 방어 2',
    action: { kind: 'ward', block: 2 }
  }
} satisfies Record<string, EquipmentDef>;

// P6 D2 — 획득 패시브 풀 (시작 고유 특성과 구분, 중복 획득 불가, 전부 balance-provisional)
export const passives = {
  // ── 화염 격투가: 무속성 5 (방어/생존 보조) ──
  'iron-body': {
    id: passive('iron-body'),
    name: '강철 피부',
    description: '전투 시작 시 방어 5를 얻는다',
    exclusiveTo: character('warrior'),
    element: null,
    hook: 'combatStart',
    effects: [{ kind: 'block', amount: 5 }],
    price: 70
  },
  'steady-breath': {
    id: passive('steady-breath'),
    name: '방패 숙련',
    description: '턴마다 처음 사용하는 방어 스킬의 방어가 1 증가한다',
    exclusiveTo: character('warrior'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'shieldMastery',
    price: 90
  },
  'reserve-coin': {
    id: passive('reserve-coin'),
    name: '빈틈없는 대비',
    description: '이번 턴 공격 스킬을 사용했다면 턴 종료 시 방어 1을 얻는다',
    exclusiveTo: character('warrior'),
    element: null,
    hook: 'combatStart',
    effects: [],
    mechanic: 'preparedStance',
    price: 60
  },
  'opening-stance': {
    id: passive('opening-stance'),
    name: '불굴의 투지',
    description: '매 턴 처음 받는 피해를 1 감소시킨다',
    exclusiveTo: character('warrior'),
    element: null,
    hook: 'combatStart',
    effects: [],
    mechanic: 'indomitableSpirit',
    price: 70
  },
  'thick-hide': {
    id: passive('thick-hide'),
    name: '전투 호흡',
    description: '전투마다 처음 체력이 50% 이하가 되면 체력을 3 회복한다',
    exclusiveTo: character('warrior'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'combatBreathing',
    price: 80
  },
  // ── 화염 격투가: 화염 3 (화상 보조) ──
  'ember-stock': {
    id: passive('ember-stock'),
    name: '발화 본능',
    description: '매 턴 처음 적에게 부여하는 화상이 1 증가한다',
    exclusiveTo: character('warrior'),
    element: 'fire',
    hook: 'combatStart',
    effects: [],
    mechanic: 'ignitionInstinct',
    price: 80
  },
  'kindling-rhythm': {
    id: passive('kindling-rhythm'),
    name: '잔불 칼날',
    description: '공격에 사용한 화염 동전이 뒷면이면 대상에게 화상 1을 부여한다',
    exclusiveTo: character('warrior'),
    element: 'fire',
    hook: 'turnStart',
    effects: [],
    mechanic: 'emberBlade',
    price: 90
  },
  'flame-opening': {
    id: passive('flame-opening'),
    name: '잔열 축적',
    description: '전투당 1회, 비과열 상태에서 공격 스킬에 화염 동전을 사용하면 다음 턴 과열을 예약한다',
    exclusiveTo: character('warrior'),
    retiredFromRewards: true,
    element: 'fire',
    hook: 'turnStart',
    effects: [],
    mechanic: 'residualHeat',
    price: 100
  },
  // ── 마도기사: 마력 갑주 2 + 마나 병기 2 ──
  'armor-memory': {
    id: passive('armor-memory'),
    name: '전개 예습',
    description: '전투 중 처음 소환하는 장비의 소환 +1',
    exclusiveTo: character('arcanist'),
    element: null,
    hook: 'combatStart',
    effects: [],
    mechanic: 'previewDeployment',
    price: 70
  },
  'drill-discipline': {
    id: passive('drill-discipline'),
    name: '역상 방호식',
    description: '턴당 1회, 하나의 스킬에서 뒷면이 2개 이상 나오면 방어 3',
    exclusiveTo: character('arcanist'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'inverseGuard',
    price: 80
  },
  'overcharge-core': {
    id: passive('overcharge-core'),
    name: '교차 연산',
    description: '매 턴 처음 앞면과 뒷면이 함께 나오면 임시 기본 동전 1개를 손에 추가한다',
    exclusiveTo: character('arcanist'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'crossCalculation',
    price: 100
  },
  'mana-reserve': {
    id: passive('mana-reserve'),
    name: '잔류식 재구축',
    description: '장비가 소멸하면 재구축을 얻습니다. 다음에 소환하는 장비의 소환 +1',
    exclusiveTo: character('arcanist'),
    element: null,
    hook: 'combatStart',
    effects: [],
    mechanic: 'residualRebuild',
    price: 80
  },
  'command-preservation': {
    id: passive('command-preservation'),
    name: '명령 보존식',
    description: '턴당 1회, 장비를 즉시 행동시킬 때 감소하는 소환 1을 무효로 합니다',
    exclusiveTo: character('arcanist'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'commandPreservation',
    price: 90
  },
  'mana-membrane': {
    id: passive('mana-membrane'),
    name: '마나 피막',
    description: '마나 동전 뒷면마다 방어 1을 얻는다. 턴당 최대 3',
    exclusiveTo: character('arcanist'),
    element: 'mana',
    hook: 'turnStart',
    effects: [],
    mechanic: 'manaMembrane',
    price: 80
  },
  'blue-circuit': {
    id: passive('blue-circuit'),
    name: '청색 순환로',
    description: '턴당 1회, 한 스킬로 마나 동전을 2개 이상 소비하면 버림 더미에 임시 마나 동전 1개를 생성합니다',
    exclusiveTo: character('arcanist'),
    element: 'mana',
    hook: 'turnStart',
    effects: [],
    mechanic: 'blueCircuit',
    price: 90
  },
  'armament-resonance': {
    id: passive('armament-resonance'),
    name: '병장 공명로',
    description: '마나 동전을 누적 3개 소비할 때마다 병기 출력 +1',
    exclusiveTo: character('arcanist'),
    element: 'mana',
    hook: 'combatStart',
    effects: [],
    mechanic: 'armamentResonance',
    price: 110
  },
  // P9 번개 결투사 전용 패시브 8종. 조건부 mechanic은 전투 엔진에서
  // 설명과 동일한 타이밍·횟수 제한으로 직접 처리한다.
  'duelist-reserve-coin': {
    id: passive('duelist-reserve-coin'),
    name: '예비 주화',
    description: '전투 시작 시 임시 기본 동전 1개를 손에 추가한다',
    exclusiveTo: character('sorcerer'),
    element: null,
    hook: 'combatStart',
    effects: [{ kind: 'addCoin', coin: coin('basic'), zone: 'hand', count: 1 }],
    price: 70
  },
  'continuous-motion': {
    id: passive('continuous-motion'),
    name: '연속 동작',
    description: '매 턴 첫 르미즈 반복 후 동전 1개를 뽑는다',
    exclusiveTo: character('sorcerer'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'continuousMotion',
    price: 80
  },
  'retrieval-habit': {
    id: passive('retrieval-habit'),
    name: '회수 습관',
    description: '매 턴 첫 르미즈 반복이 성립하면 원본 스킬의 첫 동전을 뽑을 더미 맨 위로 돌려보낸다',
    exclusiveTo: character('sorcerer'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'retrievalHabit',
    price: 80
  },
  'balance-sense': {
    id: passive('balance-sense'),
    name: '균형 감각',
    description: '매 턴 처음 앞면과 뒷면이 함께 나오면 방어 3을 얻는다',
    exclusiveTo: character('sorcerer'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'balanceSense',
    price: 70
  },
  'last-move': {
    id: passive('last-move'),
    name: '마지막 한 수',
    description: '마지막 손패 동전으로 쓴 스킬의 피해 또는 방어가 2 증가한다',
    exclusiveTo: character('sorcerer'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'lastMove',
    price: 80
  },
  'residual-charge': {
    id: passive('residual-charge'),
    name: '잔류 전하',
    description: '매 턴 처음 쓴 번개 동전을 버리지 않고 뽑을 더미 위로 보낸다',
    exclusiveTo: character('sorcerer'),
    element: 'lightning',
    hook: 'combatStart',
    effects: [],
    mechanic: 'residualCharge',
    price: 90
  },
  overcurrent: {
    id: passive('overcurrent'),
    name: '과전류',
    description: '매 턴 첫 르미즈 반복 공격은 피해 2와 감전 1을 추가한다',
    exclusiveTo: character('sorcerer'),
    element: 'lightning',
    hook: 'turnStart',
    effects: [],
    mechanic: 'overcurrent',
    price: 100
  },
  'discharge-suppression': {
    id: passive('discharge-suppression'),
    name: '방전 억제',
    description: '턴 종료 시 감전이 가장 높은 적의 감전이 감소하지 않는다',
    exclusiveTo: character('sorcerer'),
    element: 'lightning',
    hook: 'combatStart',
    effects: [],
    mechanic: 'dischargeSuppression',
    price: 100
  },
  // ── P11 냉기 도적: 범용 5 + 냉기 3 ──
  'coin-appraiser': {
    id: passive('coin-appraiser'),
    name: '감별사의 엄지',
    description: '전투 시작 시 냉기 동전 1개를 뽑는다. 없으면 기본 동전을 뽑는다',
    exclusiveTo: character('frost-knight'),
    element: null,
    hook: 'combatStart',
    effects: [],
    mechanic: 'coinAppraiser',
    price: 80
  },
  'small-change-insurance': {
    id: passive('small-change-insurance'),
    name: '잔돈 보험',
    description: '매 턴 첫 뒷면에 방어 2를 얻는다',
    exclusiveTo: character('frost-knight'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'smallChangeInsurance',
    price: 70
  },
  'double-entry-ledger': {
    id: passive('double-entry-ledger'),
    name: '양면 장부',
    description: '한 턴에 앞면과 뒷면이 나오면 기본 동전 1개를 뽑는다. 턴당 1회',
    exclusiveTo: character('frost-knight'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'doubleEntry',
    price: 90
  },
  'matured-hand': {
    id: passive('matured-hand'),
    name: '숙성된 패',
    description: '매 턴 첫 보존 동전 스킬의 기존 피해와 방어가 2 증가한다',
    exclusiveTo: character('frost-knight'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'maturedHand',
    price: 90
  },
  'profit-settlement': {
    id: passive('profit-settlement'),
    name: '손익 정산',
    description: '매 턴 첫 동전 소비 후 다음 턴 뽑기 +1',
    exclusiveTo: character('frost-knight'),
    element: null,
    hook: 'turnStart',
    effects: [],
    mechanic: 'profitSettlement',
    price: 80
  },
  'cold-hands': {
    id: passive('cold-hands'),
    name: '차가운 손버릇',
    description: '매 턴 첫 보존 냉기 동전 사용/소비 시 현재 대상에게 동상 1',
    exclusiveTo: character('frost-knight'),
    element: 'frost',
    hook: 'turnStart',
    effects: [],
    mechanic: 'coldHands',
    price: 90
  },
  'frost-compound': {
    id: passive('frost-compound'),
    name: '서리 복리',
    description: '매 턴 처음 동상인 적에게 주는 공격 피해 +3',
    exclusiveTo: character('frost-knight'),
    element: 'frost',
    hook: 'turnStart',
    effects: [],
    mechanic: 'frostCompound',
    price: 100
  },
  'refrozen-loot': {
    id: passive('refrozen-loot'),
    name: '되얼린 장물',
    description: '냉기 동전을 한 번에 2개 이상 소비하면 손에 임시 냉기 동전 1개. 턴당 1회',
    exclusiveTo: character('frost-knight'),
    element: 'frost',
    hook: 'turnStart',
    effects: [],
    mechanic: 'refrozenLoot',
    price: 100
  },
  'concentrated-blood-orb': {
    id: passive('concentrated-blood-orb'),
    name: '농축 혈구',
    description: '매 턴 처음 플립한 혈액 동전의 고유 효과가 1 증가한다',
    exclusiveTo: character('blood-spellblade'),
    element: 'blood',
    hook: 'turnStart',
    effects: [],
    mechanic: 'concentratedBlood',
    price: 80
  },
  'sword-dividend': {
    id: passive('sword-dividend'),
    name: '검의 배당',
    description: '혈액 동전을 혈마검에 투자하면 실제 투자량만큼 방어를 얻는다. 최대 5',
    exclusiveTo: character('blood-spellblade'),
    element: 'blood',
    hook: 'combatStart',
    effects: [],
    mechanic: 'bloodSwordDividend',
    price: 100
  },
  'red-reflux': {
    id: passive('red-reflux'),
    name: '붉은 환류',
    description: '매 턴 처음 동전을 소비하면 임시 혈액 동전 1개를 버림 더미에 추가한다',
    exclusiveTo: character('blood-spellblade'),
    element: 'blood',
    hook: 'turnStart',
    effects: [],
    mechanic: 'redReflux',
    price: 110
  }
} satisfies Record<string, PassiveDef>;

// P4.4 D10 이벤트 4종 — 수치 전부 balance-provisional.
export const events = {
  'ambush-bounty': {
    id: event('ambush-bounty'),
    name: '매복 현상금',
    prompt: '위험한 현상금 표식이 길을 막는다.',
    risk: 'combat',
    elitePool: [[enemy('raider-plus')], [enemy('gatekeeper-plus')]],
    goldReward: 70,
    rareSkillOptions: 2
  },
  'blood-offering': {
    id: event('blood-offering'),
    name: '피의 제물',
    prompt: '피를 바치면 주머니가 대표 속성으로 응답한다.',
    risk: 'hp',
    hpCost: 5,
    requireCurrentHpAbove: 5,
    reward: { kind: 'signatureCoin', count: 1 }
  },
  'transmute-altar': {
    id: event('transmute-altar'),
    name: '변환 제단',
    prompt: '금화가 기본 코인을 대표 속성 코인으로 영구 변환한다.',
    risk: 'gold',
    goldCost: 100,
    transform: { from: coin('basic'), to: 'signatureCoin' }
  },
  'coin-sacrifice': {
    id: event('coin-sacrifice'),
    name: '동전 희생',
    prompt: '기본 코인 하나를 잃고 대표 속성 코인을 얻는다.',
    risk: 'coin',
    sacrifice: { coin: coin('basic'), reward: 'signatureCoin', minimumBagSize: 1 }
  }
} satisfies Record<string, EventDef>;

export const contentDb: ContentDb = {
  coins,
  enchants,
  skills,
  enemies,
  characters,
  events,
  passives,
  equipment,
  validate: shouldValidateContent ? () => validateContentDb({ coins, enchants, skills, enemies, characters, events, passives, equipment }) : () => []
};
