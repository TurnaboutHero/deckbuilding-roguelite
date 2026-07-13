import type {
  CharacterId,
  CoinDefId,
  PassiveId,
  EquipmentDefId,
  CoinUid,
  Element,
  EventDefId,
  EnemyDefId,
  Face,
  SkillId
} from './ids';

// 확정 어휘 (docs/implementation-plan.md §6): 화상 burn(M3), 동상 frostbite·감전 shock(포스트 MVP 예약)
export type StatusId = 'burn' | 'frostbite' | 'shock';

export type TargetRef = { type: 'player' } | { type: 'enemy'; index: number };

// P7 D4 — 양면 속성 코인: 모든 속성 코인이 앞뒤 고유 효과를 가진다.
// 소비(플립 없음)는 어느 면 proc도 발동하지 않는다 (resolveFlip 전용).
export interface CoinDef {
  id: CoinDefId;
  element: Element | null;
  procs?: { heads?: EffectAtom[]; tails?: EffectAtom[] };
}

export interface CoinInstance {
  uid: CoinUid;
  defId: CoinDefId;
  permanent: boolean;
  grants: Element[];
}

// P6 D3 — 스킬 강화: 스킬당 정의 1종, 런당 1회 (휴식 노드에서 적용).
// patch는 선언적 — deriveUpgradedSkill이 순수 적용. 요구 5종 그대로.
export type SkillUpgradePatch =
  | { kind: 'baseAmount'; index: number; delta: number }
  | { kind: 'addFaceEffect'; face: 'heads' | 'tails'; effect: EffectAtom }
  | { kind: 'addMixedFaceEffect'; effect: EffectAtom }
  | { kind: 'setFaceMode'; face: 'heads' | 'tails'; mode: 'any' | 'per' }
  | { kind: 'replaceEffect'; section: 'base' | 'heads' | 'tails' | 'overheat'; index: number; effect: EffectAtom }
  | { kind: 'setRemiseLightningCount'; count: number }
  | { kind: 'addCoinOnUse'; coin: CoinDefId; zone: 'draw' | 'discard' | 'hand'; count: number }
  | { kind: 'costDelta'; delta: number }
  | { kind: 'removeOncePerCombat'; cooldown?: 1 | 2 | 3 | 4; costDelta?: number };

export interface SkillUpgradeDef {
  name: string;
  description: string;
  patch: SkillUpgradePatch;
}

// P6 D2 — 획득 패시브 (시작 고유 특성 trait와 데이터·표시 모두 구분).
// 중복 획득 불가, 출처: 보물(부여)/보스(3중1택)/상점(구매).
export interface PassiveDef {
  id: PassiveId;
  name: string;
  description: string;
  exclusiveTo?: CharacterId;
  element: Element | null;
  hook: 'combatStart' | 'turnStart';
  effects: EffectAtom[];
  mechanic?:
    | 'continuousMotion' | 'retrievalHabit' | 'balanceSense' | 'lastMove' | 'residualCharge' | 'overcurrent' | 'dischargeSuppression'
    | 'shieldMastery' | 'preparedStance' | 'indomitableSpirit' | 'combatBreathing'
    | 'ignitionInstinct' | 'emberBlade' | 'hotBarrier'
    | 'previewDeployment' | 'inverseGuard' | 'crossCalculation' | 'residualRebuild'
    | 'commandPreservation' | 'manaMembrane' | 'blueCircuit' | 'armamentResonance';
  price: number;
}

