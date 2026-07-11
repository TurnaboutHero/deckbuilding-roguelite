import type { ContentDb } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, SkillId, SlotId } from '../ids';
import { derive, rngFrom, seedFromString } from '../rng';
import type { Command } from './commands';
import { initialIntent, runEnemyPhase } from './enemy';
import type { CombatEvent } from './events';
import { resolveConsume } from './resolve/consume';
import { applyDamage, applyEffectAtom, checkCombatEnd, resolveFlip } from './resolve/flip';
import { cloneState, statusStacks } from './state';
import type { CombatState, CombatZones } from './state';

export type StepResult = { ok: true; state: CombatState; events: CombatEvent[] } | { ok: false; error: string };

export interface CreateCombatConfig {
  character: CharacterId;
  enemies: readonly EnemyDefId[];
  bag?: readonly CoinDefId[];
  equippedSkills?: readonly SkillId[];
  currentHp?: number;
  maxHp?: number;
  combatIndex?: number;
  attempt?: number;
}

const slot = (value: number): SlotId => value as SlotId;
const uid = (value: number): CoinUid => value as CoinUid;

const emptyPlaced = (): Record<SlotId, CoinUid[]> => {
  const placed: Partial<Record<SlotId, CoinUid[]>> = {};
  for (let i = 0; i < 6; i += 1) placed[slot(i)] = [];
  return placed as Record<SlotId, CoinUid[]>;
};

const drawCards = (input: CombatState, count: number): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state = input;
  let draw = [...state.zones.draw];
  let discard = [...state.zones.discard];
  const rng = state.rngImpl?.shuffle ?? rngFrom(state.rng.shuffle);
  const drawn: CoinUid[] = [];
  let remaining = count;

  while (remaining > 0) {
    if (draw.length === 0) {
      if (discard.length === 0) break;
      events.push({ type: 'pileShuffled', count: discard.length });
      draw = rng.shuffle(discard);
      discard = [];
    }
    const coin = draw.shift();
    if (coin === undefined) break;
    drawn.push(coin);
    remaining -= 1;
  }

  if (drawn.length > 0) events.push({ type: 'coinsDrawn', coins: drawn });
  state = {
    ...state,
    rng: { ...state.rng, shuffle: rng.snapshot() },
    zones: { ...state.zones, draw, discard, hand: [...state.zones.hand, ...drawn] }
  };
  return { state, events };
};

const runCombatStartTrait = (input: CombatState, db: ContentDb, characterId: CharacterId): { state: CombatState; events: CombatEvent[] } => {
  const character = db.characters[String(characterId)];
  if (character?.trait.hook !== 'combatStart') return { state: input, events: [] };

  const events: CombatEvent[] = [{ type: 'traitTriggered', trait: character.trait.id }];
  let state = input;
  for (const atom of character.trait.effects) {
    state = applyEffectAtom(state, atom, { type: 'player' }, db, events);
    if (state.phase === 'victory' || state.phase === 'defeat') break;
  }
  return { state, events };
};

const startPlayerTurn = (input: CombatState): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state = {
    ...input,
    phase: 'player' as const,
    slots: input.slots.map((candidate) => ({ ...candidate, usedThisTurn: false })),
    skillUsesThisTurn: 0
  };
  if (state.player.block > 0) {
    events.push({ type: 'blockCleared', target: { type: 'player' }, amount: state.player.block });
  }
  const drawCount = Math.max(0, 5 - state.player.nextDrawPenalty);
  state = { ...state, player: { ...state.player, block: 0, nextDrawPenalty: 0 } };
  const drawn = drawCards(state, drawCount);
  events.push(...drawn.events, { type: 'turnStarted', turn: state.turn });
  return { state: drawn.state, events };
};

