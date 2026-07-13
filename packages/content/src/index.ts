import type { CharacterId, CoinDefId, EnemyDefId, EquipmentDefId, EventDefId, PassiveId, SkillId } from '@game/core';
import { validateContentDb } from '@game/core';
import type { CharacterDef, CoinDef, ContentDb, EnemyDef, EquipmentDef, EventDef, PassiveDef, SkillDef } from '@game/core';

// P3.2 승격: 수호자·마나 스킬·exclusiveTo 시대. m5 콘텐츠는 현 버전의 부분집합이고
// 기존 수치가 불변이므로 m5 저장은 안전하게 로드(마이그레이션)할 수 있다.
export const CONTENT_VERSION = '1.4.0-p10';
export const LEGACY_CONTENT_VERSIONS: readonly string[] = ['1.3.0-p9', '1.2.0-p7', '1.1.0-p6', '1.0.0-rc.1', '0.10.0-p4.4', '0.9.0-p4', '0.8.0-p3.4', '0.7.0-p3.3', '0.6.0-p3.2', '0.5.0-m5'];
// p4→p4.4 호환 근거: 이벤트 4종 가산·기존 플레이어/전투 콘텐츠 수치 불변.
// p3.4→p4 호환 근거: 몬스터 6종 가산뿐(플레이어 콘텐츠·기존 수치 불변)이라 기존 저장의
// 모든 참조가 유효하다. 신규 적은 신규 조우(P4.2+ 그래프)에서만 등장한다.
// p3.2→p3.3 호환 근거: 스킬 3종 가산뿐(수치 불변)이라 기존 저장의 모든 참조가 유효하다.
// rewards 저장의 유일한 위험 형상(공용 풀 소진 fallback)은 p3.2 실콘텐츠에서 도달 불가
// (전사 공용 9종 − 장착 6 = 미보유 ≥3 ≥ 2) — 공허 엣지, run-storage 테스트로 고정.

const coin = (value: string) => value as CoinDefId;
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
      heads: [{ kind: 'heal', amount: 1 }],
      tails: [{ kind: 'block', amount: 1 }]
    }
  }
} satisfies Record<string, CoinDef>;