export interface SkillDefBase {
  id: SkillId;
  name: string;
  rarity: 'common' | 'advanced' | 'rare';
  tags: readonly ('attack' | 'defense' | 'utility' | 'ultimate')[];
  targetType: 'single-enemy' | 'all-enemies' | 'self' | 'none';
  // P7/P9 — 스킬별 쿨다운: 0=반복(같은 턴 무제한), 1~4=사용 후 N-1턴 봉인.
  // 미지정 기본값 1(기존 턴당 1회 케이던스). oncePerCombat과 1+ 동시 지정 금지.
  cooldown?: 0 | 1 | 2 | 3 | 4;
  oncePerCombat?: boolean;
  // P7 D5 — 과열 강화 분기: 해결 시 과열이면 기본 효과 뒤에 추가, 해결 후 과열 소비.
  overheatBonus?: EffectAtom[];
  upgrade?: SkillUpgradeDef;
  // 캐릭터 전용 스킬 — 공용 보상 풀에서 제외되고 해당 캐릭터 런에서만 노출된다.
  // 숨김 프로퍼티 같은 암묵 경계 대신 명시적 데이터로 풀 경계를 표현한다 (P3.2 결정).
  exclusiveTo?: CharacterId;
}

export interface FlipSkillDef extends SkillDefBase {
  type: 'flip';
  cost: number;
  // 일부 플립형 스킬은 지정 속성 동전만 장전할 수 있다. 소비가 아니므로 면과 proc은 정상 판정한다.
  requiredElement?: Element;
  base: EffectAtom[];
  heads?: { mode: 'any' | 'per'; effects: EffectAtom[] };
  tails?: { mode: 'any' | 'per'; effects: EffectAtom[] };
  mixed?: { effects: EffectAtom[] };
  // P7 D5 — 특정 속성 코인 면 보너스 (일반 면 보너스와 합산, 항상 per 면당)
  elementFaces?: { element: Element; face: Face; effects: EffectAtom[] }[];
  remise?: {
    reuseOnReflipTails?: boolean;
    returnFirstCoinOnReuse?: boolean;
    addLightningToHandAfterReuse?: number;
  };
}

// P7 D1 — 쿨다운 미지정 기본값 1 (기존 usedThisTurn=턴당 1회와 동일 케이던스).
// 전투당 1회 스킬은 usedThisCombat만으로 잠그며 쿨다운 상태를 만들지 않는다.
// 강화로 oncePerCombat이 제거되면 다시 기본 쿨다운 1을 적용한다.
export const skillCooldown = (skill: SkillDefBase): number =>
  skill.oncePerCombat === true ? 0 : (skill.cooldown ?? 1);

export interface ConsumeSkillDef extends SkillDefBase {
  type: 'consume';
  consume: { element: Element; count: number };
  effects: EffectAtom[];
}

export type SkillDef = FlipSkillDef | ConsumeSkillDef;

export interface TurnTriggerDef {
  id: string;
  hook: 'onDamageDealt' | 'onAttackSkillResolved';
  effects: EffectAtom[];
}

