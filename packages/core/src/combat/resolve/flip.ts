import type {
  StatusId,
  ConsumeSkillDef,
  ContentDb,
  EffectAtom,
  FlipSkillDef,
  TargetRef
} from '../../content-types';
import { effectiveElements, skillCooldown } from '../../content-types';
import type { Element, EquipmentDefId, CoinUid, Face, SlotId } from '../../ids';
import { rngFrom } from '../../rng';
import { drawCards, HAND_LIMIT } from '../draw';
import type { CombatEvent } from '../events';
import { statusStacks, statusTurns } from '../state';
import type { CombatState, StatusState, TurnTriggerInstance } from '../state';
import { actSummon, addSummon, defaultEquipmentId, tickSummonDuration } from '../summons';

export interface ResolveResult {
  state: CombatState;
  events: CombatEvent[];
}

interface ApplyEffectOptions {
  // P6 D6 — 소환 원자 컨텍스트: 이번 플립의 뒷면 수, 명시 선택 파라미터
  tailsCount?: number;
  headsCount?: number;
  isReuse?: boolean;
  chosenEquipment?: EquipmentDefId;
  chosenSummon?: number;
  suppressTurnTriggers?: boolean;
  turnTriggerScope?: readonly TurnTriggerInstance[];
  // P7 D1 — reduceCooldown이 해결 중인 자기 슬롯을 제외하기 위한 출처 슬롯
  sourceSlot?: SlotId;
}

const isAliveEnemy = (state: CombatState, index: number): boolean => {
  const enemy = state.enemies[index];
  return enemy !== undefined && enemy.hp > 0;
};

const firstAliveEnemy = (state: CombatState): number | undefined =>
  state.enemies.findIndex((enemy) => enemy.hp > 0) >= 0
    ? state.enemies.findIndex((enemy) => enemy.hp > 0)
    : undefined;

export const checkCombatEnd = (state: CombatState, events: CombatEvent[]): CombatState => {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  if (state.player.hp <= 0) {
    events.push({ type: 'combatEnded', result: 'defeat', turns: state.turn });
    return { ...state, phase: 'defeat' };
  }
  if (state.enemies.every((enemy) => enemy.hp <= 0)) {
    // M5 run settlement hook: remove temporary coins from all zones when combat finalization spans combats.
    events.push({ type: 'combatEnded', result: 'victory', turns: state.turn });
    return { ...state, phase: 'victory' };
  }
  return state;
};

const statusCarrier = (state: CombatState, target: TargetRef) =>
  target.type === 'player' ? state.player : state.enemies[target.index];

const modifiedDamage = (state: CombatState, target: TargetRef, amount: number, attacker?: TargetRef): number => {
  if (attacker === undefined) return amount;
  const attackerStatuses = statusCarrier(state, attacker)?.statuses;
  const targetStatuses = statusCarrier(state, target)?.statuses;
  const frostbiteMultiplier = attackerStatuses !== undefined && statusTurns(attackerStatuses, 'frostbite') > 0 ? 0.75 : 1;
  const shockMultiplier = targetStatuses !== undefined && statusTurns(targetStatuses, 'shock') > 0 ? 1.5 : 1;
  return Math.floor(amount * frostbiteMultiplier * shockMultiplier);
};

export const applyDamage = (
  state: CombatState,
  target: TargetRef,
  amount: number,
  source: 'skill' | 'burn' | 'enemy' | 'self',
  events: CombatEvent[],
  attacker?: TargetRef
): CombatState => {
  if (amount < 0) throw new Error('damage amount cannot be negative');
  const finalAmount = source === 'burn' ? amount : modifiedDamage(state, target, amount, attacker);
  if (target.type === 'player') {
    const blocked = source === 'burn' ? 0 : Math.min(state.player.block, finalAmount);
    const hpDamage = finalAmount - blocked;
    const player = {
      ...state.player,
      block: state.player.block - blocked,
      hp: Math.max(0, state.player.hp - hpDamage)
    };
    events.push({ type: 'damageDealt', target, amount: hpDamage, blocked, source });
    return checkCombatEnd({ ...state, player }, events);
  }

  const enemy = state.enemies[target.index];
  if (enemy === undefined || enemy.hp <= 0) return state;
  const blocked = source === 'burn' ? 0 : Math.min(enemy.block, finalAmount);
  const hpDamage = finalAmount - blocked;
  const enemies = state.enemies.map((candidate, index) =>
    index === target.index
      ? { ...candidate, block: candidate.block - blocked, hp: Math.max(0, candidate.hp - hpDamage) }
      : candidate
  );
  events.push({ type: 'damageDealt', target, amount: hpDamage, blocked, source });
  return checkCombatEnd({ ...state, enemies }, events);
};

