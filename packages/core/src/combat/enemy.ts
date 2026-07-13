import type { ContentDb, EnemyIntent } from '../content-types';
import { rngFrom } from '../rng';
import type { CombatEvent } from './events';
import { applyBlock, applyDamage, applyEffectAtom, checkCombatEnd } from './resolve/flip';
import { statusStacks } from './state';
import type { CombatState } from './state';

export const nextIntent = (state: CombatState, enemyIndex: number, db: ContentDb): { intent: EnemyIntent; index: number } => {
  const enemy = state.enemies[enemyIndex];
  if (enemy === undefined) throw new Error('enemy does not exist');
  const def = db.enemies[String(enemy.defId)];
  if (def === undefined || def.intents.length === 0) throw new Error('enemy has no intents');
  const index = (enemy.intentIndex + 1) % def.intents.length;
  const intent = def.intents[index];
  if (intent === undefined) throw new Error('enemy intent missing');
  return { intent, index };
};

export const initialIntent = (defId: string, db: ContentDb): { intent: EnemyIntent; index: number } => {
  const def = db.enemies[defId];
  const intent = def?.intents[0];
  if (def === undefined || intent === undefined) throw new Error('enemy has no initial intent');
  return { intent, index: 0 };
};

const tickEnemyDurations = (input: CombatState, enemyIndex: number, events: CombatEvent[], preserveShock = false): CombatState => {
  const enemy = input.enemies[enemyIndex];
  if (enemy === undefined) return input;
  let statuses = enemy.statuses;
  for (const status of ['frostbite', 'shock'] as const) {
    if (status === 'shock' && preserveShock) continue;
    const current = statuses[status];
    if (current?.kind !== 'duration') continue;
    const turns = Math.max(0, current.turns - 1);
    const nextStatuses = { ...statuses };
    if (turns === 0) {
      delete nextStatuses[status];
    } else {
      nextStatuses[status] = { kind: 'duration', turns };
    }
    statuses = nextStatuses;
    events.push({ type: 'statusTicked', target: { type: 'enemy', index: enemyIndex }, status, amount: 0, remaining: 0, turns });
  }
  if (statuses === enemy.statuses) return input;
  return {
    ...input,
    enemies: input.enemies.map((candidate, index) => (index === enemyIndex ? { ...candidate, statuses } : candidate))
  };
};