export type EffectAtom =
  | { kind: 'damage'; amount: number }
  | { kind: 'block'; amount: number }
  | { kind: 'selfDamage'; amount: number }
  // P7 D4 — 회복 (플레이어 전용, maxHp 상한)
  | { kind: 'heal'; amount: number }
  // P7 D3 — 즉시 드로우 / 다음 턴 드로우 보너스
  | { kind: 'draw'; count: number }
  | { kind: 'nextTurnDraw'; count: number }
  // P7 D1 — 쿨다운 감소: 해결 중인 자기 슬롯 제외, 대기 중인 다른 슬롯만
  | { kind: 'reduceCooldown'; amount: number }
  // P7 D5 — 과열 진입 (비중첩, no-op 재진입)
  | { kind: 'enterOverheat' }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; to: 'target' | 'self' }
  | { kind: 'addCoin'; coin: CoinDefId; zone: 'draw' | 'discard' | 'hand'; count: number }
  | { kind: 'grantElement'; element: Element; scope: 'allBasicInHand' | 'chooseBasicInHand' }
  | { kind: 'addTurnTrigger'; trigger: TurnTriggerDef }
  // P6 D5 — 화상 수치 참조 폭발 (스택 비소비, 격투가 화상 빌드 마무리)
  | { kind: 'damagePerTargetBurn'; amountPerStack: number }
  // P6 D6 — 마력 갑주: 현재 방어 참조 피해 (방어 비소모)
  | { kind: 'damagePerBlock'; amountPerBlock: number }
  | { kind: 'blockFromCurrent'; cap: number }
  | { kind: 'damagePlusBlock'; base: number; cap: number }
  | { kind: 'prepareNextAttackDamage'; amount: number }
  | { kind: 'scheduleEndTurnBlockAoe'; cap: number }
  // P6 D6 — 소환: equipment 'chosen'은 커맨드의 chosenEquipment(기본: 정렬 첫 장비)
  | { kind: 'summonEquipment'; equipment: EquipmentDefId | 'chosen'; duration: number; durationPerTails?: number }
  // P6 D6 — 명령: 선택 소환 즉시 행동(+뒷면당 효과 보너스), 지속 -1
  | { kind: 'commandChosenSummon'; bonusPerTails: number }
  // P6 D6 — 마나 병기: 아군 소환 전체 강화 (이번 전투 지속)
  | { kind: 'empowerSummons'; amount: number }
  | { kind: 'increaseWeaponOutput'; amount: number }
  | { kind: 'extendAllSummons'; amount: number }
  | { kind: 'extendChosenSummon'; amount: number }
  | { kind: 'grantChosenSummonAoe'; uses: number; usesPerHeads?: number }
  | { kind: 'cloneChosenSummon'; duration: number; fullCapExtension: number }
  | { kind: 'virtualManaSwordVolley'; baseDamage: number; baseCount?: number }
  | { kind: 'doubleTargetShock' }
  | { kind: 'blockPerTargetShock'; base: number; cap: number }
  | { kind: 'executeOrDischargeShock' }
  | { kind: 'damageIfTargetShocked'; amount: number }
  | { kind: 'damageIfReused'; amount: number }
  | { kind: 'readyRemise'; amount?: number };

// P6 D6 — 소환 장비: 플레이어 턴 종료 시 자동 행동, 지속 1 감소, 0이면 소멸.
// 적 공격 대상에서 제외된다 (유닛이 아니라 슬롯 위젯).
export interface EquipmentDef {
  id: EquipmentDefId;
  name: string;
  description: string;
  action: { kind: 'strike'; damage: number } | { kind: 'ward'; block: number };
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  maxHp: number;
  startingBag: CoinDefId[];
  startingSkills: SkillId[];
  trait: {
    id: string;
    name: string;
    hook: 'combatStart' | 'turnStart';
    effects: EffectAtom[];
    mechanic?: 'remise';
  };
}

export type EnemyAction =
  | { kind: 'attack'; damage: number; hits?: number }
  | { kind: 'block'; amount: number }
  | { kind: 'nextDrawPenalty'; amount: number }
  | { kind: 'applyStatus'; status: StatusId; stacks: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'buffNextAttack'; amount: number };

export interface EnemyIntent {
  id: string;
  actions: EnemyAction[];
}

// 몬스터 패시브 — 설계 가이드 §3 패시브 원칙 준용: 자동 조건 발동 최대 1개.
// 의도(intent)로 예고되지 않으므로 자기 대상 원자(heal/block/buffNextAttack)만
// 허용한다 — 플레이어 대상 원자는 "매 턴 의도 공개" 계약(§5 원칙 2)과 충돌.
export interface EnemyPassiveDef {
  id: string;
  name: string;
  description: string;
  hook: 'enemyTurnStart';
  effects: EnemyAction[];
}

export interface EnemyDef {
  id: EnemyDefId;
  name: string;
  maxHp: number;
  intents: EnemyIntent[];
  passive?: EnemyPassiveDef;
}

export type EventRisk = 'combat' | 'hp' | 'gold' | 'coin';

export type EventDef =
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'combat';
      elitePool: EnemyDefId[][];
      goldReward: number;
      rareSkillOptions: number;
    }
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'hp';
      hpCost: number;
      requireCurrentHpAbove: number;
      reward: { kind: 'signatureCoin'; count: number };
    }
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'gold';
      goldCost: number;
      transform: { from: CoinDefId; to: 'signatureCoin' };
    }
  | {
      id: EventDefId;
      name: string;
      prompt: string;
      risk: 'coin';
      sacrifice: { coin: CoinDefId; reward: 'signatureCoin'; minimumBagSize: number };
    };

