import type {
  StatusId, ContentDb, EffectAtom, FlipSkillDef, TargetRef } from '../../content-types';
import { effectiveElements } from '../../content-types';
import type { EquipmentDefId, CoinUid, Face, SlotId } from '../../ids';
import { rngFrom } from '../../rng';
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
  chosenEquipment?: EquipmentDefId;
  chosenSummon?: number;
  suppressTurnTriggers?: boolean;
  turnTriggerScope?: readonly TurnTriggerInstance[];
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

    if (atom.zone === 'hand' && nextState.zones.hand.length < 10) {
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
    // P6 D5 — 과열: 손의 화염 코인 수 참조
    case 'damagePerFireInHand': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const fireInHand = state.zones.hand.filter((coin) => {
        const instance = state.coins[Number(coin)];
        return instance !== undefined && effectiveElements(instance, db).includes('fire');
      }).length;
      if (fireInHand <= 0) return state;
      const damaged = applyDamage(state, target, fireInHand * atom.amountPerCoin, 'skill', events, { type: 'player' });
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

const targetForElementProc = (state: CombatState, atom: EffectAtom, skillTarget: TargetRef): TargetRef | undefined => {
  // 적대 상태(화상·동상·감전)만 명시 집합으로 라우팅 — self 스킬에 속성 코인을 장전해도
  // 플레이어가 자기 상태를 뒤집어쓰지 않는다. 미래의 우호/미지 상태는 skillTarget 유지
  // (P3.4 감사 2건: burn 전용 결함 수정 + 전량 강제 라우팅의 과잉 일반화 방지)
  if (atom.kind === 'applyStatus' && atom.to === 'target' && HOSTILE_STATUSES.has(atom.status)) {
    if (skillTarget.type === 'enemy' && isAliveEnemy(state, skillTarget.index)) return skillTarget;
    const fallback = firstAliveEnemy(state);
    return fallback === undefined ? undefined : { type: 'enemy', index: fallback };
  }
  if (atom.kind === 'applyStatus' && atom.to === 'self') return { type: 'player' };
  return skillTarget;
};

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

const collectEffects = (skill: FlipSkillDef, faces: readonly Face[]): EffectAtom[] => {
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
  if (input.skillUsesThisTurn >= 3) throw new Error('skill use cap reached');
  const slotState = input.slots[Number(slot)];
  if (slotState === undefined) throw new Error('slot does not exist');
  if (slotState.usedThisTurn) throw new Error('skill already used this turn');
  if (skill.oncePerCombat === true && slotState.usedThisCombat) throw new Error('skill already used this combat');

  const placed = input.zones.placed[slot] ?? [];
  if (placed.length !== skill.cost) throw new Error('placed coin count must equal skill cost');
  const skillTarget = targetForSkill(input, skill, target);
  const events: CombatEvent[] = [{ type: 'skillUsed', slot, skill: skill.id, kind: 'flip' }];
  const turnTriggerScope = input.turnTriggers;
  const finish = (finishedState: CombatState): ResolveResult => {
    events.push({ type: 'coinsDiscarded', coins: [...placed], reason: 'skillCost' });
    return {
      state: {
        ...finishedState,
        zones: {
          ...finishedState.zones,
          placed: { ...finishedState.zones.placed, [slot]: [] },
          discard: [...finishedState.zones.discard, ...placed]
        }
      },
      events
    };
  };

  let state: CombatState = {
    ...input,
    slots: input.slots.map((candidate, index) =>
      index === Number(slot)
        ? { ...candidate, usedThisTurn: true, usedThisCombat: candidate.usedThisCombat || skill.oncePerCombat === true }
        : candidate
    ),
    skillUsesThisTurn: input.skillUsesThisTurn + 1
  };

  const rng = state.rngImpl?.flip ?? rngFrom(state.rng.flip);
  const faces: Face[] = [];
  for (const coin of placed) {
    const face = rng.flip();
    faces.push(face);
    events.push({ type: 'coinFlipped', coin, face });
  }
  state = { ...state, rng: { ...state.rng, flip: rng.snapshot() } };

  const tailsCount = faces.filter((face) => face === 'tails').length;
  for (const atom of collectEffects(skill, faces)) {
    state = applyEffectAtom(state, atom, skillTarget, db, events, chosen, {
      turnTriggerScope,
      tailsCount,
      chosenEquipment: summonChoice?.chosenEquipment,
      chosenSummon: summonChoice?.chosenSummon
    });
    if (state.phase === 'victory' || state.phase === 'defeat') return finish(state);
  }

  for (let i = 0; i < placed.length; i += 1) {
    const coin = state.coins[Number(placed[i])];
    const face = faces[i];
    if (coin === undefined || face === undefined) continue;
    for (const element of effectiveElements(coin, db)) {
      const proc = Object.values(db.coins).find((def) => def.element === element)?.proc;
      if (proc === undefined || proc.face !== face) continue;
      for (const atom of proc.effects) {
        const procTarget = targetForElementProc(state, atom, skillTarget);
        if (procTarget === undefined) continue;
        state = applyEffectAtom(state, atom, procTarget, db, events, undefined, { turnTriggerScope });
        if (state.phase === 'victory' || state.phase === 'defeat') return finish(state);
      }
    }
  }

  state = checkCombatEnd(state, events);
  if (state.phase !== 'victory' && state.phase !== 'defeat' && skill.tags.includes('attack')) {
    state = fireTurnTriggers(state, 'onAttackSkillResolved', skillTarget, db, events, turnTriggerScope);
  }
  return finish(state);
};
