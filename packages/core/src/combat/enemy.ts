import type { ContentDb, EnemyIntent } from '../content-types';
import { rngFrom } from '../rng';
import type { CombatEvent } from './events';
import { applyBlock, applyDamage, checkCombatEnd } from './resolve/flip';
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

const tickEnemyDurations = (input: CombatState, enemyIndex: number, events: CombatEvent[]): CombatState => {
  const enemy = input.enemies[enemyIndex];
  if (enemy === undefined) return input;
  let statuses = enemy.statuses;
  for (const status of ['frostbite', 'shock'] as const) {
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
    for (const action of enemy.intent.actions) {
      if (action.kind === 'attack') {
        const hits = action.hits ?? 1;
        for (let hit = 0; hit < hits; hit += 1) {
          state = applyDamage(state, { type: 'player' }, action.damage, 'enemy', events, { type: 'enemy', index: enemyIndex });
          if (state.phase === 'defeat') return { state, events };
        }
      } else if (action.kind === 'block') {
        state = applyBlock(state, { type: 'enemy', index: enemyIndex }, action.amount, events);
      } else {
        if (action.amount < 0) throw new Error('next draw penalty amount cannot be negative');
        const nextDrawPenalty = state.player.nextDrawPenalty + action.amount;
        state = { ...state, player: { ...state.player, nextDrawPenalty } };
        events.push({ type: 'witherApplied', enemy: enemyIndex, amount: action.amount, nextDrawPenalty });
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
    state = tickEnemyDurations(state, enemyIndex, events);
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