export interface ContentDb {
  coins: Record<string, CoinDef>;
  skills: Record<string, SkillDef>;
  enemies: Record<string, EnemyDef>;
  characters: Record<string, CharacterDef>;
  events?: Record<string, EventDef>;
  passives?: Record<string, PassiveDef>;
  equipment?: Record<string, EquipmentDef>;
  validate: () => string[];
}

const duplicateIds = <T extends { id: string | number }>(items: readonly T[], label: string): string[] => {
  const seen = new Set<string | number>();
  const errors: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      errors.push(`duplicate ${label} id: ${String(item.id)}`);
    }
    seen.add(item.id);
  }
  return errors;
};

// P7 D1/D3/D5 — 쿨다운·신규 원자 검증
const validateCooldowns = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    if (skill.cooldown !== undefined) {
      if (!Number.isInteger(skill.cooldown) || skill.cooldown < 0 || skill.cooldown > 4) {
        errors.push(`skill ${String(skill.id)}: cooldown must be an integer from 0 to 4`);
      }
      if (skill.oncePerCombat === true && skill.cooldown >= 1) {
        errors.push(`skill ${String(skill.id)}: oncePerCombat and cooldown >= 1 cannot be combined`);
      }
    }
    if (skill.type === 'flip' && skill.elementFaces !== undefined) {
      for (const bonus of skill.elementFaces) {
        if (bonus.effects.length === 0) {
          errors.push(`skill ${String(skill.id)}: elementFaces entry must declare at least one effect`);
        }
      }
    }
  }
  return errors;
};

const validateAtomAmounts = (db: Omit<ContentDb, 'validate'>): string[] => {
  const errors: string[] = [];
  const checkAtoms = (atoms: readonly EffectAtom[], owner: string): void => {
    for (const atom of atoms) {
      if ((atom.kind === 'draw' || atom.kind === 'nextTurnDraw') && (!Number.isInteger(atom.count) || atom.count <= 0)) {
        errors.push(`${owner}: ${atom.kind} count must be a positive integer`);
      }
      if ((atom.kind === 'heal' || atom.kind === 'reduceCooldown') && (!Number.isInteger(atom.amount) || atom.amount <= 0)) {
        errors.push(`${owner}: ${atom.kind} amount must be a positive integer`);
      }
    }
  };
  for (const skill of Object.values(db.skills)) {
    const owner = `skill ${String(skill.id)}`;
    if (skill.type === 'consume') {
      checkAtoms(skill.effects, owner);
    } else {
      checkAtoms(skill.base, owner);
      if (skill.heads) checkAtoms(skill.heads.effects, owner);
      if (skill.tails) checkAtoms(skill.tails.effects, owner);
      if (skill.mixed) checkAtoms(skill.mixed.effects, owner);
      for (const bonus of skill.elementFaces ?? []) checkAtoms(bonus.effects, owner);
    }
    checkAtoms(skill.overheatBonus ?? [], owner);
  }
  return errors;
};

// P7 D4 — 양면 코인 검증: 속성 코인은 앞뒤 모두 1+ 효과, proc은 안전 원자만
const COIN_PROC_ATOMS = new Set(['damage', 'block', 'heal', 'applyStatus']);

const validateCoinProcs = (coins: Record<string, CoinDef>): string[] => {
  const errors: string[] = [];
  for (const coin of Object.values(coins)) {
    const owner = `coin ${String(coin.id)}`;
    if (coin.element === null) {
      if (coin.procs !== undefined) errors.push(`${owner}: basic coin cannot declare procs`);
      continue;
    }
    if ((coin.procs?.heads?.length ?? 0) === 0 || (coin.procs?.tails?.length ?? 0) === 0) {
      errors.push(`${owner}: elemental coin must declare both heads and tails effects`);
      continue;
    }
    for (const face of ['heads', 'tails'] as const) {
      for (const atom of coin.procs?.[face] ?? []) {
        if (!COIN_PROC_ATOMS.has(atom.kind)) {
          errors.push(`${owner}: proc atom ${atom.kind} is not allowed on a coin face`);
        }
      }
    }
  }
  return errors;
};

