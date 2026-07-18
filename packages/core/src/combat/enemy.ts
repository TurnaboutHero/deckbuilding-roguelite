import { DURATION_STATUS_IDS } from '../content-types';
import type { ContentDb, EnemyIntent, StatusId } from '../content-types';
import { rngFrom } from '../rng';
import type { CombatEvent } from './events';
import { applyBlock, applyDamage, applyEffectAtom, checkCombatEnd } from './resolve/flip';
import { statusStacks, statusTurns } from './state';
import type { CombatState } from './state';

export const nextIntent = (state: CombatState, enemyIndex: number, db: ContentDb): { intent: EnemyIntent; index: number } => {
  const enemy = state.enemies[enemyIndex];
  if (enemy === undefined) throw new Error('enemy does not exist');
  const def = db.enemies[String(enemy.defId)];
  if (def === undefined || def.intents.length === 0) throw new Error('enemy has no intents');
  const intents = enemy.phaseIndex === undefined ? def.intents : (def.phases?.[enemy.phaseIndex]?.intents ?? def.intents);
  const index = (enemy.intentIndex + 1) % intents.length;
  const baseIntent = intents[index];
  if (baseIntent === undefined) throw new Error('enemy intent missing');
  const intent =
    baseIntent.growthBranch !== undefined && (enemy.growthStacks ?? 0) >= baseIntent.growthBranch.atLeast
      ? baseIntent.growthBranch.intent
      : baseIntent;
  return { intent, index };
};

export const initialIntent = (defId: string, db: ContentDb): { intent: EnemyIntent; index: number } => {
  const def = db.enemies[defId];
  const intent = def?.intents[0];
  if (def === undefined || intent === undefined) throw new Error('enemy has no initial intent');
  return { intent, index: 0 };
};

const lowestHpAlly = (state: CombatState, enemyIndex: number): number | undefined => {
  let result: number | undefined;
  let lowest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < state.enemies.length; index += 1) {
    if (index === enemyIndex) continue;
    const enemy = state.enemies[index];
    if (enemy === undefined || enemy.hp <= 0) continue;
    const fraction = enemy.hp / enemy.maxHp;
    if (fraction < lowest) {
      lowest = fraction;
      result = index;
    }
  }
  return result;
};

const bindHealAlly = (state: CombatState, enemyIndex: number, intent: EnemyIntent): number | undefined =>
  intent.actions.some((action) => action.kind === 'healAlly') ? lowestHpAlly(state, enemyIndex) : undefined;

const withEnemy = (state: CombatState, enemyIndex: number, update: (enemy: CombatState['enemies'][number]) => CombatState['enemies'][number]): CombatState => ({
  ...state,
  enemies: state.enemies.map((enemy, index) => (index === enemyIndex ? update(enemy) : enemy))
});

const CLEANSE_ORDER: readonly StatusId[] = ['burn', 'poison', 'frostbite', 'shock', 'healLock'];

const maybeStartWindup = (state: CombatState, enemyIndex: number, events: CombatEvent[]): { state: CombatState; started: boolean } => {
  const enemy = state.enemies[enemyIndex];
  if (
    enemy === undefined ||
    enemy.windup !== undefined ||
    enemy.intent.windup === undefined ||
    enemy.cancelledWindupIntentId === enemy.intent.id
  ) {
    return { state, started: false };
  }
  const boundHealAlly = bindHealAlly(state, enemyIndex, enemy.intent);
  const windup = {
    intent: enemy.intent,
    turnsLeft: enemy.intent.windup.turns,
    startHp: enemy.hp,
    ...(enemy.intent.cancelOn === undefined ? {} : { cancelThreshold: enemy.intent.cancelOn.damageThreshold }),
    ...(boundHealAlly === undefined ? {} : { boundHealAlly })
  };
  events.push({
    type: 'enemyWindupStarted',
    enemy: enemyIndex,
    intent: enemy.intent,
    turnsLeft: windup.turnsLeft,
    ...(windup.cancelThreshold === undefined ? {} : { cancelThreshold: windup.cancelThreshold })
  });
  return { state: withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, windup, boundHealAlly })), started: true };
};

const maybeChangePhase = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  if (enemy === undefined || def?.phases === undefined || enemy.phaseIndex !== undefined) return state;
  const phaseIndex = def.phases.findIndex((phase) => enemy.hp / enemy.maxHp < phase.hpBelowFraction);
  if (phaseIndex < 0) return state;
  const phase = def.phases[phaseIndex];
  if (phase === undefined) return state;
  events.push({ type: 'enemyPhaseChanged', enemy: enemyIndex });
  return withEnemy(state, enemyIndex, (candidate) => ({
    ...candidate,
    phaseIndex,
    intentIndex: -1,
    damageTakenMultiplier: phase.damageTakenMultiplier
  }));
};