export const createCombat = (cfg: CreateCombatConfig, db: ContentDb, seed: string): CombatState => {
  const character = db.characters[String(cfg.character)];
  if (character === undefined) throw new Error('unknown character');
  if (cfg.combatIndex !== undefined && (!Number.isInteger(cfg.combatIndex) || cfg.combatIndex < 0)) {
    throw new Error('combatIndex must be a non-negative integer');
  }
  if (cfg.attempt !== undefined && (!Number.isInteger(cfg.attempt) || cfg.attempt < 0)) {
    throw new Error('attempt must be a non-negative integer');
  }
  const bag = cfg.bag === undefined ? character.startingBag : [...cfg.bag];
  for (const coin of bag) {
    if (db.coins[String(coin)] === undefined) throw new Error(`unknown coin: ${String(coin)}`);
  }
  if (cfg.equippedSkills !== undefined && cfg.equippedSkills.length !== 6) {
    throw new Error('equippedSkills must contain exactly six skills');
  }
  const skills = cfg.equippedSkills === undefined ? character.startingSkills : [...cfg.equippedSkills];
  for (const skill of skills) {
    if (db.skills[String(skill)] === undefined) throw new Error(`unknown skill: ${String(skill)}`);
  }
  const maxHp = cfg.maxHp ?? character.maxHp;
  const currentHp = cfg.currentHp ?? maxHp;
  if (!Number.isInteger(maxHp) || maxHp <= 0) throw new Error('maxHp must be a positive integer');
  if (!Number.isInteger(currentHp) || currentHp <= 0 || currentHp > maxHp) {
    throw new Error('currentHp must be an integer in [1, maxHp]');
  }
  const run = seedFromString(seed);
  const hasRunContext = cfg.combatIndex !== undefined || cfg.attempt !== undefined;
  const combat = hasRunContext
    ? derive(run, 'combat', cfg.combatIndex ?? 0, cfg.attempt ?? 0)
    : derive(run, 'combat', 0);
  const shuffle = derive(combat, 'shuffle');
  const shuffleRng = rngFrom(shuffle);
  const shuffledBag = shuffleRng.shuffle(bag.map((_coinDefId, index) => uid(index + 1)));

  const coins = Object.fromEntries(
    bag.map((defId, index) => [
      index + 1,
      { uid: uid(index + 1), defId, permanent: true, grants: [] }
    ])
  );

  const enemies = cfg.enemies.map((enemyId) => {
    const def = db.enemies[String(enemyId)];
    if (def === undefined) throw new Error('unknown enemy');
    const intent = initialIntent(String(enemyId), db);
    return {
      defId: enemyId,
      hp: def.maxHp,
      maxHp: def.maxHp,
      block: 0,
      statuses: {},
      intent: intent.intent,
      intentIndex: intent.index
    };
  });

  const base: CombatState = {
    turn: 1,
    phase: 'player',
    player: { hp: currentHp, maxHp, block: 0, statuses: {}, nextDrawPenalty: 0 },
    enemies,
    coins,
    zones: { draw: shuffledBag, hand: [], placed: emptyPlaced(), discard: [], exhausted: [] },
    slots: Array.from({ length: 6 }, (_, index) => ({
      skillId: skills[index] ?? ('' as never),
      usedThisTurn: false,
      usedThisCombat: false
    })),
    skillUsesThisTurn: 0,
    rng: { flip: derive(combat, 'flip'), shuffle: shuffleRng.snapshot(), ai: derive(combat, 'ai') },
    nextUid: bag.length + 1,
    events: []
  };

  const trait = runCombatStartTrait(base, db, cfg.character);
  const started = startPlayerTurn(trait.state);
  return { ...started.state, events: [...trait.events, ...started.events] };
};

const removeCoin = (coins: readonly CoinUid[], coin: CoinUid): CoinUid[] => coins.filter((candidate) => candidate !== coin);

const validateSingleEnemyTarget = (input: CombatState, target: number | undefined): StepResult | undefined => {
  if (target === undefined || input.enemies[target]?.hp === undefined || input.enemies[target]!.hp <= 0) {
    return { ok: false, error: 'target enemy is not alive' };
  }
  return undefined;
};

const tickPlayerDurations = (input: CombatState, events: CombatEvent[]): CombatState => {
  let statuses = input.player.statuses;
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
    events.push({ type: 'statusTicked', target: { type: 'player' }, status, amount: 0, remaining: 0, turns });
  }
  return statuses === input.player.statuses ? input : { ...input, player: { ...input.player, statuses } };
};

const placeCoin = (input: CombatState, coin: CoinUid, slotId: SlotId, db: ContentDb): StepResult => {
  if (!input.zones.hand.includes(coin)) return { ok: false, error: 'coin is not in hand' };
  const slotState = input.slots[Number(slotId)];
  if (slotState === undefined) return { ok: false, error: 'slot does not exist' };
  const skill = db.skills[String(slotState.skillId)];
  if (skill?.type === 'flip' && (input.zones.placed[slotId]?.length ?? 0) >= skill.cost) {
    return { ok: false, error: 'slot cost is already full' };
  }
  const state = {
    ...input,
    zones: {
      ...input.zones,
      hand: removeCoin(input.zones.hand, coin),
      placed: { ...input.zones.placed, [slotId]: [...(input.zones.placed[slotId] ?? []), coin] }
    }
  };
  return { ok: true, state, events: [{ type: 'coinPlaced', coin, slot: slotId }] };
};