const validateSkillCosts = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];

  for (const skill of skills) {
    if (skill.type === 'consume') {
      if (!Number.isInteger(skill.consume.count) || skill.consume.count < 1 || skill.consume.count > 3) {
        errors.push(`skill ${String(skill.id)}: consume count must be an integer from 1 to 3`);
      }
      continue;
    }

    if (!Number.isInteger(skill.cost) || skill.cost < 1) {
      errors.push(`skill ${String(skill.id)}: flip cost must be a positive integer`);
      continue;
    }

    if (skill.cost > 5) {
      errors.push(`skill ${String(skill.id)}: flip cost ${skill.cost} exceeds the maximum of 5`);
      continue;
    }

    const isExceptionalCost =
      skill.rarity === 'rare' && (skill.oncePerCombat === true || skill.tags.includes('ultimate'));
    if (skill.cost === 5 && !isExceptionalCost) {
      errors.push(`skill ${String(skill.id)}: flip cost 5 requires rare rarity and oncePerCombat or ultimate`);
    }
  }

  return errors;
};

// addTurnTrigger 재귀 검증 — 잘못된 id/hook/빈 효과, 그리고 트리거 효과 안의
// 중첩 addTurnTrigger(순환 폭주 표면)를 콘텐츠 단계에서 거부한다 (P3.3 감사).
const TURN_TRIGGER_HOOKS = ['onDamageDealt', 'onAttackSkillResolved'] as const;

const validateTriggerAtoms = (
  atoms: readonly EffectAtom[],
  owner: string,
  insideTrigger: boolean,
  errors: string[]
): void => {
  for (const atom of atoms) {
    if (atom.kind !== 'addTurnTrigger') continue;
    if (insideTrigger) {
      errors.push(`${owner}: nested addTurnTrigger inside a trigger is not allowed`);
      continue;
    }
    const trigger = atom.trigger;
    if (typeof trigger.id !== 'string' || trigger.id.length === 0) {
      errors.push(`${owner}: turn trigger id must be a non-empty string`);
    }
    if (!TURN_TRIGGER_HOOKS.includes(trigger.hook)) {
      errors.push(`${owner}: unknown turn trigger hook ${String(trigger.hook)}`);
    }
    if (!Array.isArray(trigger.effects) || trigger.effects.length === 0) {
      errors.push(`${owner}: turn trigger ${trigger.id} must declare at least one effect`);
    } else {
      validateTriggerAtoms(trigger.effects, `${owner} trigger ${trigger.id}`, true, errors);
    }
  }
};

// attack 태그 스킬이 self/none 대상을 갖으면 onAttackSkillResolved류 트리거가
// 플레이어를 대상으로 발동하는 셀프 피해 함정이 된다 — 구조적으로 금지 (P3.3 감사)
const validateAttackTargets = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    if (
      skill.tags.includes('attack') &&
      skill.targetType !== 'single-enemy' &&
      skill.targetType !== 'all-enemies'
    ) {
      errors.push(
        `skill ${String(skill.id)}: attack tag requires an enemy targetType (got ${skill.targetType})`
      );
    }
  }
  return errors;
};

const validateTurnTriggers = (db: Omit<ContentDb, 'validate'>): string[] => {
  const errors: string[] = [];
  for (const skill of Object.values(db.skills)) {
    const owner = `skill ${String(skill.id)}`;
    if (skill.type === 'consume') {
      validateTriggerAtoms(skill.effects, owner, false, errors);
    } else {
      validateTriggerAtoms(skill.base, owner, false, errors);
      if (skill.heads) validateTriggerAtoms(skill.heads.effects, owner, false, errors);
      if (skill.tails) validateTriggerAtoms(skill.tails.effects, owner, false, errors);
      if (skill.mixed) validateTriggerAtoms(skill.mixed.effects, owner, false, errors);
    }
  }
  for (const character of Object.values(db.characters)) {
    validateTriggerAtoms(character.trait.effects, `character ${String(character.id)}`, false, errors);
  }
  return errors;
};

