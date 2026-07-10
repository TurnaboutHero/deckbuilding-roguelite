import type { ContentDb, EffectAtom, FlipSkillDef, TargetRef } from '../../content-types';
import { effectiveElements } from '../../content-types';
import type { CoinUid, Face, SlotId } from '../../ids';
import { rngFrom } from '../../rng';
import type { CombatEvent } from '../events';
import type { CombatState } from '../state';

export interface ResolveResult {
  state: CombatState;
  events: CombatEvent[];
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

export const applyDamage = (
  state: CombatState,
  target: TargetRef,
  amount: number,
  source: 'skill' | 'burn' | 'enemy' | 'self',
  events: CombatEvent[]
): CombatState => {
  if (amount < 0) throw new Error('damage amount cannot be negative');
  if (target.type === 'player') {
    const blocked = source === 'burn' ? 0 : Math.min(state.player.block, amount);
    const hpDamage = amount - blocked;
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
  const blocked = source === 'burn' ? 0 : Math.min(enemy.block, amount);
  const hpDamage = amount - blocked;
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
  events: CombatEvent[]
): CombatState => {
  if (atom.scope !== 'allBasicInHand') throw new Error(`unsupported grant scope: ${atom.scope}`);
  const targets = state.zones.hand.filter((coin) => {
    const instance = state.coins[Number(coin)];
    const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
    return def?.element === null;
  });
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
  events: CombatEvent[]
): CombatState => {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  switch (atom.kind) {
    case 'damage':
      return applyDamage(state, target, atom.amount, 'skill', events);
    case 'block':
      return applyBlock(state, { type: 'player' }, atom.amount, events);
    case 'selfDamage':
      return applyDamage(state, { type: 'player' }, atom.amount, 'self', events);
    case 'applyStatus': {
      const statusTarget = atom.to === 'self' ? { type: 'player' as const } : target;
      if (statusTarget.type === 'enemy' && !isAliveEnemy(state, statusTarget.index)) return state;
      if (atom.status !== 'burn') throw new Error(`unsupported status: ${atom.status}`);
      if (statusTarget.type === 'player') {
        const next = (state.player.statuses.burn ?? 0) + atom.stacks;
        events.push({ type: 'statusApplied', target: statusTarget, status: atom.status, stacks: atom.stacks });
        return { ...state, player: { ...state.player, statuses: { ...state.player.statuses, burn: next } } };
      }
      const enemies = state.enemies.map((enemy, index) =>
        index === statusTarget.index
          ? { ...enemy, statuses: { ...enemy.statuses, burn: (enemy.statuses.burn ?? 0) + atom.stacks } }
          : enemy
      );
      events.push({ type: 'statusApplied', target: statusTarget, status: atom.status, stacks: atom.stacks });
      return { ...state, enemies };
    }
    case 'addCoin':
      return addTemporaryCoin(state, atom, events);
    case 'grantElement':
      return grantElement(state, atom, db, events);
  }
};

const targetForElementProc = (state: CombatState, atom: EffectAtom, skillTarget: TargetRef): TargetRef | undefined => {
  if (atom.kind === 'applyStatus' && atom.status === 'burn' && atom.to === 'target') {
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
  db: ContentDb
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

  for (const atom of collectEffects(skill, faces)) {
    state = applyEffectAtom(state, atom, skillTarget, db, events);
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
        state = applyEffectAtom(state, atom, procTarget, db, events);
        if (state.phase === 'victory' || state.phase === 'defeat') return finish(state);
      }
    }
  }

  state = checkCombatEnd(state, events);
  return finish(state);
};