const unplaceCoin = (input: CombatState, coin: CoinUid): StepResult => {
  let found: SlotId | undefined;
  const placed = { ...input.zones.placed };
  for (const [key, coins] of Object.entries(input.zones.placed)) {
    if (coins.includes(coin)) {
      found = Number(key) as SlotId;
      placed[found] = removeCoin(coins, coin);
      break;
    }
  }
  if (found === undefined) return { ok: false, error: 'coin is not placed' };
  return {
    ok: true,
    state: { ...input, zones: { ...input.zones, placed, hand: [...input.zones.hand, coin] } },
    events: [{ type: 'coinUnplaced', coin, slot: found }]
  };
};

const endTurn = (input: CombatState, db: ContentDb): StepResult => {
  const events: CombatEvent[] = [];
  let state = input;
  const returned = Object.values(state.zones.placed).flat();
  const placed = emptyPlaced();
  state = {
    ...state,
    zones: { ...state.zones, hand: [...state.zones.hand, ...returned], placed }
  };

  const burn = statusStacks(state.player.statuses, 'burn');
  if (burn > 0) {
    state = applyDamage(state, { type: 'player' }, burn, 'burn', events);
    state = {
      ...state,
      player: { ...state.player, statuses: { ...state.player.statuses, burn: { kind: 'stack', stacks: Math.max(0, burn - 1) } } }
    };
    events.push({ type: 'statusTicked', target: { type: 'player' }, status: 'burn', amount: burn, remaining: Math.max(0, burn - 1) });
  }
  state = tickPlayerDurations(state, events);
  state = checkCombatEnd(state, events);
  if (state.phase === 'defeat') return { ok: true, state, events };

  const clearedCoins = Object.fromEntries(
    Object.entries(state.coins).map(([key, coin]) => [key, { ...coin, grants: [] }])
  );
  const discarded = [...state.zones.hand];
  state = {
    ...state,
    coins: clearedCoins,
    zones: { ...state.zones, discard: [...state.zones.discard, ...discarded], hand: [] }
  };
  if (discarded.length > 0) events.push({ type: 'coinsDiscarded', coins: discarded, reason: 'turnEnd' });

  const enemy = runEnemyPhase(state, db);
  state = enemy.state;
  events.push(...enemy.events);
  if (state.phase === 'victory' || state.phase === 'defeat') return { ok: true, state, events };

  state = { ...state, turn: state.turn + 1 };
  const next = startPlayerTurn(state);
  events.push(...next.events);
  return { ok: true, state: next.state, events };
};

export const step = (state: CombatState, cmd: Command, db: ContentDb): StepResult => {
  try {
    if (state.phase !== 'player') return { ok: false, error: 'combat is not in player phase' };
    const input = cloneState(state);
    if (cmd.type === 'placeCoin') return placeCoin(input, cmd.coin, cmd.slot, db);
    if (cmd.type === 'unplaceCoin') return unplaceCoin(input, cmd.coin);
    if (cmd.type === 'endTurn') return endTurn(input, db);
    if (cmd.type === 'useFlipSkill') {
      const slotState = input.slots[Number(cmd.slot)];
      if (slotState === undefined) return { ok: false, error: 'slot does not exist' };
      const skill = db.skills[String(slotState.skillId)];
      if (skill === undefined || skill.type !== 'flip') return { ok: false, error: 'slot is not a flip skill' };
      if (skill.targetType === 'single-enemy') {
        const targetError = validateSingleEnemyTarget(input, cmd.target);
        if (targetError !== undefined) return targetError;
      }
      return { ok: true, ...resolveFlip(input, cmd.slot, skill, cmd.target, db) };
    }
    if (cmd.type === 'useConsumeSkill') {
      const slotState = input.slots[Number(cmd.slot)];
      if (slotState === undefined) return { ok: false, error: 'slot does not exist' };
      const skill = db.skills[String(slotState.skillId)];
      if (skill === undefined || skill.type !== 'consume') return { ok: false, error: 'slot is not a consume skill' };
      if (skill.targetType === 'single-enemy') {
        const targetError = validateSingleEnemyTarget(input, cmd.target);
        if (targetError !== undefined) return targetError;
      }
      return { ok: true, ...resolveConsume(input, cmd.slot, skill, cmd.coins, cmd.target, db) };
    }
    return { ok: false, error: 'unknown command' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const zoneCoinCount = (zones: CombatZones): number =>
  zones.draw.length +
  zones.hand.length +
  Object.values(zones.placed).reduce((sum, coins) => sum + coins.length, 0) +
  zones.discard.length +
  zones.exhausted.length;