const validateEvents = (events: readonly EventDef[], enemies: Record<string, EnemyDef>): string[] => {
  const errors: string[] = [];
  for (const event of events) {
    if (event.risk !== 'combat') continue;
    if (event.elitePool.length === 0) {
      errors.push(`event ${String(event.id)}: elitePool must not be empty`);
    }
    for (const encounter of event.elitePool) {
      if (encounter.length === 0) {
        errors.push(`event ${String(event.id)}: elitePool encounter must not be empty`);
      }
      for (const enemyId of encounter) {
        if (enemies[String(enemyId)] === undefined) {
          errors.push(`event ${String(event.id)}: unknown enemy ${String(enemyId)}`);
        }
      }
    }
  }
  return errors;
};

const validateEnemyPassives = (enemies: Record<string, EnemyDef>): string[] => {
  const errors: string[] = [];
  const SELF_ONLY = new Set(['heal', 'block', 'buffNextAttack']);
  for (const enemy of Object.values(enemies)) {
    const passive = enemy.passive;
    if (passive === undefined) continue;
    const owner = `enemy ${String(enemy.id)} passive ${passive.id}`;
    if (passive.effects.length === 0) errors.push(`${owner}: must declare at least one effect`);
    for (const action of passive.effects) {
      if (!SELF_ONLY.has(action.kind)) {
        errors.push(`${owner}: only self-target actions are allowed (got ${action.kind})`);
      } else if ('amount' in action && (!Number.isInteger(action.amount) || action.amount <= 0)) {
        errors.push(`${owner}: ${action.kind} amount must be a positive integer`);
      }
    }
  }
  return errors;
};

// P6 D2 — 획득 패시브 검증: 플레이어 훅에서 안전한 원자만 (applyStatus/damage류는
// runHook의 player 타깃 문맥에서 자기 오염이 되므로 콘텐츠 단계에서 차단).
const PASSIVE_SAFE_ATOMS = new Set(['block', 'addCoin', 'addTurnTrigger', 'empowerSummons', 'summonEquipment', 'grantElement']);

const validatePassives = (passives: Record<string, PassiveDef> | undefined): string[] => {
  const errors: string[] = [];
  for (const passive of Object.values(passives ?? {})) {
    const owner = `passive ${String(passive.id)}`;
    if (passive.description.length === 0) errors.push(`${owner}: description is required`);
    if (!Number.isInteger(passive.price) || passive.price <= 0)
      errors.push(`${owner}: price must be a positive integer`);
    if (passive.effects.length === 0 && passive.mechanic === undefined) errors.push(`${owner}: must declare at least one effect or mechanic`);
    for (const atom of passive.effects) {
      if (!PASSIVE_SAFE_ATOMS.has(atom.kind))
        errors.push(`${owner}: atom ${atom.kind} is not allowed in a passive`);
      if (atom.kind === 'summonEquipment' && atom.equipment === 'chosen')
        errors.push(`${owner}: passive summon must name a concrete equipment`);
    }
    validateTriggerAtoms(passive.effects, owner, false, errors);
  }
  return errors;
};

const validateEquipment = (equipment: Record<string, EquipmentDef> | undefined): string[] => {
  const errors: string[] = [];
  for (const def of Object.values(equipment ?? {})) {
    const owner = `equipment ${String(def.id)}`;
    const amount = def.action.kind === 'strike' ? def.action.damage : def.action.block;
    if (!Number.isInteger(amount) || amount <= 0)
      errors.push(`${owner}: action amount must be a positive integer`);
  }
  return errors;
};