export const skills = {
  slash: {
    id: skill('slash'),
    name: '베기',
    upgrade: { name: '단련된 베기', description: '기본 피해 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } },
    type: 'flip',
    rarity: 'common',
    tags: ['attack'],
    targetType: 'single-enemy',
    // P7 D2 — 반복 기본기 (쿨다운 0): 코인이 남는 한 같은 턴 반복 사용
    cooldown: 0,
    cost: 1,
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 3 }] }
  },
  guard: {
    id: skill('guard'),
    name: '방어',
    upgrade: { name: '견고한 방어', description: '기본 방어 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } },
    type: 'flip',
    rarity: 'common',
    tags: ['defense'],
    targetType: 'self',
    cooldown: 0,
    cost: 1,
    base: [{ kind: 'block', amount: 4 }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] }
  },
  'burning-strike': {
    id: skill('burning-strike'),
    name: '불타는 일격',
    upgrade: { name: '여열', description: '사용 시 임시 화염 코인 1개를 추가로 만든다', patch: { kind: 'addCoinOnUse', coin: coin('fire'), zone: 'discard', count: 1 } },
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
  // ── P9 번개 결투사: 르미즈 5종 + 감전 처형 5종 ──
  attaque: {
    id: skill('attaque'), name: '아따끄', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cooldown: 1, cost: 1,
    base: [{ kind: 'damage', amount: 6 }]
  },
  parade: {
    id: skill('parade'), name: '빠라드', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'common', tags: ['defense', 'utility'], targetType: 'self', cooldown: 2, cost: 2,
    base: [{ kind: 'block', amount: 6 }],
    heads: { mode: 'per', effects: [{ kind: 'draw', count: 1 }] },
    tails: { mode: 'per', effects: [{ kind: 'addCoin', coin: coin('lightning'), zone: 'draw', count: 1 }] }
  },
  fente: {
    id: skill('fente'), name: '팡트', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cooldown: 1, cost: 1,
    base: [{ kind: 'damage', amount: 5 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'damage', amount: 1 }] },
    remise: { returnFirstCoinOnReuse: true }
  },
  'parade-riposte': {
    id: skill('parade-riposte'), name: '파라드-리포스트', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'common', tags: ['attack', 'defense'], targetType: 'single-enemy', cooldown: 1, cost: 1,
    base: [{ kind: 'block', amount: 5 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] }
  },
  redoublement: {
    id: skill('redoublement'), name: '레두블망', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'advanced', tags: ['utility'], targetType: 'self', cooldown: 3, cost: 2,
    base: [{ kind: 'readyRemise' }],
    heads: { mode: 'any', effects: [{ kind: 'draw', count: 1 }] },
    tails: { mode: 'any', effects: [{ kind: 'addCoin', coin: coin('lightning'), zone: 'discard', count: 1 }] },
    upgrade: { name: '강화', description: '추가 르미즈 기회 +1 → +2', patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'readyRemise', amount: 2 } } }
  },
  fleche: {
    id: skill('fleche'), name: '플레슈', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cooldown: 2, cost: 2,
    base: [{ kind: 'damage', amount: 8 }, { kind: 'damageIfReused', amount: 4 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'any', effects: [{ kind: 'draw', count: 1 }] }
  },
  'attaque-composee': {
    id: skill('attaque-composee'), name: '아타크 콩포제', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'rare', tags: ['attack', 'ultimate'], targetType: 'single-enemy', cooldown: 4, cost: 3,
    base: [{ kind: 'damage', amount: 10 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    remise: { reuseOnReflipTails: true, addLightningToHandAfterReuse: 1 },
    upgrade: { name: '강화', description: '재사용 후 임시 번개 코인 1개 → 2개', patch: { kind: 'setRemiseLightningCount', count: 2 } }
  },
  'charge-mark': {
    id: skill('charge-mark'), name: '전하 각인', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cooldown: 1, cost: 1,
    base: [{ kind: 'damage', amount: 3 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' }] },
    tails: { mode: 'any', effects: [{ kind: 'damageIfTargetShocked', amount: 2 }] },
    upgrade: { name: '강화', description: '앞면 감전 1 → 2', patch: { kind: 'replaceEffect', section: 'heads', index: 0, effect: { kind: 'applyStatus', status: 'shock', stacks: 2, to: 'target' } } }
  },
  'capacitor-shield': {
    id: skill('capacitor-shield'), name: '축전 방패', exclusiveTo: character('sorcerer'),
    type: 'consume', rarity: 'common', tags: ['defense'], targetType: 'single-enemy', cooldown: 2,
    consume: { element: 'lightning', count: 1 }, effects: [{ kind: 'blockPerTargetShock', base: 7, cap: 5 }],
    upgrade: { name: '강화', description: '기본 방어 7 → 8, 감전 상한 5 → 8', patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'blockPerTargetShock', base: 8, cap: 8 } } }
  },
  superconduct: {
    id: skill('superconduct'), name: '과전도', exclusiveTo: character('sorcerer'),
    type: 'consume', rarity: 'advanced', tags: ['utility'], targetType: 'single-enemy', oncePerCombat: true,
    consume: { element: 'lightning', count: 2 }, effects: [{ kind: 'doubleTargetShock' }],
    upgrade: { name: '강화', description: '일회성 제거, 쿨타임 4', patch: { kind: 'removeOncePerCombat', cooldown: 4 } }
  },
  'overload-flurry': {
    id: skill('overload-flurry'), name: '과부하 연격', exclusiveTo: character('sorcerer'),
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cooldown: 2, cost: 2,
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'applyStatus', status: 'shock', stacks: 2, to: 'target' }] },
    tails: { mode: 'per', effects: [{ kind: 'damageIfTargetShocked', amount: 2 }] },
    upgrade: { name: '강화', description: '기본 피해 4 → 6', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'thunder-execution': {
    id: skill('thunder-execution'), name: '뇌정 처형', exclusiveTo: character('sorcerer'),
    type: 'consume', rarity: 'rare', tags: ['attack', 'ultimate'], targetType: 'single-enemy', oncePerCombat: true,
    consume: { element: 'lightning', count: 3 }, effects: [{ kind: 'executeOrDischargeShock' }],
    upgrade: { name: '강화', description: '번개 코인 소비 3개 → 2개', patch: { kind: 'costDelta', delta: -1 } }
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
  },
  // ── P6 D5 — 화염 격투가 스킬 (exclusiveTo warrior, balance-provisional) ──
  jab: {
    id: skill('jab'),
    name: '정권',
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cooldown: 0, cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 3 }] },
    upgrade: { name: '묵직한 정권', description: '기본 피해 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'fist-guard': {
    id: skill('fist-guard'),
    name: '가드',
    type: 'flip', rarity: 'common', tags: ['defense'], targetType: 'self', cooldown: 0, cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'block', amount: 4 }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] },
    upgrade: { name: '철벽 가드', description: '기본 방어 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'burning-fist': {
    id: skill('burning-fist'),
    name: '불꽃 스트레이트',
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 2,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damage', amount: 8 },
      { kind: 'addCoin', coin: coin('fire'), zone: 'discard', count: 1 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] },
    upgrade: { name: '불꽃 원투', description: '사용 시 임시 화염 코인 1개 추가 생성', patch: { kind: 'addCoinOnUse', coin: coin('fire'), zone: 'discard', count: 1 } }
  },
  'flame-hook': {
    id: skill('flame-hook'),
    name: '불씨권',
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 1,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damage', amount: 5 }
    ],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }, { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }] },
    elementFaces: [
      { element: 'fire', face: 'heads', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] },
      { element: 'fire', face: 'tails', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] }
    ],
    // P10: 최신 통합안에서 강화 수치는 미정이다.
  },
  'ember-weave': {
    id: skill('ember-weave'),
    name: '잿불 위빙',
    type: 'flip', rarity: 'common', tags: ['defense'], targetType: 'self', cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'block', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'hand', count: 1 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] },
    elementFaces: [
      { element: 'fire', face: 'heads', effects: [{ kind: 'block', amount: 1 }] },
      { element: 'fire', face: 'tails', effects: [{ kind: 'block', amount: 1 }] }
    ],
    upgrade: { name: '흐르는 위빙', description: '앞면 임시 화염 코인 1개 → 2개', patch: { kind: 'replaceEffect', section: 'heads', index: 0, effect: { kind: 'addCoin', coin: coin('fire'), zone: 'hand', count: 2 } } }
  },
  'second-wind': {
    id: skill('second-wind'),
    name: '들숨 고르기',
    type: 'flip', rarity: 'advanced', tags: ['utility'], targetType: 'self', oncePerCombat: true, cost: 1,
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
    type: 'flip', rarity: 'advanced', tags: ['utility'], targetType: 'all-enemies', oncePerCombat: true, cost: 2,
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
    name: '회전 연화각',
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'all-enemies', cost: 2,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 3 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] },
    elementFaces: [{ element: 'fire', face: 'heads', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }] }],
    upgrade: { name: '폭풍 연화각', description: '기본 피해 3 → 4', patch: { kind: 'baseAmount', index: 0, delta: 1 } }
  },
  'burnout-blow': {
    id: skill('burnout-blow'),
    name: '폭렬권',
    type: 'consume', rarity: 'rare', tags: ['attack', 'ultimate'], targetType: 'single-enemy', oncePerCombat: true,
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
    type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'single-enemy', cooldown: 3, cost: 1,
    exclusiveTo: character('warrior'),
    requiredElement: 'fire',
    base: [{ kind: 'enterOverheat' }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 5 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] },
    // P10: 기존 임시 강화안은 폐기됐으며 대체 강화안은 미정이다.
  },
  'fire-fist': {
    id: skill('fire-fist'),
    name: '화격권',
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cooldown: 1, cost: 2,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'addCoin', coin: coin('fire'), zone: 'draw', count: 1 },
      { kind: 'damage', amount: 10 }
    ],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 1 }] },
    // 화염 코인 앞면은 일반 앞면 +1과 합산해 +2 (v1.3 표기 그대로)
    elementFaces: [{ element: 'fire', face: 'heads', effects: [{ kind: 'damage', amount: 1 }] }],
    overheatBonus: [{ kind: 'damage', amount: 4 }],
    upgrade: { name: '단조 정권', description: '과열 피해 14 → 16', patch: { kind: 'replaceEffect', section: 'overheat', index: 0, effect: { kind: 'damage', amount: 6 } } }
  },
  'overheat-strike': {
    id: skill('overheat-strike'),
    name: '과열권',
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cooldown: 1, cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 2 }] },
    overheatBonus: [{ kind: 'damage', amount: 4 }],
    upgrade: { name: '초과열권', description: '기본 피해 +3', patch: { kind: 'baseAmount', index: 0, delta: 3 } }
  },
  'overheat-vent': {
    id: skill('overheat-vent'),
    name: '배기 폭발',
    type: 'flip', rarity: 'rare', tags: ['attack'], targetType: 'single-enemy', oncePerCombat: true, cost: 2,
    exclusiveTo: character('warrior'),
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
    type: 'flip', rarity: 'rare', tags: ['attack'], targetType: 'single-enemy', cooldown: 2, cost: 4,
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
    type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cooldown: 0, cost: 1,
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
    type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cooldown: 0, cost: 2,
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
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cost: 2,
    exclusiveTo: character('arcanist'),
    base: [
      { kind: 'block', amount: 4 },
      { kind: 'damagePerBlock', amountPerBlock: 1 }
    ],
    upgrade: { name: '공명 방벽', description: '기본 방어 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'armor-counter': {
    id: skill('armor-counter'), name: '마력 반격', exclusiveTo: character('arcanist'),
    type: 'flip', rarity: 'common', tags: ['attack', 'defense'], targetType: 'single-enemy', cooldown: 1, cost: 2,
    base: [{ kind: 'damage', amount: 8 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '강화', description: '뒷면 방어 +2 → +3', patch: { kind: 'replaceEffect', section: 'tails', index: 0, effect: { kind: 'block', amount: 3 } } }
  },
  'armor-compression': {
    id: skill('armor-compression'), name: '갑주 축압', exclusiveTo: character('arcanist'),
    type: 'flip', rarity: 'common', tags: ['defense', 'utility'], targetType: 'self', cooldown: 1, cost: 2,
    base: [{ kind: 'block', amount: 7 }],
    heads: { mode: 'per', effects: [{ kind: 'prepareNextAttackDamage', amount: 2 }] },
    tails: { mode: 'per', effects: [{ kind: 'block', amount: 3 }] },
    upgrade: { name: '강화', description: '앞면과 뒷면이 모두 나오면 임시 마나 코인 1개를 손에 추가', patch: { kind: 'addMixedFaceEffect', effect: { kind: 'addCoin', coin: coin('mana'), zone: 'hand', count: 1 } } }
  },
  'mana-amplification': {
    id: skill('mana-amplification'), name: '마력 증폭막', exclusiveTo: character('arcanist'),
    type: 'consume', rarity: 'advanced', tags: ['defense'], targetType: 'self', cooldown: 1,
    consume: { element: 'mana', count: 2 },
    effects: [{ kind: 'blockFromCurrent', cap: 10 }],
    upgrade: { name: '강화', description: '마나 코인 소비 2개 → 1개', patch: { kind: 'costDelta', delta: -1 } }
  },
  'armor-smash': {
    id: skill('armor-smash'), name: '갑주 강타', exclusiveTo: character('arcanist'),
    type: 'consume', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cooldown: 1,
    consume: { element: 'mana', count: 2 },
    effects: [{ kind: 'damagePlusBlock', base: 6, cap: 10 }],
    upgrade: { name: '강화', description: '방어 추가 피해 상한 10 → 14', patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'damagePlusBlock', base: 6, cap: 14 } } }
  },
  'arcane-armor-release': {
    id: skill('arcane-armor-release'), name: '마도 갑주 해방', exclusiveTo: character('arcanist'),
    type: 'consume', rarity: 'rare', tags: ['defense', 'ultimate'], targetType: 'self', oncePerCombat: true,
    consume: { element: 'mana', count: 3 },
    effects: [{ kind: 'block', amount: 10 }, { kind: 'scheduleEndTurnBlockAoe', cap: 18 }],
    upgrade: { name: '강화', description: '전투당 1회 제한 제거', patch: { kind: 'removeOncePerCombat', cooldown: 1 } }
  },
  'shield-summon': {
    id: skill('shield-summon'),
    name: '방패 전개',
    type: 'flip', rarity: 'common', tags: ['defense'], targetType: 'self', cost: 1,
    exclusiveTo: character('arcanist'),
    base: [{ kind: 'summonEquipment', equipment: equip('mana-shield'), duration: 2 }],
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 2 }] },
    upgrade: { name: '겹겹 전개', description: '앞면 방어 +2 효과 추가', patch: { kind: 'addFaceEffect', face: 'heads', effect: { kind: 'block', amount: 2 } } }
  },
  // 마력 갑주 빌드 (방어 참조/피해화 — 방어 비소모, '반격' 어휘 미사용)
  'mirror-plate': {
    id: skill('mirror-plate'),
    name: '마력 반사판',
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cost: 1,
    exclusiveTo: character('arcanist'),
    base: [{ kind: 'damagePerBlock', amountPerBlock: 1 }],
    upgrade: { name: '집속 반사판', description: '앞면 피해 +4 효과 추가', patch: { kind: 'addFaceEffect', face: 'heads', effect: { kind: 'damage', amount: 4 } } }
  },
  'bulwark-charge': {
    id: skill('bulwark-charge'),
    name: '성채 돌진',
    type: 'consume', rarity: 'rare', tags: ['attack'], targetType: 'single-enemy',
    exclusiveTo: character('arcanist'),
    consume: { element: 'mana', count: 2 },
    effects: [
      { kind: 'block', amount: 6 },
      { kind: 'damagePerBlock', amountPerBlock: 1 }
    ],
    upgrade: { name: '요새 돌진', description: '기본 방어 +3', patch: { kind: 'baseAmount', index: 0, delta: 3 } }
  },
  // 마나 병기 빌드 (소환 강화/유지)
  'weapon-tuning': {
    id: skill('weapon-tuning'),
    name: '병기 조율',
    type: 'flip', rarity: 'advanced', tags: ['utility'], targetType: 'self', cost: 1,
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
    type: 'flip', rarity: 'rare', tags: ['utility'], targetType: 'self', oncePerCombat: true, cost: 2,
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
    type: 'flip', rarity: 'rare', tags: ['utility'], targetType: 'self', cooldown: 2, cost: 4,
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
    id: skill('alchemy-slash'), name: '연성 참격', exclusiveTo: character('arcanist'),
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cooldown: 1, cost: 2,
    base: [{ kind: 'damage', amount: 8 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 3 }] },
    tails: { mode: 'any', effects: [{ kind: 'increaseWeaponOutput', amount: 1 }] },
    upgrade: { name: '강화', description: '뒷면 하나라도 +1 → 뒷면마다 +1', patch: { kind: 'setFaceMode', face: 'tails', mode: 'per' } }
  },
  'diffusion-mark': {
    id: skill('diffusion-mark'), name: '확산 각인', exclusiveTo: character('arcanist'),
    type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cooldown: 1, cost: 2,
    base: [{ kind: 'grantChosenSummonAoe', uses: 1, usesPerHeads: 1 }],
    tails: { mode: 'per', effects: [{ kind: 'extendChosenSummon', amount: 1 }] },
    upgrade: { name: '강화', description: '앞면과 뒷면이 모두 나오면 임시 마나 코인 1개를 손에 추가', patch: { kind: 'addMixedFaceEffect', effect: { kind: 'addCoin', coin: coin('mana'), zone: 'hand', count: 1 } } }
  },
  'reactor-overdrive': {
    id: skill('reactor-overdrive'), name: '마력로 과급', exclusiveTo: character('arcanist'),
    type: 'consume', rarity: 'advanced', tags: ['utility'], targetType: 'self', cooldown: 2,
    consume: { element: 'mana', count: 2 }, effects: [{ kind: 'increaseWeaponOutput', amount: 2 }, { kind: 'extendAllSummons', amount: 1 }],
    upgrade: { name: '강화', description: '마나 코인 소비 2개 → 1개', patch: { kind: 'costDelta', delta: -1 } }
  },
  'arcane-duplicate': {
    id: skill('arcane-duplicate'), name: '마도식 복제', exclusiveTo: character('arcanist'),
    type: 'consume', rarity: 'advanced', tags: ['utility'], targetType: 'self', cooldown: 2,
    consume: { element: 'mana', count: 2 }, effects: [{ kind: 'cloneChosenSummon', duration: 2, fullCapExtension: 2 }],
    upgrade: { name: '강화', description: '복제 지속 2 → 3, 소환 한도에서는 지속 +3', patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'cloneChosenSummon', duration: 3, fullCapExtension: 3 } } }
  },
  'azure-armory-open': {
    id: skill('azure-armory-open'), name: '청람 병장개문', exclusiveTo: character('arcanist'),
    type: 'flip', rarity: 'rare', tags: ['attack', 'ultimate'], targetType: 'all-enemies', oncePerCombat: true, cost: 3,
    base: [{ kind: 'virtualManaSwordVolley', baseDamage: 3 }],
    upgrade: { name: '강화', description: '임시 마나 검 기본 수 3 → 4', patch: { kind: 'replaceEffect', section: 'base', index: 0, effect: { kind: 'virtualManaSwordVolley', baseDamage: 3, baseCount: 4 } } }
  },
  // ── P7 D3 — 공용 드로우/쿨다운 유틸리티 (고비용 턴 셋업 지원) ──
  'battle-focus': {
    id: skill('battle-focus'),
    name: '전투 집중',
    type: 'flip', rarity: 'advanced', tags: ['utility'], targetType: 'self', cooldown: 2, cost: 1,
    base: [{ kind: 'draw', count: 2 }],
    heads: { mode: 'any', effects: [{ kind: 'nextTurnDraw', count: 1 }] },
    upgrade: { name: '보급 집중', description: '사용 시 임시 기본 코인 1개를 손에 만든다', patch: { kind: 'addCoinOnUse', coin: coin('basic'), zone: 'hand', count: 1 } }
  },
  'regroup': {
    id: skill('regroup'),
    name: '재정비',
    type: 'flip', rarity: 'advanced', tags: ['utility'], targetType: 'self', cooldown: 3, cost: 1,
    // 쿨다운 감소는 자기 슬롯 제외(P7 D1) — 반복·전투당 1회 스킬은 구조적으로 비대상
    base: [
      { kind: 'reduceCooldown', amount: 1 },
      { kind: 'draw', count: 1 }
    ],
    upgrade: { name: '신속 재정비', description: '사용 시 임시 기본 코인 1개를 뽑기 더미에 만든다', patch: { kind: 'addCoinOnUse', coin: coin('basic'), zone: 'draw', count: 1 } }
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
    // P7 D2 — 시작 4스킬: 반복 기본기 2 + 캐릭터 스킬 2 (버닝 스트라이크 + 과열 인에이블러)
    startingSkills: [
      skill('jab'),
      skill('fist-guard'),
      skill('burning-fist'),
      skill('flame-hook')
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
      skill('mana-bulwark')
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
    name: '번개 결투사',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('lightning'), coin('lightning')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('attaque'),
      skill('parade')
    ],
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
    name: '냉기 기사',
    maxHp: 70,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('frost'), coin('frost')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('frost-slash'),
      skill('glacial-wall')
    ],
    trait: {
      id: 'winter-mantle',
      name: '겨울 외투',
      hook: 'combatStart',
      effects: [{ kind: 'addCoin', coin: coin('frost'), zone: 'draw', count: 1 }]
    }
  }
  ,
  // P6 D6 — 마도기사 (guardian과 별도 신규 — 기존 빌드 보존 우선, 마나 속성 공유 첫 사례)
  arcanist: {
    id: character('arcanist'),
    name: '마도기사',
    maxHp: 65,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('mana'), coin('mana')],
    // P7 D2 — 시작 4스킬: 기본기 2 + 마력 충전 + 명령
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('arcane-charge'),
      skill('arcane-command')
    ],
    trait: {
      id: 'arcane-atelier',
      name: '마도 공방',
      hook: 'turnStart',
      effects: [{ kind: 'summonEquipment', equipment: equip('mana-sword'), duration: 1 }]
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
    id: passive('iron-body'), name: '강철 피부', description: '전투 시작 시 방어 5를 얻는다',
    exclusiveTo: character('warrior'), element: null, hook: 'combatStart',
    effects: [{ kind: 'block', amount: 5 }], price: 70
  },
  'steady-breath': {
    id: passive('steady-breath'), name: '방패 숙련', description: '방어 스킬로 얻는 방어가 1 증가한다',
    exclusiveTo: character('warrior'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'shieldMastery', price: 90
  },
  'reserve-coin': {
    id: passive('reserve-coin'), name: '빈틈없는 대비', description: '턴 종료 시 남은 동전 1개당 방어 1을 얻는다. 최대 2',
    exclusiveTo: character('warrior'), element: null, hook: 'combatStart',
    effects: [], mechanic: 'preparedStance', price: 60
  },
  'opening-stance': {
    id: passive('opening-stance'), name: '불굴의 투지', description: '매 턴 처음 받는 피해를 1 감소시킨다',
    exclusiveTo: character('warrior'), element: null, hook: 'combatStart',
    effects: [], mechanic: 'indomitableSpirit', price: 70
  },
  'thick-hide': {
    id: passive('thick-hide'), name: '전투 호흡', description: '전투마다 처음 체력이 50% 이하가 되면 체력을 3 회복한다',
    exclusiveTo: character('warrior'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'combatBreathing', price: 80
  },
  // ── 화염 격투가: 화염 3 (화상 보조) ──
  'ember-stock': {
    id: passive('ember-stock'), name: '발화 본능', description: '매 턴 처음 적에게 부여하는 화상이 1 증가한다',
    exclusiveTo: character('warrior'), element: 'fire', hook: 'combatStart',
    effects: [], mechanic: 'ignitionInstinct', price: 80
  },
  'kindling-rhythm': {
    id: passive('kindling-rhythm'), name: '잔불 칼날', description: '공격에 사용한 화염 동전이 뒷면이면 대상에게 화상 1을 부여한다',
    exclusiveTo: character('warrior'), element: 'fire', hook: 'turnStart',
    effects: [], mechanic: 'emberBlade', price: 90
  },
  'flame-opening': {
    id: passive('flame-opening'), name: '뜨거운 방벽', description: '화상을 부여한 턴 종료 시 방어 2를 얻는다',
    exclusiveTo: character('warrior'), element: 'fire', hook: 'turnStart',
    effects: [], mechanic: 'hotBarrier', price: 100
  },
  // ── 마도기사: 마력 갑주 2 + 마나 병기 2 ──
  'armor-memory': {
    id: passive('armor-memory'), name: '전개 예습', description: '전투 중 처음 소환하는 장비의 소환 +1',
    exclusiveTo: character('arcanist'), element: null, hook: 'combatStart',
    effects: [], mechanic: 'previewDeployment', price: 70
  },
  'drill-discipline': {
    id: passive('drill-discipline'), name: '역상 방호식', description: '턴당 1회, 하나의 스킬에서 뒷면이 2개 이상 나오면 방어 3',
    exclusiveTo: character('arcanist'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'inverseGuard', price: 80
  },
  'overcharge-core': {
    id: passive('overcharge-core'), name: '교차 연산', description: '매 턴 처음 앞면과 뒷면이 함께 나오면 임시 기본 동전 1개를 손에 추가한다',
    exclusiveTo: character('arcanist'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'crossCalculation', price: 100
  },
  'mana-reserve': {
    id: passive('mana-reserve'), name: '잔류식 재구축', description: '장비가 소멸하면 재구축을 얻습니다. 다음에 소환하는 장비의 소환 +1',
    exclusiveTo: character('arcanist'), element: null, hook: 'combatStart',
    effects: [], mechanic: 'residualRebuild', price: 80
  },
  'command-preservation': {
    id: passive('command-preservation'), name: '명령 보존식', description: '턴당 1회, 장비를 즉시 행동시킬 때 감소하는 소환 1을 무효로 합니다',
    exclusiveTo: character('arcanist'), element: null, hook: 'turnStart', effects: [], mechanic: 'commandPreservation', price: 90
  },
  'mana-membrane': {
    id: passive('mana-membrane'), name: '마나 피막', description: '마나 동전 뒷면마다 방어 1을 얻는다. 턴당 최대 3',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'turnStart', effects: [], mechanic: 'manaMembrane', price: 80
  },
  'blue-circuit': {
    id: passive('blue-circuit'), name: '청색 순환로', description: '턴당 1회, 한 스킬로 마나 동전을 2개 이상 소비하면 버림 더미에 임시 마나 동전 1개를 생성합니다',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'turnStart', effects: [], mechanic: 'blueCircuit', price: 90
  },
  'armament-resonance': {
    id: passive('armament-resonance'), name: '병장 공명로', description: '마나 동전을 누적 3개 소비할 때마다 병기 출력 +1',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'combatStart', effects: [], mechanic: 'armamentResonance', price: 110
  },
  // P9 번개 결투사 전용 패시브 8종. 조건부 mechanic은 전투 엔진에서
  // 설명과 동일한 타이밍·횟수 제한으로 직접 처리한다.
  'duelist-reserve-coin': {
    id: passive('duelist-reserve-coin'), name: '예비 주화', description: '전투 시작 시 임시 기본 동전 1개를 손에 추가한다',
    exclusiveTo: character('sorcerer'), element: null, hook: 'combatStart',
    effects: [{ kind: 'addCoin', coin: coin('basic'), zone: 'hand', count: 1 }], price: 70
  },
  'continuous-motion': {
    id: passive('continuous-motion'), name: '연속 동작', description: '매 턴 첫 무료 재사용 후 동전 1개를 뽑는다',
    exclusiveTo: character('sorcerer'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'continuousMotion', price: 80
  },
  'retrieval-habit': {
    id: passive('retrieval-habit'), name: '회수 습관', description: '매 턴 첫 재플립 동전을 뽑을 더미 위로 돌려보낸다',
    exclusiveTo: character('sorcerer'), element: null, hook: 'combatStart',
    effects: [], mechanic: 'retrievalHabit', price: 80
  },
  'balance-sense': {
    id: passive('balance-sense'), name: '균형 감각', description: '매 턴 처음 앞면과 뒷면이 함께 나오면 방어 3을 얻는다',
    exclusiveTo: character('sorcerer'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'balanceSense', price: 70
  },
  'last-move': {
    id: passive('last-move'), name: '마지막 한 수', description: '마지막 손패 동전으로 쓴 스킬의 피해 또는 방어가 2 증가한다',
    exclusiveTo: character('sorcerer'), element: null, hook: 'turnStart',
    effects: [], mechanic: 'lastMove', price: 80
  },
  'residual-charge': {
    id: passive('residual-charge'), name: '잔류 전하', description: '매 턴 처음 쓴 번개 동전을 버리지 않고 뽑을 더미 위로 보낸다',
    exclusiveTo: character('sorcerer'), element: 'lightning', hook: 'combatStart',
    effects: [], mechanic: 'residualCharge', price: 90
  },
  overcurrent: {
    id: passive('overcurrent'), name: '과전류', description: '번개 동전을 쓴 첫 무료 재사용 공격은 피해 2와 감전 1을 추가한다',
    exclusiveTo: character('sorcerer'), element: 'lightning', hook: 'turnStart',
    effects: [], mechanic: 'overcurrent', price: 100
  },
  'discharge-suppression': {
    id: passive('discharge-suppression'), name: '방전 억제', description: '턴 종료 시 감전이 가장 높은 적의 감전이 감소하지 않는다',
    exclusiveTo: character('sorcerer'), element: 'lightning', hook: 'combatStart',
    effects: [], mechanic: 'dischargeSuppression', price: 100
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
  skills,
  enemies,
  characters,
  events,
  passives,
  equipment,
  validate: () => validateContentDb({ coins, skills, enemies, characters, events, passives, equipment })
};
