import type { ContentDb, FlipSkillDef } from '../content-types';
import type { CharacterId, CoinDefId, CoinUid, EnemyDefId, PassiveId, SkillId, SlotId } from '../ids';
import { derive, rngFrom, seedFromString } from '../rng';
import { coinSatisfiesFlipRequirement, flipSkillRequiresEnemyTarget, skillRequiresSummonChoice } from './commands';
import type { Command } from './commands';
import { drawCards } from './draw';
import { initialIntent, runEnemyPhase } from './enemy';
import { runSummonPhase } from './summons';
import type { CombatEvent } from './events';
import { resolveConsume } from './resolve/consume';
import { applyBlock, applyDamage, applyEffectAtom, checkCombatEnd, resolveFlip } from './resolve/flip';
import { cloneState, MAX_SKILL_SLOTS, statusStacks } from './state';
import type { CombatState, CombatZones } from './state';

export { MAX_SKILL_SLOTS } from './state';

export type StepResult = { ok: true; state: CombatState; events: CombatEvent[] } | { ok: false; error: string };

export interface CreateCombatConfig {
  character: CharacterId;
  enemies: readonly EnemyDefId[];
  bag?: readonly CoinDefId[];
  equippedSkills?: readonly (SkillId | null)[];
  currentHp?: number;
  maxHp?: number;
  combatIndex?: number;
  attempt?: number;
  // P6 D2 — 획득 패시브(combatStart/turnStart 훅), D1 — 막별 적 스케일
  passives?: readonly PassiveId[];
  enemyScale?: number;
}

const slot = (value: number): SlotId => value as SlotId;
const uid = (value: number): CoinUid => value as CoinUid;

const emptyPlaced = (): Record<SlotId, CoinUid[]> => {
  const placed: Partial<Record<SlotId, CoinUid[]>> = {};
  for (let i = 0; i < MAX_SKILL_SLOTS; i += 1) placed[slot(i)] = [];
  return placed as Record<SlotId, CoinUid[]>;
};

// P6 D2 — 시작 고유 특성(trait)과 획득 패시브를 같은 훅 실행기로 처리한다.
// 순서 결정론: trait 먼저, 이후 획득 순서(acquiredPassives 배열 순서) 그대로.
const runHook = (
  input: CombatState,
  db: ContentDb,
  hook: 'combatStart' | 'turnStart'
): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state = input;
  const apply = (effects: readonly Parameters<typeof applyEffectAtom>[1][]): void => {
    for (const atom of effects) {
      state = applyEffectAtom(state, atom, { type: 'player' }, db, events);
      if (state.phase === 'victory' || state.phase === 'defeat') return;
    }
  };
  const character = db.characters[String(state.characterId)];
  if (character !== undefined && character.trait.hook === hook && character.trait.effects.length > 0) {
    events.push({ type: 'traitTriggered', trait: character.trait.id });
    apply(character.trait.effects);
  }
  for (const passiveId of state.passives) {
    if (state.phase === 'victory' || state.phase === 'defeat') break;
    const passive = (db.passives ?? {})[String(passiveId)];
    if (passive === undefined || passive.hook !== hook) continue;
    events.push({ type: 'passiveTriggered', passive: String(passiveId) });
    apply(passive.effects);
  }
  return { state, events };
};