// P6 D3 — 강화 patch 정합: baseAmount는 amount 보유 원자만, addFaceEffect는 flip만,
// costDelta는 비용 규칙 유지, removeOncePerCombat는 oncePerCombat 스킬만.
const validateSkillUpgrades = (skills: readonly SkillDef[]): string[] => {
  const errors: string[] = [];
  for (const skill of skills) {
    const upgrade = skill.upgrade;
    if (upgrade === undefined) continue;
    const owner = `skill ${String(skill.id)} upgrade`;
    const patch = upgrade.patch;
    if (patch.kind === 'baseAmount') {
      const atoms = skill.type === 'flip' ? skill.base : skill.effects;
      const atom = atoms[patch.index];
      if (atom === undefined || !('amount' in atom) || typeof atom.amount !== 'number')
        errors.push(`${owner}: baseAmount index ${patch.index} has no amount`);
      if (!Number.isInteger(patch.delta) || patch.delta === 0)
        errors.push(`${owner}: baseAmount delta must be a nonzero integer`);
    } else if (patch.kind === 'addFaceEffect' || patch.kind === 'addMixedFaceEffect') {
      if (skill.type !== 'flip') errors.push(`${owner}: addFaceEffect requires a flip skill`);
    } else if (patch.kind === 'setFaceMode') {
      if (skill.type !== 'flip' || skill[patch.face] === undefined)
        errors.push(`${owner}: setFaceMode requires an existing flip face`);
    } else if (patch.kind === 'replaceEffect') {
      if (patch.section !== 'base' && skill.type !== 'flip')
        errors.push(`${owner}: replaceEffect ${patch.section} requires a flip skill`);
      const atoms = patch.section === 'base'
        ? (skill.type === 'flip' ? skill.base : skill.effects)
        : patch.section === 'overheat'
          ? skill.overheatBonus
        : skill.type === 'flip'
          ? skill[patch.section]?.effects
          : undefined;
      if (atoms?.[patch.index] === undefined)
        errors.push(`${owner}: replaceEffect index ${patch.index} does not exist`);
    } else if (patch.kind === 'setRemiseLightningCount') {
      if (skill.type !== 'flip' || skill.remise === undefined || !Number.isInteger(patch.count) || patch.count <= 0)
        errors.push(`${owner}: setRemiseLightningCount requires a remise flip skill and positive count`);
    } else if (patch.kind === 'costDelta') {
      if (skill.type === 'flip') {
        const cost = skill.cost + patch.delta;
        if (cost < 1 || cost > 5) errors.push(`${owner}: costDelta leaves cost out of range`);
      } else {
        const count = skill.consume.count + patch.delta;
        if (count < 1 || count > 3) errors.push(`${owner}: costDelta leaves consume count out of range`);
      }
    } else if (patch.kind === 'removeOncePerCombat') {
      if (skill.oncePerCombat !== true)
        errors.push(`${owner}: removeOncePerCombat requires a oncePerCombat skill`);
    } else if (patch.kind === 'addCoinOnUse') {
      if (!Number.isInteger(patch.count) || patch.count <= 0)
        errors.push(`${owner}: addCoinOnUse count must be a positive integer`);
    }
  }
  return errors;
};

export const validateContentDb = (db: Omit<ContentDb, 'validate'>): string[] => [
  ...duplicateIds(Object.values(db.coins), 'coin'),
  ...duplicateIds(Object.values(db.skills), 'skill'),
  ...duplicateIds(Object.values(db.enemies), 'enemy'),
  ...duplicateIds(Object.values(db.characters), 'character'),
  ...duplicateIds(Object.values(db.events ?? {}), 'event'),
  ...validateCoinProcs(db.coins),
  ...validateSkillCosts(Object.values(db.skills)),
  ...validateCooldowns(Object.values(db.skills)),
  ...validateAtomAmounts(db),
  ...validateTurnTriggers(db),
  ...validateAttackTargets(Object.values(db.skills)),
  ...validateEvents(Object.values(db.events ?? {}), db.enemies),
  ...validateEnemyPassives(db.enemies),
  ...validatePassives(db.passives),
  ...validateEquipment(db.equipment),
  ...validateSkillUpgrades(Object.values(db.skills))
];

export const effectiveElements = (coin: CoinInstance, db: ContentDb): Element[] => {
  const def = db.coins[String(coin.defId)];
  const elements = new Set<Element>(coin.grants);
  if (def?.element != null) {
    elements.add(def.element);
  }
  return [...elements];
};