export const runEnemyPhase = (input: CombatState, db: ContentDb): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state: CombatState = { ...input, phase: 'enemy' };

  state = {
    ...state,
    enemies: state.enemies.map((enemy, index) => {
      if (enemy.hp <= 0 || enemy.block === 0) return enemy;
      events.push({ type: 'blockCleared', target: { type: 'enemy', index }, amount: enemy.block });
      return { ...enemy, block: 0 };
    })
  };

  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    if (enemy === undefined || enemy.hp <= 0) continue;
    // 몬스터 패시브 — 자신 턴 시작 시 자동 발동 (자기 대상 원자만, 콘텐츠 검증이 보장).
    const passive = db.enemies[String(enemy.defId)]?.passive;
    if (passive !== undefined && passive.hook === 'enemyTurnStart') {
      events.push({ type: 'enemyPassiveTriggered', enemy: enemyIndex, passive: passive.id });
      for (const action of passive.effects) {
        const owner = state.enemies[enemyIndex];
        if (owner === undefined || owner.hp <= 0) break;
        if (action.kind === 'heal') {
          const hp = Math.min(owner.maxHp, owner.hp + action.amount);
          state = {
            ...state,
            enemies: state.enemies.map((candidate, index) => (index === enemyIndex ? { ...candidate, hp } : candidate))
          };
          events.push({ type: 'enemyHealed', enemy: enemyIndex, amount: hp - owner.hp, hp });
        } else if (action.kind === 'block') {
          state = applyBlock(state, { type: 'enemy', index: enemyIndex }, action.amount, events);
        } else if (action.kind === 'buffNextAttack') {
          const nextAttackBonus = owner.nextAttackBonus + action.amount;
          state = {
            ...state,
            enemies: state.enemies.map((candidate, index) =>
              index === enemyIndex ? { ...candidate, nextAttackBonus } : candidate
            )
          };
          events.push({ type: 'enemyAttackBuffed', enemy: enemyIndex, amount: action.amount, nextAttackBonus });
        } else {
          // 콘텐츠 검증(validateEnemyPassives)이 자기 대상 원자만 통과시킨다
          throw new Error(`enemy passive ${passive.id}: unsupported action ${action.kind}`);
        }
      }
    }
    for (const action of enemy.intent.actions) {
      const actingEnemy = state.enemies[enemyIndex];
      if (actingEnemy === undefined || actingEnemy.hp <= 0) break;
      if (action.kind === 'attack') {
        const hits = action.hits ?? 1;
        const bonus = actingEnemy.nextAttackBonus;
        if (bonus > 0) {
          state = {
            ...state,
            enemies: state.enemies.map((candidate, index) =>
              index === enemyIndex ? { ...candidate, nextAttackBonus: 0 } : candidate
            )
          };
        }
        for (let hit = 0; hit < hits; hit += 1) {
          // P6 D1 — 막별 스케일은 공격 피해에만 적용(버프 보너스는 원수치 가산)
          state = applyDamage(
            state,
            { type: 'player' },
            Math.round(action.damage * (state.enemyScale ?? 1)) + (hit === 0 ? bonus : 0),
            'enemy',
            events,
            { type: 'enemy', index: enemyIndex }
          );
          if (state.phase === 'defeat') return { state, events };
        }
      } else if (action.kind === 'block') {
        state = applyBlock(state, { type: 'enemy', index: enemyIndex }, action.amount, events);
      } else if (action.kind === 'nextDrawPenalty') {
        if (action.amount < 0) throw new Error('next draw penalty amount cannot be negative');
        const nextDrawPenalty = state.player.nextDrawPenalty + action.amount;
        state = { ...state, player: { ...state.player, nextDrawPenalty } };
        events.push({ type: 'witherApplied', enemy: enemyIndex, amount: action.amount, nextDrawPenalty });
      } else if (action.kind === 'applyStatus') {
        state = applyEffectAtom(
          state,
          { kind: 'applyStatus', status: action.status, stacks: action.stacks, to: 'self' },
          { type: 'player' },
          db,
          events
        );
      } else if (action.kind === 'heal') {
        if (action.amount < 0) throw new Error('heal amount cannot be negative');
        const before = state.enemies[enemyIndex];
        if (before === undefined) continue;
        const hp = Math.min(before.maxHp, before.hp + action.amount);
        state = {
          ...state,
          enemies: state.enemies.map((candidate, index) => (index === enemyIndex ? { ...candidate, hp } : candidate))
        };
        events.push({ type: 'enemyHealed', enemy: enemyIndex, amount: hp - before.hp, hp });
      } else if (action.kind === 'buffNextAttack') {
        if (action.amount < 0) throw new Error('attack buff amount cannot be negative');
        const before = state.enemies[enemyIndex];
        if (before === undefined) continue;
        const nextAttackBonus = before.nextAttackBonus + action.amount;
        state = {
          ...state,
          enemies: state.enemies.map((candidate, index) =>
            index === enemyIndex ? { ...candidate, nextAttackBonus } : candidate
          )
        };
        events.push({ type: 'enemyAttackBuffed', enemy: enemyIndex, amount: action.amount, nextAttackBonus });
      } else {
        // 미래 행동 타입이 조용히 buff로 흘러들지 않도록 컴파일 타임 exhaustiveness 고정
        const exhausted: never = action;
        throw new Error(`unknown enemy action: ${JSON.stringify(exhausted)}`);
      }
    }
  }

  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    const burn = enemy === undefined ? 0 : statusStacks(enemy.statuses, 'burn');
    if (enemy === undefined || enemy.hp <= 0 || burn <= 0) continue;
    state = applyDamage(state, { type: 'enemy', index: enemyIndex }, burn, 'burn', events);
    const updated = state.enemies[enemyIndex];
    if (updated !== undefined) {
      const enemies = state.enemies.map((candidate, index) =>
        index === enemyIndex
          ? { ...candidate, statuses: { ...candidate.statuses, burn: { kind: 'stack' as const, stacks: Math.max(0, burn - 1) } } }
          : candidate
      );
      state = { ...state, enemies };
      events.push({ type: 'statusTicked', target: { type: 'enemy', index: enemyIndex }, status: 'burn', amount: burn, remaining: Math.max(0, burn - 1) });
    }
    state = checkCombatEnd(state, events);
    if (state.phase === 'victory') return { state, events };
  }

  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    if (enemy === undefined || enemy.hp <= 0) continue;
    const suppressesDischarge = state.passives.some((id) => (db.passives ?? {})[String(id)]?.mechanic === 'dischargeSuppression');
    const maxShock = Math.max(0, ...state.enemies.map((candidate) => candidate.statuses.shock?.kind === 'duration' ? candidate.statuses.shock.turns : 0));
    const maxShockEnemyIndexes = state.enemies.flatMap((candidate, index) =>
      candidate.hp > 0 && candidate.statuses.shock?.kind === 'duration' && candidate.statuses.shock.turns === maxShock
        ? [index]
        : []
    );
    const preservedEnemyIndex = maxShockEnemyIndexes.includes(state.lastTargetedEnemy ?? -1)
      ? state.lastTargetedEnemy
      : maxShockEnemyIndexes[0];
    const preserveShock = suppressesDischarge && maxShock > 0 && enemyIndex === preservedEnemyIndex;
    state = tickEnemyDurations(state, enemyIndex, events, preserveShock);
  }

  const ai = state.rngImpl?.ai ?? rngFrom(state.rng.ai);
  void ai.int(1);
  state = { ...state, rng: { ...state.rng, ai: ai.snapshot() } };
  state = {
    ...state,
    enemies: state.enemies.map((enemy, index) => {
      if (enemy.hp <= 0) return enemy;
      const next = nextIntent(state, index, db);
      events.push({ type: 'intentRevealed', enemy: index, intent: next.intent });
      return { ...enemy, intent: next.intent, intentIndex: next.index };
    })
  };

  return { state, events };
};