export const applyBlock = (
  state: CombatState,
  target: TargetRef,
  amount: number,
  events: CombatEvent[]
): CombatState => {
  if (amount < 0) throw new Error('block amount cannot be negative');
  events.push({ type: 'blockGained', target, amount });
  if (target.type === 'player') {
    return { ...state, player: { ...state.player, block: state.player.block + amount } };
  }
  const enemies = state.enemies.map((enemy, index) =>
    index === target.index ? { ...enemy, block: enemy.block + amount } : enemy
  );
  return { ...state, enemies };
};

const addStatus = (current: StatusState | undefined, status: EffectAtom & { kind: 'applyStatus' }): StatusState => {
  if (status.status === 'burn') {
    return { kind: 'stack', stacks: (current?.kind === 'stack' ? current.stacks : 0) + status.stacks };
  }
  return { kind: 'duration', turns: (current?.kind === 'duration' ? current.turns : 0) + status.stacks };
};

const addTemporaryCoin = (
  state: CombatState,
  atom: Extract<EffectAtom, { kind: 'addCoin' }>,
  events: CombatEvent[]
): CombatState => {
  let nextState = state;
  const rng = nextState.rngImpl?.shuffle ?? rngFrom(nextState.rng.shuffle);

  for (let i = 0; i < atom.count; i += 1) {
    const coin = nextState.nextUid as CoinUid;
    const coins = {
      ...nextState.coins,
      [Number(coin)]: { uid: coin, defId: atom.coin, permanent: false, grants: [] }
    };

    if (atom.zone === 'draw') {
      const draw = [...nextState.zones.draw];
      draw.splice(rng.int(draw.length + 1), 0, coin);
      nextState = {
        ...nextState,
        coins,
        nextUid: nextState.nextUid + 1,
        rng: { ...nextState.rng, shuffle: rng.snapshot() },
        zones: { ...nextState.zones, draw }
      };
      events.push({ type: 'coinCreated', coin, defId: String(atom.coin), zone: 'draw' });
      continue;
    }

    if (atom.zone === 'hand' && nextState.zones.hand.length < HAND_LIMIT) {
      nextState = {
        ...nextState,
        coins,
        nextUid: nextState.nextUid + 1,
        zones: { ...nextState.zones, hand: [...nextState.zones.hand, coin] }
      };
      events.push({ type: 'coinCreated', coin, defId: String(atom.coin), zone: 'hand' });
      continue;
    }

    nextState = {
      ...nextState,
      coins,
      nextUid: nextState.nextUid + 1,
      zones: { ...nextState.zones, discard: [coin, ...nextState.zones.discard] }
    };
    events.push({ type: 'coinCreated', coin, defId: String(atom.coin), zone: 'discard' });
  }

  return nextState;
};

const grantElement = (
  state: CombatState,
  atom: Extract<EffectAtom, { kind: 'grantElement' }>,
  db: ContentDb,
  events: CombatEvent[],
  chosen?: readonly CoinUid[]
): CombatState => {
  const targets =
    atom.scope === 'allBasicInHand'
      ? state.zones.hand.filter((coin) => {
          const instance = state.coins[Number(coin)];
          const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
          return def?.element === null;
        })
      : [...(chosen ?? [])];
  if (targets.length === 0) return state;
  const targetSet = new Set<CoinUid>(targets);
  events.push({ type: 'elementGranted', coins: targets, element: atom.element });
  return {
    ...state,
    coins: Object.fromEntries(
      Object.entries(state.coins).map(([key, coin]) => [
        key,
        targetSet.has(coin.uid) && !coin.grants.includes(atom.element)
          ? { ...coin, grants: [...coin.grants, atom.element] }
          : coin
      ])
    )
  };
};