const startPlayerTurn = (
  input: CombatState,
  db: ContentDb,
  clearBlock = true
): { state: CombatState; events: CombatEvent[] } => {
  const events: CombatEvent[] = [];
  let state: CombatState = {
    ...input,
    phase: 'player' as const,
    // P7 D1 — 턴 시작에 쿨다운 감소 (쿨1=다음 턴 가용, 쿨3=두 턴 봉인 후 가용)
    player: {
      ...input.player,
      remiseCharges: db.characters[String(input.characterId)]?.trait.mechanic === 'remise' ? 1 : 0,
      continuousMotionUsed: false,
      retrievalHabitUsed: false,
      balanceSenseUsed: false,
      lastMoveUsed: false,
      residualChargeUsed: false,
      overcurrentUsed: false,
      firstDamageReducedThisTurn: false,
      firstBurnBoostUsedThisTurn: false,
      burnAppliedThisTurn: false,
      inverseGuardUsedThisTurn: false,
      crossCalculationUsedThisTurn: false,
      commandPreservationUsedThisTurn: false,
      manaMembraneBlockThisTurn: 0,
      blueCircuitUsedThisTurn: false,
      nextAttackDamageBonus: 0
    },
    slots: input.slots.map((candidate) => ({
      ...candidate,
      cooldownRemaining: Math.max(0, candidate.cooldownRemaining - 1)
    }))
  };
  if (clearBlock && state.player.block > 0) {
    events.push({ type: 'blockCleared', target: { type: 'player' }, amount: state.player.block });
  }
  // P7 D3 — 턴 시작 총 드로우 [0,8] 클램프 (nextTurnDraw 폭주 방지)
  const drawCount = Math.min(8, Math.max(0, 5 - state.player.nextDrawPenalty + state.player.nextDrawBonus));
  state = {
    ...state,
    player: {
      ...state.player,
      block: clearBlock ? 0 : state.player.block,
      nextDrawPenalty: 0,
      nextDrawBonus: 0
    }
  };
  // turnStart 훅(trait·획득 패시브) — 드로우 전에 발동해 생성 코인이 이번 드로우에 섞인다
  const hooked = runHook(state, db, 'turnStart');
  state = hooked.state;
  events.push(...hooked.events);
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
  // P7 D2 — 슬롯 8 일반화: 1~8개 전달, null=빈 슬롯, 부족분은 null 패딩
  if (cfg.equippedSkills !== undefined && (cfg.equippedSkills.length < 1 || cfg.equippedSkills.length > MAX_SKILL_SLOTS)) {
    throw new Error(`equippedSkills must contain between 1 and ${MAX_SKILL_SLOTS} skills`);
  }
  const skills: (SkillId | null)[] = cfg.equippedSkills === undefined ? [...character.startingSkills] : [...cfg.equippedSkills];
  for (const skill of skills) {
    if (skill !== null && db.skills[String(skill)] === undefined) throw new Error(`unknown skill: ${String(skill)}`);
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

  const enemyScale = cfg.enemyScale ?? 1;
  if (!Number.isFinite(enemyScale) || enemyScale < 1) throw new Error('enemyScale must be >= 1');
  for (const passiveId of cfg.passives ?? []) {
    if ((db.passives ?? {})[String(passiveId)] === undefined)
      throw new Error(`unknown passive: ${String(passiveId)}`);
  }
  const enemies = cfg.enemies.map((enemyId) => {
    const def = db.enemies[String(enemyId)];
    if (def === undefined) throw new Error('unknown enemy');
    const intent = initialIntent(String(enemyId), db);
    // P6 D1 — 막별 스케일: HP만 여기서, 공격 피해는 적 페이즈에서 동일 배율 (블록/회복 원수치)
    const scaledMaxHp = Math.round(def.maxHp * enemyScale);
    return {
      defId: enemyId,
      hp: scaledMaxHp,
      maxHp: scaledMaxHp,
      block: 0,
      statuses: {},
      intent: intent.intent,
      intentIndex: intent.index,
      nextAttackBonus: 0
    };
  });

  const base: CombatState = {
    turn: 1,
    phase: 'player',
    player: {
      hp: currentHp, maxHp, block: 0, statuses: {}, nextDrawPenalty: 0, nextDrawBonus: 0,
      overheat: false, weaponOutput: 0,
      nextAttackDamageBonus: 0, endTurnBlockAoeCap: 0,
      firstDamageReducedThisTurn: false, combatBreathingUsed: false,
      firstBurnBoostUsedThisTurn: false, burnAppliedThisTurn: false,
      previewDeploymentUsed: false, inverseGuardUsedThisTurn: false,
      crossCalculationUsedThisTurn: false, residualRebuildStored: false,
      commandPreservationUsedThisTurn: false, manaMembraneBlockThisTurn: 0,
      blueCircuitUsedThisTurn: false, manaConsumedForResonance: 0,
      remiseCharges: character.trait.mechanic === 'remise' ? 1 : 0,
      continuousMotionUsed: false, retrievalHabitUsed: false, balanceSenseUsed: false,
      lastMoveUsed: false, residualChargeUsed: false, overcurrentUsed: false
    },
    enemies,
    coins,
    zones: { draw: shuffledBag, hand: [], placed: emptyPlaced(), discard: [], exhausted: [] },
    slots: Array.from({ length: MAX_SKILL_SLOTS }, (_, index) => ({
      skillId: skills[index] ?? null,
      cooldownRemaining: 0,
      usedThisCombat: false
    })),
    turnTriggers: [],
    rng: { flip: derive(combat, 'flip'), shuffle: shuffleRng.snapshot(), ai: derive(combat, 'ai') },
    nextUid: bag.length + 1,
    nextTurnTriggerUid: 1,
    characterId: cfg.character,
    passives: [...(cfg.passives ?? [])],
    enemyScale,
    lastTargetedEnemy: null,
    summons: [],
    nextSummonUid: 1,
    events: []
  };

  const trait = runHook(base, db, 'combatStart');
  // 전투 시작 훅은 첫 턴 초기화보다 먼저 실행된다. 여기서 방어를 지우면
  // "전투 시작 시 방어" 특성/패시브가 보이지 않게 소멸하므로 첫 턴만 보존한다.
  const started = startPlayerTurn(trait.state, db, false);
  return { ...started.state, events: [...trait.events, ...started.events] };
};

const removeCoin = (coins: readonly CoinUid[], coin: CoinUid): CoinUid[] => coins.filter((candidate) => candidate !== coin);

const validateSingleEnemyTarget = (input: CombatState, target: number | undefined): StepResult | undefined => {
  if (target === undefined || input.enemies[target]?.hp === undefined || input.enemies[target]!.hp <= 0) {
    return { ok: false, error: 'target enemy is not alive' };
  }
  return undefined;
};

const hasChooseBasicInHand = (skill: FlipSkillDef): boolean =>
  [...skill.base, ...(skill.heads?.effects ?? []), ...(skill.tails?.effects ?? [])].some(
    (effect) => effect.kind === 'grantElement' && effect.scope === 'chooseBasicInHand'
  );

const isBasicCoinInHand = (input: CombatState, coin: CoinUid, db: ContentDb): boolean => {
  const instance = input.coins[Number(coin)];
  const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
  return input.zones.hand.includes(coin) && instance !== undefined && def?.element === null && instance.grants.length === 0;
};

const validateChosenBasicInHand = (
  input: CombatState,
  skill: FlipSkillDef,
  chosen: readonly CoinUid[] | undefined,
  db: ContentDb
): StepResult | undefined => {
  if (!hasChooseBasicInHand(skill)) return undefined;
  const basicInHand = input.zones.hand.filter((coin) => isBasicCoinInHand(input, coin, db));
  if (basicInHand.length === 0) {
    return chosen === undefined || chosen.length === 0 ? undefined : { ok: false, error: 'chosen coin is not a basic coin in hand' };
  }
  if (chosen === undefined || chosen.length !== 1) {
    return { ok: false, error: 'chooseBasicInHand requires exactly one chosen coin' };
  }
  const selected = chosen[0];
  if (selected === undefined || !isBasicCoinInHand(input, selected, db)) {
    return { ok: false, error: 'chosen coin is not a basic coin in hand' };
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
  if (slotState.skillId === null) return { ok: false, error: 'slot is empty' };
  const skill = db.skills[String(slotState.skillId)];
  if (skill?.type === 'flip' && !coinSatisfiesFlipRequirement(input, db, skill, coin)) {
    return { ok: false, error: 'coin does not satisfy required flip element' };
  }
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
  const passiveMechanics = new Set(state.passives.flatMap((id) => {
    const mechanic = (db.passives ?? {})[String(id)]?.mechanic;
    return mechanic === undefined ? [] : [mechanic];
  }));
  if (passiveMechanics.has('preparedStance')) {
    const amount = Math.min(2, state.zones.hand.length);
    if (amount > 0) state = applyBlock(state, { type: 'player' }, amount, events);
  }
  if (passiveMechanics.has('hotBarrier') && state.player.burnAppliedThisTurn) {
    state = applyBlock(state, { type: 'player' }, 2, events);
  }

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
  if (state.turnTriggers.length > 0) {
    events.push({ type: 'turnTriggersExpired', count: state.turnTriggers.length });
    state = { ...state, turnTriggers: [] };
  }

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

  // P6 D6 — 소환 장비 자동 행동 (플레이어 턴 종료, 적 페이즈 전)
  if (state.summons.length > 0) {
    const summonPhase = runSummonPhase(state, db);
    state = summonPhase.state;
    events.push(...summonPhase.events);
    if (state.phase === 'victory') return { ok: true, state, events };
  }
  if (state.player.endTurnBlockAoeCap > 0) {
    const amount = Math.min(state.player.endTurnBlockAoeCap, state.player.block);
    state = { ...state, player: { ...state.player, endTurnBlockAoeCap: 0 } };
    if (amount > 0) {
      for (let index = 0; index < state.enemies.length; index += 1) {
        if ((state.enemies[index]?.hp ?? 0) <= 0) continue;
        state = applyDamage(state, { type: 'enemy', index }, amount, 'skill', events, { type: 'player' });
      }
      state = checkCombatEnd(state, events);
      if (state.phase === 'victory') return { ok: true, state, events };
    }
  }

  const enemy = runEnemyPhase(state, db);
  state = enemy.state;
  events.push(...enemy.events);
  if (state.phase === 'victory' || state.phase === 'defeat') return { ok: true, state, events };

  state = { ...state, turn: state.turn + 1 };
  const next = startPlayerTurn(state, db);
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
      if (flipSkillRequiresEnemyTarget(input, cmd.slot, skill, db)) {
        const targetError = validateSingleEnemyTarget(input, cmd.target);
        if (targetError !== undefined) return targetError;
      }
      const chosenError = validateChosenBasicInHand(input, skill, cmd.chosen, db);
      if (chosenError !== undefined) return chosenError;
      if (skillRequiresSummonChoice(skill) && !input.summons.some((summon) => summon.uid === cmd.chosenSummon))
        return { ok: false, error: 'a valid summon choice is required' };
      const targetedInput = cmd.target === undefined ? input : { ...input, lastTargetedEnemy: cmd.target };
      return {
        ok: true,
        ...resolveFlip(targetedInput, cmd.slot, skill, cmd.target, db, cmd.chosen, {
          chosenEquipment: cmd.chosenEquipment,
          chosenSummon: cmd.chosenSummon
        })
      };
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
      if (skillRequiresSummonChoice(skill) && !input.summons.some((summon) => summon.uid === cmd.chosenSummon))
        return { ok: false, error: 'a valid summon choice is required' };
      const targetedInput = cmd.target === undefined ? input : { ...input, lastTargetedEnemy: cmd.target };
      return { ok: true, ...resolveConsume(targetedInput, cmd.slot, skill, cmd.coins, cmd.target, db, cmd.chosenSummon) };
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