const tickEnemyDurations = (input: CombatState, enemyIndex: number, events: CombatEvent[], preserveShock = false): CombatState => {
  const enemy = input.enemies[enemyIndex];
  if (enemy === undefined) return input;
  let statuses = enemy.statuses;
  for (const status of DURATION_STATUS_IDS) {
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
  let state: CombatState = {
    ...input,
    phase: 'enemy',
    player: { ...input.player, armorEchoAbsorbedThisEnemyTurn: 0, precisionDefenseSatisfied: false, armorEchoAvailable: false }
  };

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
    if (enemy.roundGrowth !== undefined && (enemy.growthStacks ?? 0) > 0) {
      const requested = Math.round(
        enemy.maxHp * enemy.roundGrowth.healMaxHpFractionPerStack * (enemy.growthStacks ?? 0)
      );
      const hp = Math.min(enemy.maxHp, enemy.hp + requested);
      if (hp > enemy.hp) {
        state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, hp }));
        events.push({ type: 'enemyHealed', enemy: enemyIndex, amount: hp - enemy.hp, hp });
      }
    }
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
          throw new Error(`enemy passive ${passive.id}: unsupported action ${String(action.kind)}`);
        }
      }
    }
    const started = maybeStartWindup(state, enemyIndex, events);
    state = started.state;
    if (started.started) continue;
    const windupEnemy = state.enemies[enemyIndex];
    if (windupEnemy !== undefined && windupEnemy.cancelledWindupIntentId === windupEnemy.intent.id) continue;
    if (windupEnemy?.windup !== undefined) {
      const damageTaken = Math.max(0, windupEnemy.windup.startHp - windupEnemy.hp);
      if (windupEnemy.windup.cancelThreshold !== undefined && damageTaken >= windupEnemy.windup.cancelThreshold) {
        events.push({ type: 'enemyWindupCancelled', enemy: enemyIndex, intent: windupEnemy.windup.intent });
        state = withEnemy(state, enemyIndex, (candidate) => ({
          ...candidate,
          windup: undefined,
          boundHealAlly: undefined,
          cancelledWindupIntentId: windupEnemy.windup?.intent.id
        }));
        continue;
      }
      if (windupEnemy.windup.turnsLeft > 1) {
        const turnsLeft = windupEnemy.windup.turnsLeft - 1;
        events.push({ type: 'enemyWindupTicked', enemy: enemyIndex, intent: windupEnemy.windup.intent, turnsLeft });
        state = withEnemy(state, enemyIndex, (candidate) => ({
          ...candidate,
          windup: candidate.windup === undefined ? undefined : { ...candidate.windup, turnsLeft }
        }));
        continue;
      }
      events.push({ type: 'enemyWindupTicked', enemy: enemyIndex, intent: windupEnemy.windup.intent, turnsLeft: 0 });
      state = withEnemy(state, enemyIndex, (candidate) => ({
        ...candidate,
        intent: windupEnemy.windup?.intent ?? candidate.intent,
        windup: undefined,
        boundHealAlly: windupEnemy.windup?.boundHealAlly
      }));
    } else if (windupEnemy !== undefined && windupEnemy.boundHealAlly === undefined) {
      const boundHealAlly = bindHealAlly(state, enemyIndex, windupEnemy.intent);
      if (boundHealAlly !== undefined) {
        state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, boundHealAlly }));
      }
    }
    let lastAttackHpDamage = 0;
    let lastAttackBlockedAmount = 0;
    let lastAttackBlocked = false;
    for (const action of state.enemies[enemyIndex]?.intent.actions ?? []) {
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
        let hpDamage = 0;
        let blocked = 0;
        const growthStacks = actingEnemy.growthStacks ?? 0;
        const baseDamage =
          action.damagePerGrowthPercent === undefined
            ? action.damage + growthStacks
            : Math.round(action.damage * (1 + growthStacks * action.damagePerGrowthPercent));
        for (let hit = 0; hit < hits; hit += 1) {
          const beforeEventCount = events.length;
          // P6 D1 — 막별 스케일은 공격 피해에만 적용(버프 보너스는 원수치 가산)
          state = applyDamage(
            state,
            { type: 'player' },
            Math.round(baseDamage * (state.enemyScale ?? 1)) + (hit === 0 ? bonus : 0),
            'enemy',
            events,
            { type: 'enemy', index: enemyIndex }
          );
          const event = events.slice(beforeEventCount).find((candidate) => candidate.type === 'damageDealt' && candidate.target.type === 'player');
          if (event?.type === 'damageDealt') {
            hpDamage += event.amount;
            blocked += event.blocked;
          }
          if (state.phase === 'defeat') return { state, events };
        }
        lastAttackHpDamage = hpDamage;
        lastAttackBlockedAmount = blocked;
        lastAttackBlocked = hpDamage === 0 && blocked > 0;
      } else if (action.kind === 'conditionalAttack') {
        const bonusDamage = state.player.hp < state.player.maxHp / 2 ? action.bonusDamage : 0;
        const beforeEventCount = events.length;
        state = applyDamage(
          state,
          { type: 'player' },
          Math.round((action.damage + bonusDamage + (actingEnemy.growthStacks ?? 0)) * (state.enemyScale ?? 1)),
          'enemy',
          events,
          { type: 'enemy', index: enemyIndex }
        );
        const event = events.slice(beforeEventCount).find((candidate) => candidate.type === 'damageDealt' && candidate.target.type === 'player');
        lastAttackHpDamage = event?.type === 'damageDealt' ? event.amount : 0;
        lastAttackBlockedAmount = event?.type === 'damageDealt' ? event.blocked : 0;
        lastAttackBlocked = event?.type === 'damageDealt' ? event.amount === 0 && event.blocked > 0 : false;
        if (state.phase === 'defeat') return { state, events };
      } else if (action.kind === 'block') {
        state = applyBlock(state, { type: 'enemy', index: enemyIndex }, action.amount, events);
      } else if (action.kind === 'nextDrawPenalty') {
        if (action.amount < 0) throw new Error('next draw penalty amount cannot be negative');
        const nextDrawPenalty = state.player.nextDrawPenalty + action.amount;
        state = { ...state, player: { ...state.player, nextDrawPenalty } };
        events.push({ type: 'witherApplied', enemy: enemyIndex, amount: action.amount, nextDrawPenalty });
      } else if (action.kind === 'applyStatus') {
        if (action.requiresLastAttackHpDamage === true && lastAttackHpDamage <= 0) continue;
        if (action.requiresPlayerStatus !== undefined) {
          const current = Math.max(
            statusStacks(state.player.statuses, action.requiresPlayerStatus.status),
            statusTurns(state.player.statuses, action.requiresPlayerStatus.status)
          );
          if (current < action.requiresPlayerStatus.atLeast) continue;
        }
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
      } else if (action.kind === 'growOnUnblockedDamage') {
        const before = state.enemies[enemyIndex];
        if (before === undefined) continue;
        const resolvedDamage = lastAttackHpDamage + lastAttackBlockedAmount;
        const hpDamageFraction = resolvedDamage === 0 ? 0 : lastAttackHpDamage / resolvedDamage;
        const grows = lastAttackHpDamage > 0 && hpDamageFraction > (action.minHpDamageFraction ?? 0);
        const shrinks = action.loseOnFullBlock !== false && lastAttackBlocked;
        const stacks = Math.min(
          action.maxStacks ?? Number.MAX_SAFE_INTEGER,
          Math.max(0, (before.growthStacks ?? 0) + (grows ? action.amount : shrinks ? -action.amount : 0))
        );
        state = {
          ...state,
          enemies: state.enemies.map((candidate, index) => (index === enemyIndex ? { ...candidate, growthStacks: stacks } : candidate))
        };
        events.push({ type: 'enemyGrew', enemy: enemyIndex, stacks });
        if (grows && action.healOnGrow !== undefined) {
          const current = state.enemies[enemyIndex];
          if (current === undefined) continue;
          const hp = Math.min(current.maxHp, current.hp + action.healOnGrow);
          state = {
            ...state,
            enemies: state.enemies.map((candidate, index) => (index === enemyIndex ? { ...candidate, hp } : candidate))
          };
          events.push({ type: 'enemyHealed', enemy: enemyIndex, amount: hp - current.hp, hp });
        }
      } else if (action.kind === 'healAlly') {
        const target = actingEnemy.boundHealAlly ?? lowestHpAlly(state, enemyIndex);
        if (target === undefined || (state.enemies[target]?.hp ?? 0) <= 0) {
          events.push({ type: 'enemyHealFailed', enemy: enemyIndex, target: target ?? -1 });
          continue;
        }
        const before = state.enemies[target];
        if (before === undefined) continue;
        const hp = Math.min(before.maxHp, before.hp + action.amount);
        state = {
          ...state,
          enemies: state.enemies.map((candidate, index) => (index === target ? { ...candidate, hp } : candidate))
        };
        events.push({ type: 'enemyHealed', enemy: target, amount: hp - before.hp, hp });
        const cleansed = CLEANSE_ORDER.filter((status) => before.statuses[status] !== undefined).slice(0, action.cleanse ?? 0);
        if (cleansed.length > 0) {
          const statuses = { ...state.enemies[target]?.statuses };
          for (const status of cleansed) delete statuses[status];
          state = {
            ...state,
            enemies: state.enemies.map((candidate, index) => (index === target ? { ...candidate, statuses } : candidate))
          };
          events.push({ type: 'enemyCleansed', enemy: target, statuses: cleansed });
        }
      } else {
        // 미래 행동 타입이 조용히 buff로 흘러들지 않도록 컴파일 타임 exhaustiveness 고정
        const exhausted: never = action;
        throw new Error(`unknown enemy action: ${JSON.stringify(exhausted)}`);
      }
    }
    state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, boundHealAlly: undefined }));
  }

  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    for (const status of ['burn', 'poison'] as const) {
      const enemy = state.enemies[enemyIndex];
      const stacks = enemy === undefined ? 0 : statusStacks(enemy.statuses, status);
      if (enemy === undefined || enemy.hp <= 0 || stacks <= 0) continue;
      state = applyDamage(state, { type: 'enemy', index: enemyIndex }, stacks, status, events);
      const updated = state.enemies[enemyIndex];
      if (updated !== undefined) {
        const remaining = status === 'burn' ? Math.max(0, stacks - 1) : stacks;
        state = withEnemy(state, enemyIndex, (candidate) => ({
          ...candidate,
          statuses: { ...candidate.statuses, [status]: { kind: 'stack' as const, stacks: remaining } }
        }));
        events.push({ type: 'statusTicked', target: { type: 'enemy', index: enemyIndex }, status, amount: stacks, remaining });
      }
      state = checkCombatEnd(state, events);
      if (state.phase === 'victory') return { state, events };
    }
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

  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    if (enemy === undefined || enemy.hp <= 0 || enemy.roundGrowth === undefined) continue;
    const growth = enemy.roundGrowth;
    const damage = enemy.damageTakenThisRound ?? 0;
    const requestedRemoval =
      damage >= enemy.maxHp * growth.removeTwoAtHpFraction
        ? 2
        : damage >= enemy.maxHp * growth.removeOneAtHpFraction
          ? 1
          : 0;
    const removed = Math.min(enemy.growthStacks ?? 0, requestedRemoval);
    const afterRemoval = Math.max(0, (enemy.growthStacks ?? 0) - removed);
    const stacks = Math.min(growth.maxStacks, afterRemoval + growth.gainPerRound);
    if (removed > 0) {
      events.push({
        type: 'enemyGrowthReduced',
        enemy: enemyIndex,
        removed,
        stacks: afterRemoval,
        damage,
        threshold: Math.ceil(enemy.maxHp * (removed >= 2 ? growth.removeTwoAtHpFraction : growth.removeOneAtHpFraction))
      });
    }
    if (stacks > afterRemoval) events.push({ type: 'enemyGrew', enemy: enemyIndex, stacks });
    state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, growthStacks: stacks, damageTakenThisRound: 0 }));
  }

  const baseEcho = Math.min(state.player.armorEchoAbsorbedThisEnemyTurn, 6);
  const preheat = state.player.armorEchoAbsorbedThisEnemyTurn > 0 ? state.player.echoPreheat : 0;
  const precision = state.player.armorEchoAbsorbedThisEnemyTurn > 0 && state.player.precisionDefenseSatisfied ? 4 : 0;
  const total = Math.min(12, baseEcho + preheat + precision);
  events.push({ type: 'echoComputed', base: baseEcho, preheat, precision, total });
  state = {
    ...state,
    player: {
      ...state.player,
      armorEcho: total,
      armorEchoAvailable: false,
      armorEchoAbsorbedThisEnemyTurn: 0,
      echoPreheat: 0,
      precisionDefenseArmed: false,
      precisionDefenseSatisfied: false
    }
  };

  const ai = state.rngImpl?.ai ?? rngFrom(state.rng.ai);
  void ai.int(1);
  state = { ...state, rng: { ...state.rng, ai: ai.snapshot() } };
  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    if (enemy === undefined || enemy.hp <= 0 || enemy.windup !== undefined) continue;
    state = maybeChangePhase(state, enemyIndex, db, events);
    const next = nextIntent(state, enemyIndex, db);
    const boundHealAlly = bindHealAlly(state, enemyIndex, next.intent);
    events.push({ type: 'intentRevealed', enemy: enemyIndex, intent: next.intent });
    state = withEnemy(state, enemyIndex, (candidate) => ({
      ...candidate,
      intent: next.intent,
      intentIndex: next.index,
      boundHealAlly,
      cancelledWindupIntentId: undefined
    }));
  }

  return { state, events };
};