export const applyEffectAtom = (
  state: CombatState,
  atom: EffectAtom,
  target: TargetRef,
  db: ContentDb,
  events: CombatEvent[],
  chosen?: readonly CoinUid[],
  options?: ApplyEffectOptions
): CombatState => {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  switch (atom.kind) {
    case 'damage': {
      const damaged = applyDamage(state, target, atom.amount, 'skill', events, { type: 'player' });
      return target.type === 'enemy' && options?.suppressTurnTriggers !== true
        ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope)
        : damaged;
    }
    case 'block':
      return applyBlock(state, { type: 'player' }, atom.amount, events);
    case 'selfDamage':
      return applyDamage(state, { type: 'player' }, atom.amount, 'self', events);
    // P7 D4 — 회복: 플레이어 전용, maxHp 상한
    case 'heal': {
      const healed = Math.min(state.player.maxHp, state.player.hp + atom.amount);
      const gained = healed - state.player.hp;
      if (gained <= 0) return state;
      events.push({ type: 'healed', target: { type: 'player' }, amount: gained, hp: healed });
      return { ...state, player: { ...state.player, hp: healed } };
    }
    // P7 D3 — 즉시 드로우 / 다음 턴 드로우 보너스
    case 'draw': {
      const drawn = drawCards(state, atom.count);
      events.push(...drawn.events);
      return drawn.state;
    }
    case 'nextTurnDraw':
      return { ...state, player: { ...state.player, nextDrawBonus: state.player.nextDrawBonus + atom.count } };
    // P7 D1 — 쿨다운 감소: 자기 슬롯 제외, 대기 중인 슬롯만.
    // 반복(쿨0)은 대기 상태가 없어 구조적으로 제외되고, 전투당 1회는 명시 제외한다.
    case 'reduceCooldown': {
      const affected: number[] = [];
      const slots = state.slots.map((slotState, index) => {
        if (index === Number(options?.sourceSlot ?? -1) || slotState.cooldownRemaining <= 0) return slotState;
        const slotSkill = slotState.skillId === null ? undefined : db.skills[String(slotState.skillId)];
        if (slotSkill === undefined || slotSkill.oncePerCombat === true || skillCooldown(slotSkill) === 0) return slotState;
        affected.push(index);
        return { ...slotState, cooldownRemaining: Math.max(0, slotState.cooldownRemaining - atom.amount) };
      });
      if (affected.length === 0) return state;
      events.push({ type: 'cooldownReduced', slots: affected, amount: atom.amount });
      return { ...state, slots };
    }
    // P7 D5 — 과열 진입: 비중첩, 재진입 no-op
    case 'enterOverheat': {
      if (state.player.overheat) return state;
      events.push({ type: 'overheatEntered' });
      return { ...state, player: { ...state.player, overheat: true } };
    }
    case 'applyStatus': {
      const statusTarget = atom.to === 'self' ? { type: 'player' as const } : target;
      if (statusTarget.type === 'enemy' && !isAliveEnemy(state, statusTarget.index)) return state;
      const event =
        atom.status === 'burn'
          ? { type: 'statusApplied' as const, target: statusTarget, status: atom.status, stacks: atom.stacks }
          : { type: 'statusApplied' as const, target: statusTarget, status: atom.status, stacks: atom.stacks, turns: atom.stacks };
      if (statusTarget.type === 'player') {
        events.push(event);
        return {
          ...state,
          player: {
            ...state.player,
            statuses: { ...state.player.statuses, [atom.status]: addStatus(state.player.statuses[atom.status], atom) }
          }
        };
      }
      const enemies = state.enemies.map((enemy, index) =>
        index === statusTarget.index
          ? { ...enemy, statuses: { ...enemy.statuses, [atom.status]: addStatus(enemy.statuses[atom.status], atom) } }
          : enemy
      );
      events.push(event);
      return { ...state, enemies };
    }
    case 'addCoin':
      return addTemporaryCoin(state, atom, events);
    case 'grantElement':
      return grantElement(state, atom, db, events, chosen);
    case 'addTurnTrigger': {
      events.push({ type: 'turnTriggerAdded', trigger: atom.trigger.id });
      return {
        ...state,
        nextTurnTriggerUid: state.nextTurnTriggerUid + 1,
        turnTriggers: [...state.turnTriggers, { uid: state.nextTurnTriggerUid, trigger: atom.trigger }]
      };
    }
    // P6 D5 — 화상 수치 참조 폭발 (스택 비소비)
    case 'damagePerTargetBurn': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const stacks = statusStacks(state.enemies[target.index]?.statuses ?? {}, 'burn');
      if (stacks <= 0) return state;
      const damaged = applyDamage(state, target, stacks * atom.amountPerStack, 'skill', events, { type: 'player' });
      return options?.suppressTurnTriggers !== true
        ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope)
        : damaged;
    }
    // P6 D6 — 마력 갑주: 현재 방어 참조 피해 (방어 비소모)
    case 'damagePerBlock': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const block = state.player.block;
      if (block <= 0) return state;
      const damaged = applyDamage(state, target, block * atom.amountPerBlock, 'skill', events, { type: 'player' });
      return options?.suppressTurnTriggers !== true
        ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope)
        : damaged;
    }
    // P6 D6 — 소환 (뒷면당 지속 연장)
    case 'summonEquipment': {
      const equipmentId =
        atom.equipment === 'chosen'
          ? (options?.chosenEquipment ?? defaultEquipmentId(db))
          : atom.equipment;
      if (equipmentId === undefined) return state;
      const duration =
        atom.duration + (atom.durationPerTails ?? 0) * (options?.tailsCount ?? 0);
      return addSummon(state, equipmentId, duration, db, events);
    }
    // P6 D6 — 명령: 선택(기본: 최고령) 소환 즉시 행동 + 지속 -1
    case 'commandChosenSummon': {
      if (state.summons.length === 0) return state;
      const uid = options?.chosenSummon ?? state.summons[0]!.uid;
      const index = state.summons.findIndex((summon) => summon.uid === uid);
      if (index < 0) return state;
      const bonus = atom.bonusPerTails * (options?.tailsCount ?? 0);
      const acted = actSummon(state, index, bonus, db, events);
      if (acted.phase === 'victory' || acted.phase === 'defeat') return acted;
      return tickSummonDuration(acted, uid, events);
    }
    // P6 D6 — 마나 병기: 전체 소환 강화 (이번 전투 지속)
    case 'empowerSummons':
      return {
        ...state,
        summons: state.summons.map((summon) => ({ ...summon, enhance: summon.enhance + atom.amount }))
      };
    case 'increaseWeaponOutput': {
      const value = Math.min(5, state.player.weaponOutput + atom.amount);
      const gained = value - state.player.weaponOutput;
      if (gained <= 0) return state;
      events.push({ type: 'weaponOutputChanged', amount: gained, value });
      return { ...state, player: { ...state.player, weaponOutput: value } };
    }
    case 'extendAllSummons':
      return { ...state, summons: state.summons.map((summon) => ({ ...summon, duration: summon.duration + atom.amount })) };
    case 'extendChosenSummon': {
      if (state.summons.length === 0) return state;
      const uid = options?.chosenSummon ?? state.summons[0]!.uid;
      return {
        ...state,
        summons: state.summons.map((summon) =>
          summon.uid === uid ? { ...summon, duration: summon.duration + atom.amount } : summon
        )
      };
    }
    case 'grantChosenSummonAoe': {
      if (state.summons.length === 0) return state;
      const uid = options?.chosenSummon ?? state.summons[0]!.uid;
      const uses = atom.uses + (atom.usesPerHeads ?? 0) * (options?.headsCount ?? 0);
      events.push({ type: 'summonAoeGranted', uid, uses });
      return { ...state, summons: state.summons.map((summon) => summon.uid === uid ? { ...summon, aoeUses: summon.aoeUses + uses } : summon) };
    }
    case 'cloneChosenSummon': {
      if (state.summons.length === 0) return state;
      const uid = options?.chosenSummon ?? state.summons[0]!.uid;
      const source = state.summons.find((summon) => summon.uid === uid);
      if (source === undefined) return state;
      if (state.summons.length >= 3) {
        return { ...state, summons: state.summons.map((summon) => summon.uid === uid ? { ...summon, duration: summon.duration + atom.fullCapExtension } : summon) };
      }
      const clone = { ...source, uid: state.nextSummonUid, duration: atom.duration };
      events.push({ type: 'summonCloned', sourceUid: source.uid, uid: clone.uid, equipment: String(clone.defId) });
      return { ...state, summons: [...state.summons, clone], nextSummonUid: state.nextSummonUid + 1 };
    }
    case 'virtualManaSwordVolley': {
      const count = 3 + state.summons.length;
      let next = state;
      for (let volley = 0; volley < count; volley += 1) {
        for (let index = 0; index < next.enemies.length; index += 1) {
          if ((next.enemies[index]?.hp ?? 0) <= 0) continue;
          next = applyDamage(next, { type: 'enemy', index }, atom.baseDamage + next.player.weaponOutput, 'skill', events, { type: 'player' });
        }
      }
      return next;
    }
    case 'doubleTargetShock': {
      if (target.type !== 'enemy') return state;
      const turns = statusTurns(state.enemies[target.index]?.statuses ?? {}, 'shock');
      if (turns <= 0) return state;
      return { ...state, enemies: state.enemies.map((enemy, index) => index === target.index ? { ...enemy, statuses: { ...enemy.statuses, shock: { kind: 'duration', turns: turns * 2 } } } : enemy) };
    }
    case 'blockPerTargetShock': {
      const turns = target.type === 'enemy' ? statusTurns(state.enemies[target.index]?.statuses ?? {}, 'shock') : 0;
      return applyBlock(state, { type: 'player' }, atom.base + Math.min(atom.cap, turns), events);
    }
    case 'executeOrDischargeShock': {
      if (target.type !== 'enemy') return state;
      const enemy = state.enemies[target.index];
      const turns = statusTurns(enemy?.statuses ?? {}, 'shock');
      if (enemy === undefined || turns <= 0) return state;
      if (turns > enemy.hp) return applyDamage(state, target, enemy.hp + enemy.block, 'skill', events, { type: 'player' });
      const damaged = applyDamage(state, target, turns, 'skill', events, { type: 'player' });
      return { ...damaged, enemies: damaged.enemies.map((item, index) => index === target.index ? { ...item, statuses: { ...item.statuses, shock: undefined } } : item) };
    }
    case 'damageIfTargetShocked': {
      if (target.type !== 'enemy' || statusTurns(state.enemies[target.index]?.statuses ?? {}, 'shock') <= 0) return state;
      return applyDamage(state, target, atom.amount, 'skill', events, { type: 'player' });
    }
    case 'damageIfReused':
      return options?.isReuse === true ? applyDamage(state, target, atom.amount, 'skill', events, { type: 'player' }) : state;
    case 'readyRemise':
      return { ...state, player: { ...state.player, remiseCharges: state.player.remiseCharges + (atom.amount ?? 1) } };
  }
};

