import type { CharacterId, CoinDefId, EnemyDefId, EquipmentDefId, EventDefId, PassiveId, SkillId } from '@game/core';
import { validateContentDb } from '@game/core';
import type { CharacterDef, CoinDef, ContentDb, EnemyDef, EquipmentDef, EventDef, PassiveDef, SkillDef } from '@game/core';

// P3.2 승격: 수호자·마나 스킬·exclusiveTo 시대. m5 콘텐츠는 현 버전의 부분집합이고
// 기존 수치가 불변이므로 m5 저장은 안전하게 로드(마이그레이션)할 수 있다.
export const CONTENT_VERSION = '1.1.0-p6';
export const LEGACY_CONTENT_VERSIONS: readonly string[] = ['1.0.0-rc.1', '0.10.0-p4.4', '0.9.0-p4', '0.8.0-p3.4', '0.7.0-p3.3', '0.6.0-p3.2', '0.5.0-m5'];
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
    upgrade: { name: '단련된 베기', description: '기본 피해 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } },
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
    upgrade: { name: '견고한 방어', description: '기본 방어 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } },
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
  },
  // ── P6 D5 — 화염 격투가 스킬 (exclusiveTo warrior, balance-provisional) ──
  jab: {
    id: skill('jab'),
    name: '정권',
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 6 }],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 4 }] },
    upgrade: { name: '묵직한 정권', description: '기본 피해 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'fist-guard': {
    id: skill('fist-guard'),
    name: '가드',
    type: 'flip', rarity: 'common', tags: ['defense'], targetType: 'self', cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'block', amount: 5 }],
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
    name: '불꽃 훅',
    type: 'flip', rarity: 'common', tags: ['attack'], targetType: 'single-enemy', cost: 1,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damage', amount: 4 },
      { kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }
    ],
    heads: { mode: 'any', effects: [{ kind: 'damage', amount: 3 }] },
    upgrade: { name: '파고드는 훅', description: '기본 피해 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'ember-weave': {
    id: skill('ember-weave'),
    name: '잿불 위빙',
    type: 'flip', rarity: 'common', tags: ['defense'], targetType: 'self', cost: 1,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'block', amount: 4 }],
    heads: { mode: 'any', effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'hand', count: 1 }] },
    tails: { mode: 'any', effects: [{ kind: 'block', amount: 3 }] },
    upgrade: { name: '흐르는 위빙', description: '기본 방어 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
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
  'fire-flurry': {
    id: skill('fire-flurry'),
    name: '회전 연화각',
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'all-enemies', cost: 2,
    exclusiveTo: character('warrior'),
    base: [{ kind: 'damage', amount: 5 }],
    heads: { mode: 'per', effects: [{ kind: 'damage', amount: 2 }] },
    upgrade: { name: '폭풍 연화각', description: '기본 피해 +2', patch: { kind: 'baseAmount', index: 0, delta: 2 } }
  },
  'burnout-blow': {
    id: skill('burnout-blow'),
    name: '폭렬권',
    type: 'consume', rarity: 'rare', tags: ['attack'], targetType: 'single-enemy',
    exclusiveTo: character('warrior'),
    consume: { element: 'fire', count: 2 },
    effects: [
      { kind: 'damage', amount: 8 },
      { kind: 'damagePerTargetBurn', amountPerStack: 3 }
    ],
    upgrade: { name: '대폭렬권', description: '기본 피해 +4', patch: { kind: 'baseAmount', index: 0, delta: 4 } }
  },
  // 보조 아키타입: 과열 (P6 D5 — 손의 화염 코인 수 참조, 지속 상태 없음)
  'overheat-strike': {
    id: skill('overheat-strike'),
    name: '과열권',
    type: 'flip', rarity: 'advanced', tags: ['attack'], targetType: 'single-enemy', cost: 1,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damage', amount: 3 },
      { kind: 'damagePerFireInHand', amountPerCoin: 2 }
    ],
    upgrade: { name: '초과열권', description: '기본 피해 +3', patch: { kind: 'baseAmount', index: 0, delta: 3 } }
  },
  'overheat-vent': {
    id: skill('overheat-vent'),
    name: '배기 폭발',
    type: 'flip', rarity: 'rare', tags: ['attack'], targetType: 'single-enemy', oncePerCombat: true, cost: 2,
    exclusiveTo: character('warrior'),
    base: [
      { kind: 'damagePerFireInHand', amountPerCoin: 3 },
      { kind: 'applyStatus', status: 'burn', stacks: 2, to: 'target' }
    ],
    upgrade: { name: '전개 배기', description: '전투당 1회 제한 해제', patch: { kind: 'removeOncePerCombat' } }
  },
  // ── P6 D6 — 마도기사 스킬 (exclusiveTo arcanist, balance-provisional) ──
  'arcane-charge': {
    id: skill('arcane-charge'),
    name: '마력 충전',
    type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cost: 2,
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
    type: 'flip', rarity: 'common', tags: ['utility'], targetType: 'self', cost: 1,
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
    base: [{ kind: 'empowerSummons', amount: 1 }],
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
    startingSkills: [
      skill('jab'),
      skill('fist-guard'),
      skill('burning-fist'),
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
  ,
  // P6 D6 — 마도기사 (guardian과 별도 신규 — 기존 빌드 보존 우선, 마나 속성 공유 첫 사례)
  arcanist: {
    id: character('arcanist'),
    name: '마도기사',
    maxHp: 65,
    startingBag: [...Array.from({ length: 8 }, () => coin('basic')), coin('mana'), coin('mana')],
    startingSkills: [
      skill('slash'),
      skill('guard'),
      skill('arcane-charge'),
      skill('arcane-command'),
      skill('aegis-pulse'),
      skill('shield-summon')
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
    id: passive('iron-body'), name: '단단한 몸', description: '전투 시작 시 방어 6을 얻는다',
    exclusiveTo: character('warrior'), element: null, hook: 'combatStart',
    effects: [{ kind: 'block', amount: 6 }], price: 70
  },
  'steady-breath': {
    id: passive('steady-breath'), name: '잔잔한 호흡', description: '매 턴 시작 시 방어 2를 얻는다',
    exclusiveTo: character('warrior'), element: null, hook: 'turnStart',
    effects: [{ kind: 'block', amount: 2 }], price: 90
  },
  'reserve-coin': {
    id: passive('reserve-coin'), name: '예비 동전', description: '전투 시작 시 임시 기본 코인 1개를 뽑을 더미에 넣는다',
    exclusiveTo: character('warrior'), element: null, hook: 'combatStart',
    effects: [{ kind: 'addCoin', coin: coin('basic'), zone: 'draw', count: 1 }], price: 60
  },
  'opening-stance': {
    id: passive('opening-stance'), name: '선제 태세', description: '전투 시작 시 임시 기본 코인 1개를 손에 든다',
    exclusiveTo: character('warrior'), element: null, hook: 'combatStart',
    effects: [{ kind: 'addCoin', coin: coin('basic'), zone: 'hand', count: 1 }], price: 70
  },
  'thick-hide': {
    id: passive('thick-hide'), name: '두꺼운 가죽', description: '매 턴, 공격 스킬을 사용할 때마다 방어 1을 얻는다',
    exclusiveTo: character('warrior'), element: null, hook: 'turnStart',
    effects: [{ kind: 'addTurnTrigger', trigger: { id: 'thick-hide', hook: 'onAttackSkillResolved', effects: [{ kind: 'block', amount: 1 }] } }], price: 80
  },
  // ── 화염 격투가: 화염 3 (화상 보조) ──
  'ember-stock': {
    id: passive('ember-stock'), name: '불씨 비축', description: '전투 시작 시 임시 화염 코인 1개를 뽑을 더미에 넣는다',
    exclusiveTo: character('warrior'), element: 'fire', hook: 'combatStart',
    effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'draw', count: 1 }], price: 80
  },
  'kindling-rhythm': {
    id: passive('kindling-rhythm'), name: '불쏘시개 리듬', description: '매 턴 시작 시 임시 화염 코인 1개를 버림 더미에 만든다',
    exclusiveTo: character('warrior'), element: 'fire', hook: 'turnStart',
    effects: [{ kind: 'addCoin', coin: coin('fire'), zone: 'discard', count: 1 }], price: 90
  },
  'flame-opening': {
    id: passive('flame-opening'), name: '개전 불꽃', description: '매 턴, 공격 스킬이 끝날 때마다 대상에게 화상 1을 남긴다',
    exclusiveTo: character('warrior'), element: 'fire', hook: 'turnStart',
    effects: [{ kind: 'addTurnTrigger', trigger: { id: 'flame-opening', hook: 'onAttackSkillResolved', effects: [{ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' }] } }], price: 100
  },
  // ── 마도기사: 마력 갑주 2 + 마나 병기 2 ──
  'armor-memory': {
    id: passive('armor-memory'), name: '갑주 기억', description: '전투 시작 시 방어 5를 얻는다',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'combatStart',
    effects: [{ kind: 'block', amount: 5 }], price: 70
  },
  'drill-discipline': {
    id: passive('drill-discipline'), name: '훈련 규율', description: '매 턴, 공격 스킬을 사용할 때마다 방어 1을 얻는다',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'turnStart',
    effects: [{ kind: 'addTurnTrigger', trigger: { id: 'drill-discipline', hook: 'onAttackSkillResolved', effects: [{ kind: 'block', amount: 1 }] } }], price: 80
  },
  'overcharge-core': {
    id: passive('overcharge-core'), name: '과충전 코어', description: '매 턴 시작 시 소환 장비 전체가 강화 +1을 얻는다',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'turnStart',
    effects: [{ kind: 'empowerSummons', amount: 1 }], price: 100
  },
  'mana-reserve': {
    id: passive('mana-reserve'), name: '마나 저장고', description: '전투 시작 시 임시 마나 코인 1개를 뽑을 더미에 넣는다',
    exclusiveTo: character('arcanist'), element: 'mana', hook: 'combatStart',
    effects: [{ kind: 'addCoin', coin: coin('mana'), zone: 'draw', count: 1 }], price: 80
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