export const fireTurnTriggers = (
  input: CombatState,
  hook: 'onDamageDealt' | 'onAttackSkillResolved',
  target: TargetRef,
  db: ContentDb,
  events: CombatEvent[],
  triggerScope: readonly TurnTriggerInstance[] = input.turnTriggers
): CombatState => {
  let state = input;
  // 종료 우선 결정 (P3.3 감사): 전투가 끝난 뒤에는 어떤 훅도 발동·기록하지 않는다 —
  // P5 미시 종료 규칙이 §12 "피해 여부 무관" 자구(0피해 취지)보다 우선한다.
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  for (const instance of triggerScope) {
    if (instance.trigger.hook !== hook) continue;
    // 인스턴스 사이 종료는 내부 루프의 return이 보장한다 — 여기 도달하면 항상 비종료 상태
    events.push({ type: 'turnTriggerFired', trigger: instance.trigger.id, hook });
    for (const atom of instance.trigger.effects) {
      state = applyEffectAtom(state, atom, target, db, events, undefined, { suppressTurnTriggers: true });
      state = checkCombatEnd(state, events);
      if (state.phase === 'victory' || state.phase === 'defeat') return state;
    }
  }
  return state;
};

const HOSTILE_STATUSES: ReadonlySet<StatusId> = new Set(['burn', 'frostbite', 'shock']);

// P7 D4 — 코인 proc 대상 규칙: 공격형(피해·적대 상태)은 단일 대상 스킬→그 적,
// 전체 스킬→모든 생존 적 각각, 자기 대상 스킬→명시 target(cmd) 필수.
// 우호형(방어·회복·자기 상태)은 스킬 대상과 무관하게 플레이어.
const targetsForElementProc = (
  state: CombatState,
  atom: EffectAtom,
  skill: FlipSkillDef,
  skillTarget: TargetRef,
  explicitTarget: number | undefined
): TargetRef[] => {
  const hostile =
    atom.kind === 'damage' ||
    atom.kind === 'damagePerTargetBurn' ||
    (atom.kind === 'applyStatus' && atom.to === 'target' && HOSTILE_STATUSES.has(atom.status));
  if (!hostile) return [{ type: 'player' }];
  if (skill.targetType === 'all-enemies') {
    return state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [{ type: 'enemy' as const, index }] : []));
  }
  if (skillTarget.type === 'enemy' && isAliveEnemy(state, skillTarget.index)) return [skillTarget];
  if (explicitTarget !== undefined && isAliveEnemy(state, explicitTarget)) {
    return [{ type: 'enemy', index: explicitTarget }];
  }
  return [];
};

const isTargetEffect = (atom: EffectAtom): boolean =>
  atom.kind === 'damage' ||
  atom.kind === 'damagePerTargetBurn' ||
  atom.kind === 'damagePerBlock' ||
  (atom.kind === 'applyStatus' && atom.to === 'target');

/** 전체 대상 스킬의 본체/면 효과를 모든 생존 적에게 적용한다. */
export const targetsForSkillEffect = (
  state: CombatState,
  atom: EffectAtom,
  skill: FlipSkillDef | ConsumeSkillDef,
  fallback: TargetRef
): TargetRef[] =>
  skill.targetType === 'all-enemies' && isTargetEffect(atom)
    ? state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [{ type: 'enemy' as const, index }] : []))
    : [fallback];

const targetForSkill = (state: CombatState, skill: FlipSkillDef, target?: number): TargetRef => {
  if (skill.targetType === 'self') return { type: 'player' };
  if (skill.targetType === 'single-enemy') {
    if (target === undefined || !isAliveEnemy(state, target)) {
      throw new Error('target enemy is not alive');
    }
    return { type: 'enemy', index: target };
  }
  const fallback = firstAliveEnemy(state);
  if (fallback === undefined) throw new Error('no living enemy target');
  return { type: 'enemy', index: fallback };
};

const collectEffects = (
  skill: FlipSkillDef,
  faces: readonly Face[],
  coinElements: readonly (readonly Element[])[] = [],
  overheatActive = false
): EffectAtom[] => {
  const headCount = faces.filter((face) => face === 'heads').length;
  const tailCount = faces.length - headCount;
  const effects: EffectAtom[] = [...skill.base];
  const addFaceEffects = (line: FlipSkillDef['heads'], count: number) => {
    if (line === undefined || count === 0) return;
    const repeats = line.mode === 'any' ? 1 : count;
    for (let i = 0; i < repeats; i += 1) effects.push(...line.effects);
  };
  addFaceEffects(skill.heads, headCount);
  addFaceEffects(skill.tails, tailCount);
  if (headCount > 0 && tailCount > 0) effects.push(...(skill.mixed?.effects ?? []));
  // P7 D5 — 특정 속성 코인 면 보너스 (일반 면 보너스와 합산, 코인·면당 1회)
  for (const bonus of skill.elementFaces ?? []) {
    for (let i = 0; i < faces.length; i += 1) {
      if (faces[i] === bonus.face && (coinElements[i] ?? []).includes(bonus.element)) {
        effects.push(...bonus.effects);
      }
    }
  }
  // P7 D5 — 과열 강화 분기 (해결 후 소비는 resolveFlip finish에서).
  // 피해 전용 보너스는 기본 피해와 같은 타격으로 합산되도록 기본부의 마지막 피해
  // 원자 뒤에 삽입한다 (화염 정권 10→14 단일 타격 — 감사 보정).
  const overheatBonus = overheatActive ? (skill.overheatBonus ?? []) : [];
  if (overheatBonus.length > 0) {
    if (overheatBonus.every((atom) => atom.kind === 'damage')) {
      let insertAt = -1;
      for (let i = 0; i < skill.base.length; i += 1) {
        if (skill.base[i]!.kind === 'damage') insertAt = i;
      }
      if (insertAt >= 0) effects.splice(insertAt + 1, 0, ...overheatBonus);
      else effects.push(...overheatBonus);
    } else {
      effects.push(...overheatBonus);
    }
  }

  let damage = 0;
  const combined: EffectAtom[] = [];
  for (const effect of effects) {
    if (effect.kind === 'damage') {
      damage += effect.amount;
    } else {
      if (damage > 0) {
        combined.push({ kind: 'damage', amount: damage });
        damage = 0;
      }
      combined.push(effect);
    }
  }
  if (damage > 0) combined.push({ kind: 'damage', amount: damage });
  return combined;
};

export const resolveFlip = (
  input: CombatState,
  slot: SlotId,
  skill: FlipSkillDef,
  target: number | undefined,
  db: ContentDb,
  chosen?: readonly CoinUid[],
  summonChoice?: { chosenEquipment?: EquipmentDefId; chosenSummon?: number }
): ResolveResult => {
  const slotState = input.slots[Number(slot)];
  if (slotState === undefined) throw new Error('slot does not exist');
  if (slotState.cooldownRemaining > 0) throw new Error('skill is cooling down');
  if (skill.oncePerCombat === true && slotState.usedThisCombat) throw new Error('skill already used this combat');

  const placed = input.zones.placed[slot] ?? [];
  if (placed.length !== skill.cost) throw new Error('placed coin count must equal skill cost');
  const skillTarget = targetForSkill(input, skill, target);
  const events: CombatEvent[] = [{ type: 'skillUsed', slot, skill: skill.id, kind: 'flip' }];
  const turnTriggerScope = input.turnTriggers;
  const passiveMechanics = new Set(
    input.passives.flatMap((id) => {
      const mechanic = (db.passives ?? {})[String(id)]?.mechanic;
      return mechanic === undefined ? [] : [mechanic];
    })
  );
  let returnFirstCoinToHand = false;
  let retrievalCoin: CoinUid | undefined;
  const residualCoin = !input.player.residualChargeUsed && passiveMechanics.has('residualCharge')
    ? placed.find((uid) => {
        const coin = input.coins[Number(uid)];
        return coin !== undefined && effectiveElements(coin, db).includes('lightning');
      })
    : undefined;
  // P7 D5 — 과열 강화 분기 보유 스킬이 성공 해결되면 해결 후 과열 소비 (finish 단일 경로)
  const consumesOverheat = input.player.overheat && (skill.overheatBonus?.length ?? 0) > 0;
  const finish = (finishedState: CombatState): ResolveResult => {
    const handCoin = returnFirstCoinToHand ? placed[0] : undefined;
    const routedToDraw = new Set(
      [retrievalCoin, residualCoin].filter(
        (coin): coin is CoinUid => coin !== undefined && coin !== handCoin
      )
    );
    // Cost order is the deterministic top-of-draw order. Two passives may route
    // different coins, while a coin claimed by both is returned only once.
    const topDraw = placed.filter((coin) => routedToDraw.has(coin));
    const discarded = placed.filter((coin) => coin !== handCoin && !routedToDraw.has(coin));
    events.push({ type: 'coinsDiscarded', coins: [...discarded], reason: 'skillCost' });
    let state = {
      ...finishedState,
      player: {
        ...finishedState.player,
        retrievalHabitUsed: finishedState.player.retrievalHabitUsed || retrievalCoin !== undefined,
        residualChargeUsed: finishedState.player.residualChargeUsed || residualCoin !== undefined
      },
      zones: {
        ...finishedState.zones,
        placed: { ...finishedState.zones.placed, [slot]: [] },
        hand: handCoin === undefined ? finishedState.zones.hand : [...finishedState.zones.hand, handCoin],
        draw: topDraw.length === 0 ? finishedState.zones.draw : [...topDraw, ...finishedState.zones.draw],
        discard: [...finishedState.zones.discard, ...discarded]
      }
    };
    if (consumesOverheat && state.player.overheat) {
      events.push({ type: 'overheatConsumed', skill: skill.id });
      state = { ...state, player: { ...state.player, overheat: false } };
    }
    return { state, events };
  };

  let state: CombatState = {
    ...input,
    slots: input.slots.map((candidate, index) =>
      index === Number(slot)
        ? {
            ...candidate,
            cooldownRemaining: skillCooldown(skill),
            usedThisCombat: candidate.usedThisCombat || skill.oncePerCombat === true
          }
        : candidate
    )
  };

  const rng = state.rngImpl?.flip ?? rngFrom(state.rng.flip);
  const faces: Face[] = [];
  for (const coin of placed) {
    const face = rng.flip();
    faces.push(face);
    events.push({ type: 'coinFlipped', coin, face });
  }
  state = { ...state, rng: { ...state.rng, flip: rng.snapshot() } };

  const coinElements = placed.map((coin) => {
    const instance = state.coins[Number(coin)];
    return instance === undefined ? [] : effectiveElements(instance, db);
  });
  const applyResolution = (
    resolutionFaces: Face[],
    resolutionElements: readonly (readonly Element[])[],
    isReuse: boolean,
    includeBase = true,
    resolutionCoins: readonly CoinUid[] = placed,
    effectSkill: FlipSkillDef = skill
  ): boolean => {
    const tailsCount = resolutionFaces.filter((face) => face === 'tails').length;
    const headsCount = resolutionFaces.length - tailsCount;
    const resolutionSkill = includeBase ? effectSkill : { ...effectSkill, base: [] };
    const effects = collectEffects(resolutionSkill, resolutionFaces, resolutionElements, includeBase && input.player.overheat);
    if (includeBase && !isReuse && input.zones.hand.length === 0 && !state.player.lastMoveUsed && passiveMechanics.has('lastMove')) {
      if (effects.some((atom) => atom.kind === 'damage')) effects.push({ kind: 'damage', amount: 2 });
      if (effects.some((atom) => atom.kind === 'block')) effects.push({ kind: 'block', amount: 2 });
      state = { ...state, player: { ...state.player, lastMoveUsed: true } };
    }
    if (resolutionFaces.includes('heads') && resolutionFaces.includes('tails') && !state.player.balanceSenseUsed && passiveMechanics.has('balanceSense')) {
      effects.push({ kind: 'block', amount: 3 });
      state = { ...state, player: { ...state.player, balanceSenseUsed: true } };
    }
    if (isReuse && skill.tags.includes('attack') && !state.player.overcurrentUsed && passiveMechanics.has('overcurrent') && resolutionElements.some((elements) => elements.includes('lightning'))) {
      effects.push({ kind: 'damage', amount: 2 }, { kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' });
      state = { ...state, player: { ...state.player, overcurrentUsed: true } };
    }
    for (const atom of effects) {
      for (const effectTarget of targetsForSkillEffect(state, atom, skill, skillTarget)) {
        state = applyEffectAtom(state, atom, effectTarget, db, events, chosen, {
          turnTriggerScope, tailsCount, headsCount, isReuse,
          chosenEquipment: summonChoice?.chosenEquipment,
          chosenSummon: summonChoice?.chosenSummon,
          sourceSlot: slot
        });
        if (state.phase === 'victory' || state.phase === 'defeat') return false;
      }
    }
    for (let i = 0; i < resolutionFaces.length; i += 1) {
      const coin = state.coins[Number(resolutionCoins[i])];
      const face = resolutionFaces[i];
      if (coin === undefined || face === undefined) continue;
      for (const element of effectiveElements(coin, db)) {
        const procs = Object.values(db.coins).find((def) => def.element === element)?.procs;
        const atoms = face === 'heads' ? procs?.heads : procs?.tails;
        for (const atom of atoms ?? []) {
          for (const procTarget of targetsForElementProc(state, atom, skill, skillTarget, target)) {
            state = applyEffectAtom(state, atom, procTarget, db, events, undefined, { turnTriggerScope, isReuse });
            if (state.phase === 'victory' || state.phase === 'defeat') return false;
          }
        }
      }
    }
    return true;
  };

  const character = db.characters[String(input.characterId)];
  const canRemise = character?.trait.mechanic === 'remise' && input.player.remiseCharges > 0;
  const fireAttackResolved = (): void => {
    if (state.phase !== 'victory' && state.phase !== 'defeat' && skill.tags.includes('attack')) {
      state = fireTurnTriggers(state, 'onAttackSkillResolved', skillTarget, db, events, turnTriggerScope);
    }
  };

  let reuseAfterPrimary = false;
  if (!canRemise) {
    if (!applyResolution(faces, coinElements, false)) return finish(state);
    fireAttackResolved();
  } else {
    // Remise resolves the first physical coin before the rest of the skill:
    // first face/proc -> immediate reflip face/proc -> base -> remaining coins.
    // This keeps the reflip observable even when a later base/coin effect is lethal.
    const appliedAnyFaces = new Set<Face>();
    const applyInitialCoin = (index: number, face: Face, separateResolution = false): boolean => {
      const section = face === 'heads' ? skill.heads : skill.tails;
      const allowSection = section?.mode !== 'any' || separateResolution || !appliedAnyFaces.has(face);
      if (!separateResolution && section?.mode === 'any') appliedAnyFaces.add(face);
      const coinSkill: FlipSkillDef = {
        ...skill,
        base: [],
        heads: face === 'heads' && allowSection ? skill.heads : undefined,
        tails: face === 'tails' && allowSection ? skill.tails : undefined,
        mixed: undefined,
        overheatBonus: undefined
      };
      return applyResolution(
        [face],
        [coinElements[index] ?? []],
        false,
        false,
        [placed[index]!],
        coinSkill
      );
    };

    state = { ...state, player: { ...state.player, remiseCharges: Math.max(0, state.player.remiseCharges - 1) } };
    events.push({ type: 'remiseChecked', coin: placed[0]!, face: faces[0]! });
    const firstContinues = applyInitialCoin(0, faces[0]!);
    if (faces[0] === 'heads') {
      const reflip = rng.flip();
      events.push({ type: 'remiseReflipped', coin: placed[0]!, face: reflip });
      events.push({ type: 'coinFlipped', coin: placed[0]!, face: reflip });
      if (!state.player.retrievalHabitUsed && passiveMechanics.has('retrievalHabit')) retrievalCoin = placed[0];
      state = { ...state, rng: { ...state.rng, flip: rng.snapshot() } };
      reuseAfterPrimary = reflip === 'heads' || skill.remise?.reuseOnReflipTails === true;
      if (firstContinues && !applyInitialCoin(0, reflip, true)) return finish(state);
    }
    if (!firstContinues || state.phase === 'victory' || state.phase === 'defeat') return finish(state);

    const baseOnlySkill: FlipSkillDef = {
      ...skill,
      heads: undefined,
      tails: undefined,
      mixed: undefined
    };
    if (!applyResolution([], [], false, true, [], baseOnlySkill)) return finish(state);
    for (let index = 1; index < faces.length; index += 1) {
      if (!applyInitialCoin(index, faces[index]!)) return finish(state);
    }
    if (faces.includes('heads') && faces.includes('tails')) {
      if (!state.player.balanceSenseUsed && passiveMechanics.has('balanceSense')) {
        state = applyEffectAtom(state, { kind: 'block', amount: 3 }, { type: 'player' }, db, events);
        state = { ...state, player: { ...state.player, balanceSenseUsed: true } };
      }
      for (const atom of skill.mixed?.effects ?? []) {
        for (const effectTarget of targetsForSkillEffect(state, atom, skill, skillTarget)) {
          state = applyEffectAtom(state, atom, effectTarget, db, events, chosen, {
            turnTriggerScope,
            tailsCount: faces.filter((face) => face === 'tails').length,
            headsCount: faces.filter((face) => face === 'heads').length,
            chosenEquipment: summonChoice?.chosenEquipment,
            chosenSummon: summonChoice?.chosenSummon,
            sourceSlot: slot
          });
          if (state.phase === 'victory' || state.phase === 'defeat') return finish(state);
        }
      }
    }
    fireAttackResolved();
  }

  if (reuseAfterPrimary && state.phase !== 'victory' && state.phase !== 'defeat') {
    const reuseFaces = placed.map((coin) => {
      const face = rng.flip();
      events.push({ type: 'coinFlipped', coin, face });
      return face;
    });
    events.push({ type: 'remiseReused', skill: skill.id });
    state = { ...state, rng: { ...state.rng, flip: rng.snapshot() } };
    const reuseContinues = applyResolution(reuseFaces, coinElements, true);
    fireAttackResolved();
    if (!reuseContinues) return finish(state);
    if (skill.remise?.returnFirstCoinOnReuse === true) returnFirstCoinToHand = true;
    if ((skill.remise?.addLightningToHandAfterReuse ?? 0) > 0) {
      const lightning = Object.values(db.coins).find((def) => def.element === 'lightning')?.id;
      if (lightning !== undefined) state = applyEffectAtom(state, { kind: 'addCoin', coin: lightning, zone: 'hand', count: skill.remise!.addLightningToHandAfterReuse! }, { type: 'player' }, db, events);
    }
    if (!state.player.continuousMotionUsed && passiveMechanics.has('continuousMotion')) {
      const drawn = drawCards(state, 1);
      state = { ...drawn.state, player: { ...drawn.state.player, continuousMotionUsed: true } };
      events.push(...drawn.events);
    }
  }

  state = checkCombatEnd(state, events);
  return finish(state);
};
