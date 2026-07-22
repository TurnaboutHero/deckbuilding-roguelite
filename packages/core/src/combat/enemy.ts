import { DURATION_STATUS_IDS } from '../content-types';
import type { ContentDb, EnemyAction, EnemyIntent, StatusId } from '../content-types';
import type { Element, SlotId } from '../ids';
import { isSlotUsableNow } from './commands';
import { openRoyalTax, resetRepeatSkillPressure, resetRoyalTaxDefaults, sealTriggeredSkill } from './directive15';
import { rngFrom } from '../rng';
import type { CombatEvent } from './events';
import { createEnemyState, MAX_ENEMY_SLOTS } from './enemy-state';
import { applyFurnaceActionResolved, cancelWindupIfNeeded, setFurnaceTemperature } from './furnace';
import { applyRoyalVaultBarrier, clearLeadCoins, createCounterfeits, forecloseRoyalVault, nominateExactRoyalVaultSeizure, removeCounterfeits, resolveRoyalVaultSeizure, returnOldestRoyalVaultCoin, royalVaultCoinCount, startLeadDecree } from './directive18';
import { applyBlock, applyDamage, applyEffectAtom, checkCombatEnd } from './resolve/flip';
import { aggregateSkillSeal, assertCombatCoinZoneInvariant, skillSealOwners, statusStacks, statusTurns } from './state';
import type { CombatState } from './state';

export const nextIntent = (state: CombatState, enemyIndex: number, db: ContentDb): { intent: EnemyIntent; index: number } => {
  const enemy = state.enemies[enemyIndex];
  if (enemy === undefined) throw new Error('enemy does not exist');
  const def = db.enemies[String(enemy.defId)];
  if (def === undefined || def.intents.length === 0) throw new Error('enemy has no intents');
  const intents = enemy.phaseIndex === undefined ? def.intents : (def.phases?.[enemy.phaseIndex]?.intents ?? def.intents);
  const atMaxIntent = def.furnace?.atMaxIntent;
  if (
    atMaxIntent !== undefined &&
    enemy.furnaceTemperature === enemy.furnaceMaxTemperature &&
    enemy.cancelledWindupIntentId !== atMaxIntent.id
  ) {
    return { intent: atMaxIntent, index: enemy.intentIndex };
  }
  const vaultAtCapacity = def.royalVault?.atCapacityIntent;
  if (vaultAtCapacity !== undefined && def.royalVault !== undefined && royalVaultCoinCount(state, enemyIndex) >= def.royalVault.capacity && enemy.cancelledWindupIntentId !== vaultAtCapacity.id) {
    return { intent: vaultAtCapacity, index: enemy.intentIndex };
  }
  const repeat = def.repeatSkillPressure;
  if ((enemy.repeatSkillPressure?.zeal ?? 0) >= (repeat?.threshold ?? Number.POSITIVE_INFINITY)) {
    return { intent: repeat!.executionIntent, index: enemy.intentIndex };
  }
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

const enemyUid = (enemy: CombatState['enemies'][number], index: number): number => enemy.enemyUid ?? index + 1;

const transformHatch = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const current = state.enemies[enemyIndex];
  const hatch = current?.hatch;
  if (current === undefined || current.hp <= 0 || hatch === undefined || hatch.turnsRemaining > 0) return state;
  const into = hatch.into ?? db.enemies[String(current.defId)]?.hatch?.into;
  if (into === undefined) return state;
  const transformed = createEnemyState(into, db, {
    enemyScale: state.enemyScale,
    enemyUid: enemyUid(current, enemyIndex),
    slot: current.slot,
    summonSick: true,
    statuses: current.statuses,
    vassalGuardSourceEnemyUid: current.vassalGuard?.sourceEnemyUid
  });
  events.push({ type: 'enemyHatched', sourceEnemyUid: enemyUid(current, enemyIndex), into: String(into) });
  return withEnemy(state, enemyIndex, () => ({
    ...transformed,
    protectionLink: current.protectionLink === undefined ? undefined : { ...current.protectionLink },
    vassalGuard: current.vassalGuard === undefined ? undefined : { ...current.vassalGuard }
  }));
};

const tickHatch = (state: CombatState, enemyIndex: number, amount: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const current = state.enemies[enemyIndex];
  if (current === undefined || current.hp <= 0 || current.hatch === undefined) return state;
  const turnsRemaining = Math.max(0, current.hatch.turnsRemaining - amount);
  const next = withEnemy(state, enemyIndex, (candidate) => ({
    ...candidate,
    hatch: candidate.hatch === undefined ? undefined : { ...candidate.hatch, turnsRemaining }
  }));
  return transformHatch(next, enemyIndex, db, events);
};

const summonEnemies = (state: CombatState, sourceIndex: number, enemy: string, maxCount: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const source = state.enemies[sourceIndex];
  if (source === undefined || source.hp <= 0) return state;
  if (db.enemies[enemy] === undefined) throw new Error(`unknown summoned enemy: ${enemy}`);
  let next = state;
  let summoned = 0;
  for (let count = 0; count < maxCount; count += 1) {
    const occupied = new Set(next.enemies.filter((candidate) => candidate.hp > 0).map((candidate, index) => candidate.slot ?? index));
    const slot = Array.from({ length: MAX_ENEMY_SLOTS }, (_, index) => index).find((candidate) => !occupied.has(candidate));
    if (slot === undefined) break;
    const uid = Math.max(0, ...next.enemies.map((candidate, index) => enemyUid(candidate, index))) + 1;
    const entrantDef = db.enemies[enemy];
    const entrant = createEnemyState(enemy as typeof source.defId, db, {
      enemyScale: next.enemyScale,
      enemyUid: uid,
      slot,
      summonSick: true,
      vassalGuardSourceEnemyUid: entrantDef?.vassalGuard?.source === source.defId ? enemyUid(source, sourceIndex) : undefined
    });
    const replacementIndex = next.enemies.findIndex((candidate, index) => candidate.hp <= 0 && (candidate.slot ?? index) === slot);
    next = {
      ...next,
      enemies: replacementIndex < 0
        ? [...next.enemies, entrant]
        : next.enemies.map((candidate, index) => index === replacementIndex ? entrant : candidate)
    };
    events.push({ type: 'enemySummoned', sourceEnemyUid: enemyUid(source, sourceIndex), enemy, slot, enemyUid: uid });
    summoned += 1;
  }
  if (summoned === 0) events.push({ type: 'enemySummonFailed', sourceEnemyUid: enemyUid(source, sourceIndex), enemy, maxCount });
  return next;
};

const clearStaleRepeatPressure = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const pressure = state.enemies[enemyIndex]?.repeatSkillPressure;
  if (pressure?.lastSkillId === undefined) return state;
  const stillUsable = pressure.triggeringSlot === undefined
    ? state.slots.some((slot, index) => slot.skillId === pressure.lastSkillId && isSlotUsableNow(state, db, index as SlotId))
    : isSlotUsableNow(state, db, pressure.triggeringSlot);
  if (stillUsable) return state;
  return resetRepeatSkillPressure(state, enemyIndex, events);
};

const bannerAuraPercent = (state: CombatState, target: number, db: ContentDb): { percent: number; source?: number } => {
  let percent = 0;
  let source: number | undefined;
  state.enemies.forEach((enemy, index) => {
    if (index === target || enemy.hp <= 0) return;
    const aura = db.enemies[String(enemy.defId)]?.warBanner?.attackAuraPercent;
    if (aura !== undefined) {
      percent += aura;
      source = index;
    }
  });
  return { percent, source };
};

const scaledEnemyAttackDamage = (
  state: CombatState,
  enemyIndex: number,
  baseDamage: number,
  db: ContentDb,
  events: CombatEvent[]
): number => {
  const aura = bannerAuraPercent(state, enemyIndex, db);
  const actingEnemy = state.enemies[enemyIndex];
  const marchPercent = (actingEnemy?.marchTurns ?? 0) > 0 ? (actingEnemy?.marchAttackPercent ?? 0) : 0;
  if (aura.percent > 0 && aura.source !== undefined) {
    events.push({ type: 'enemyAuraApplied', source: aura.source, target: enemyIndex, percent: aura.percent });
  }
  return Math.round(baseDamage * (1 + aura.percent + marchPercent) * (state.enemyScale ?? 1));
};

const applyGroupMarch = (state: CombatState, source: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const banner = db.enemies[String(state.enemies[source]?.defId ?? '')]?.warBanner;
  if (banner === undefined) return state;
  let next = state;
  next = {
    ...next,
    enemies: next.enemies.map((enemy) => {
      if (enemy.hp <= 0) return enemy;
      const shield = Math.round(enemy.maxHp * banner.march.shieldMaxHpFraction);
      return {
        ...enemy,
        block: enemy.block + shield,
        marchTurns: banner.march.turns,
        marchShield: shield,
        marchAttackPercent: banner.march.attackPercent,
        marchSource: source
      };
    })
  };
  next.enemies.forEach((enemy, index) => {
    if (enemy.hp > 0) events.push({ type: 'blockGained', target: { type: 'enemy', index }, amount: Math.round(enemy.maxHp * banner.march.shieldMaxHpFraction) });
  });
  return next;
};

const tickMarchAfterEnemyTurn = (state: CombatState, enemyIndex: number, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  if (enemy === undefined || (enemy.marchTurns ?? 0) <= 0) return state;
  const turns = Math.max(0, (enemy.marchTurns ?? 0) - 1);
  if (turns > 0) return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, marchTurns: turns }));
  if (enemy.marchSource !== undefined) {
    events.push({ type: 'enemyMarchRemoved', source: enemy.marchSource, target: enemyIndex });
  }
  return withEnemy(state, enemyIndex, (candidate) => ({
    ...candidate,
    block: Math.max(0, candidate.block - (candidate.marchShield ?? 0)),
    marchTurns: 0,
    marchShield: 0,
    marchAttackPercent: 0,
    marchSource: undefined
  }));
};

const CLEANSE_ORDER: readonly StatusId[] = ['burn', 'poison', 'bleed', 'frostbite', 'frost', 'shock', 'healLock'];
const PUBLIC_ELEMENT_ORDER: readonly Element[] = ['fire', 'mana', 'frost', 'lightning', 'blood'];

const beginCoinSeizureTelegraph = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const seizure = enemy === undefined ? undefined : db.enemies[String(enemy.defId)]?.coinSeizure;
  if (enemy === undefined || seizure === undefined || enemy.coinSeizure !== undefined) return state;
  const counts = new Map<Element, number>();
  for (const coinUid of state.zones.hand) {
    if (state.coins[Number(coinUid)]?.counterfeit === true) continue;
    const element = db.coins[String(state.coins[Number(coinUid)]?.defId)]?.element;
    if (element !== null && element !== undefined) counts.set(element, (counts.get(element) ?? 0) + 1);
  }
  const element = PUBLIC_ELEMENT_ORDER.find((candidate) => (counts.get(candidate) ?? 0) > 0 && (counts.get(candidate) ?? 0) === Math.max(...counts.values()));
  if (element === undefined) return state;
  const nominated = state.zones.hand
    .filter((coinUid) => db.coins[String(state.coins[Number(coinUid)]?.defId)]?.element === element);
  const quantity = Math.min(seizure.maxCoins, Math.floor(state.zones.hand.length * seizure.capFraction));
  const telegraph = {
    element,
    nominated,
    handCountAtTelegraph: state.zones.hand.length,
    cap: quantity,
    quantity
  };
  events.push({ type: 'coinSeizureTelegraphed', sourceEnemy: enemyIndex, ...telegraph });
  return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, coinSeizure: telegraph }));
};

const seizeCustody = (state: CombatState, enemyIndex: number, events: CombatEvent[]): CombatState => {
  const telegraph = state.enemies[enemyIndex]?.coinSeizure;
  if (telegraph === undefined) return state;
  const coins = telegraph.nominated
    .filter((coin) => state.zones.hand.includes(coin) && state.coins[Number(coin)]?.counterfeit !== true)
    .slice(0, Math.min(2, telegraph.quantity));
  if (coins.length === 0) return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, coinSeizure: undefined }));
  const seizureOrder = state.custody.reduce((maximum, entry) => Math.max(maximum, entry.seizureOrder + 1), 0);
  events.push({ type: 'coinsSeized', sourceEnemy: enemyIndex, coins, element: telegraph.element, seizureOrder });
  const next = {
    ...withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, coinSeizure: undefined })),
    custody: [...state.custody, { sourceEnemy: enemyIndex, sourceEnemyUid: enemyUid(state.enemies[enemyIndex]!, enemyIndex), coins, element: telegraph.element, seizureOrder }],
    zones: { ...state.zones, hand: state.zones.hand.filter((coin) => !coins.includes(coin)) }
  };
  assertCombatCoinZoneInvariant(next);
  return next;
};

const repeatedRecentSlot = (state: CombatState, db: ContentDb, turns: number): SlotId | undefined => {
  const recent = state.player.recentSkillUses
    .filter((use) => use.turn >= state.turn - Math.max(0, turns - 1))
    .map((use) => use.slot);
  const usable = state.player.usableSkillSlotsAtTurnEnd.length > 0
    ? state.player.usableSkillSlotsAtTurnEnd
    : state.slots.flatMap((_, index) => isSlotUsableNow(state, db, index as SlotId) ? [index as SlotId] : []);
  const usableSkills = new Map<string, SlotId>();
  for (const slot of [...usable].sort((left, right) => Number(left) - Number(right))) {
    const skillId = state.slots[Number(slot)]?.skillId;
    if (skillId !== null && skillId !== undefined && !usableSkills.has(String(skillId))) usableSkills.set(String(skillId), slot);
  }
  const counts = new Map<string, number>();
  for (const slot of recent) {
    const skillId = state.slots[Number(slot)]?.skillId;
    if (skillId !== null && skillId !== undefined && usableSkills.has(String(skillId))) {
      counts.set(String(skillId), (counts.get(String(skillId)) ?? 0) + 1);
    }
  }
  const selected = [...counts.entries()].sort((left, right) => right[1] - left[1] || Number(usableSkills.get(left[0])) - Number(usableSkills.get(right[0])))[0]?.[0];
  return selected === undefined ? undefined : usableSkills.get(selected);
};

const sealRecentSkill = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const def = db.enemies[String(state.enemies[enemyIndex]?.defId ?? '')]?.skillSeal;
  if (def === undefined) return state;
  if (Object.values(state.player.skillSeals).some((seal) => seal !== undefined && skillSealOwners(seal).some((owner) => owner.sourceEnemy === enemyIndex && owner.turns > 0))) {
    const damage = 6;
    events.push({ type: 'skillSealRepeatStruck', sourceEnemy: enemyIndex, damage });
    return applyDamage(state, { type: 'player' }, damage, 'enemy', events, { type: 'enemy', index: enemyIndex });
  }
  const selected = repeatedRecentSlot(state, db, def.recentPlayerTurns);
  if (selected === undefined) return state;
  const usable = state.player.usableSkillSlotsAtTurnEnd.length > 0
    ? state.player.usableSkillSlotsAtTurnEnd
    : state.slots.flatMap((_, index) => isSlotUsableNow(state, db, index as SlotId) ? [index as SlotId] : []);
  const slot = selected;
  const returned = state.player.pendingPlacedReturns[Number(selected)] ?? [];
  if (returned.length > 0) events.push({ type: 'placedCoinsReturned', slot, coins: [...returned], reason: 'skillSeal' });
  const existing = state.player.skillSeals[Number(selected)];
  if (usable.length === 1) {
    const owner = { turns: 1, effectMultiplier: def.uniqueSkillEffectMultiplier, fallback: true, sourceEnemy: enemyIndex };
    const seal = aggregateSkillSeal([...(existing === undefined ? [] : skillSealOwners(existing)), owner]);
    events.push({ type: 'skillSealFallbackReduced', sourceEnemy: enemyIndex, slot, multiplier: owner.effectMultiplier, turns: owner.turns });
    return seal === undefined ? state : { ...state, player: { ...state.player, skillSeals: { ...state.player.skillSeals, [Number(selected)]: seal } } };
  }
  const owner = { turns: def.turns, sourceEnemy: enemyIndex };
  const seal = aggregateSkillSeal([...(existing === undefined ? [] : skillSealOwners(existing)), owner]);
  events.push({ type: 'skillSealed', sourceEnemy: enemyIndex, slot, turns: owner.turns });
  return seal === undefined ? state : { ...state, player: { ...state.player, skillSeals: { ...state.player.skillSeals, [Number(selected)]: seal } } };
};

const maybeStartWindup = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): { state: CombatState; started: boolean } => {
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
  const cancelPredicates = enemy.intent.cancelOn === undefined
    ? []
    : 'kind' in enemy.intent.cancelOn
      ? [enemy.intent.cancelOn]
      : enemy.intent.cancelOn;
  const skillDamageThresholds = cancelPredicates.flatMap((predicate) => predicate.kind === 'skillDamage' ? [predicate.threshold] : []);
  const cancelThreshold = skillDamageThresholds.length === 0 ? undefined : Math.min(...skillDamageThresholds);
  const windup = {
    intent: enemy.intent,
    turnsLeft: enemy.intent.windup.turns,
    startHp: enemy.hp,
    ...(cancelThreshold === undefined ? {} : { cancelThreshold }),
    ...(boundHealAlly === undefined ? {} : { boundHealAlly })
  };
  events.push({
    type: 'enemyWindupStarted',
    enemy: enemyIndex,
    intent: enemy.intent,
    turnsLeft: windup.turnsLeft,
    ...(cancelThreshold === undefined ? {} : { cancelThreshold })
  });
  for (const action of enemy.intent.actions) {
    if (action.kind === 'summonEnemies') {
      events.push({ type: 'enemySummonTelegraphed', sourceEnemyUid: enemyUid(enemy, enemyIndex), enemy: String(action.enemy), maxCount: action.maxCount });
    }
  }
  const started = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, windup, boundHealAlly, ...(db.enemies[String(candidate.defId)]?.royalVault === undefined ? {} : { royalVaultRecoveredThisWindup: 0 }) }));
  let next = beginCoinSeizureTelegraph(started, enemyIndex, db, events);
  if (enemy.intent.actions.some((action) => action.kind === 'leadDecree')) next = startLeadDecree(next, enemyIndex, db, events);
  if (enemy.intent.actions.some((action) => action.kind === 'royalVaultForeclose')) next = forecloseRoyalVault(next, enemyIndex, db, events);
  const exact = enemy.intent.actions.find((action): action is Extract<EnemyAction, { kind: 'royalVaultExactSeizure' }> => action.kind === 'royalVaultExactSeizure');
  if (exact !== undefined) next = nominateExactRoyalVaultSeizure(next, enemyIndex, exact.maxCoins, db, events);
  return { state: next, started: true };
};

const nextPhaseIndexFor = (state: CombatState, enemyIndex: number, db: ContentDb): number => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  if (enemy === undefined || def?.phases === undefined) return -1;
  return def.phases.findIndex((phase, index) => index > (enemy.phaseIndex ?? -1) && enemy.hp / enemy.maxHp < phase.hpBelowFraction);
};

const maybeChangePhase = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  if (enemy === undefined || def?.phases === undefined) return state;
  const phaseIndex = nextPhaseIndexFor(state, enemyIndex, db);
  if (phaseIndex < 0) return state;
  const phase = def.phases[phaseIndex];
  if (phase === undefined) return state;
  let next = enemy.windup === undefined ? state : cancelWindupIfNeeded(state, enemyIndex, events, true);
  events.push({ type: 'enemyPhaseChanged', enemy: enemyIndex });
  next = withEnemy(next, enemyIndex, (candidate) => ({
    ...candidate,
    phaseIndex,
    intentIndex: -1,
    damageTakenMultiplier: phase.damageTakenMultiplier,
    ...(candidate.furnaceTemperature === undefined ? {} : { furnacePhaseEntryHp: Math.ceil(candidate.maxHp * phase.hpBelowFraction) })
  }));
  for (const action of phase.onEnterActions ?? []) {
    if (action.kind === 'setEnemyResource') {
      next = setFurnaceTemperature(next, enemyIndex, action.value, action.reason, events);
    } else if (action.kind === 'adjustEnemyResource') {
      next = setFurnaceTemperature(next, enemyIndex, (next.enemies[enemyIndex]?.furnaceTemperature ?? 0) + action.amount, action.reason, events);
    } else if (action.kind === 'removePlayerStatus') {
      const current = next.player.statuses[action.status];
      if (current === undefined) continue;
      const statuses = { ...next.player.statuses };
      if (current.kind === 'stack') {
        const stacks = Math.max(0, current.stacks - action.stacks);
        if (stacks === 0) delete statuses[action.status]; else statuses[action.status] = { kind: 'stack', stacks };
      } else {
        const turns = Math.max(0, current.turns - action.stacks);
        if (turns === 0) delete statuses[action.status]; else statuses[action.status] = { kind: 'duration', turns };
      }
      next = { ...next, player: { ...next.player, statuses } };
    } else if (action.kind === 'summonEnemies') {
      next = summonEnemies(next, enemyIndex, String(action.enemy), action.maxCount, db, events);
    } else if (action.kind === 'returnOldestRoyalVaultCoin') {
      next = returnOldestRoyalVaultCoin(next, enemyIndex, events, action.reason ?? 'phaseEntry');
    } else if (action.kind === 'clearLeadCoins') {
      next = clearLeadCoins(next, enemyIndex, db, events);
    } else if (action.kind === 'removeCounterfeits') {
      next = removeCounterfeits(next, action.count, events);
    } else {
      throw new Error(`phase entry action ${action.kind} is not supported`);
    }
  }
  return next;
};

const applyPhaseGrowthOnActionResolved = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const enemy = state.enemies[enemyIndex];
  const growth = enemy?.phaseIndex === undefined ? undefined : db.enemies[String(enemy.defId)]?.phases?.[enemy.phaseIndex]?.growthOnActionResolved;
  if (enemy === undefined || growth === undefined) return state;
  const stacks = Math.min(growth.maxStacks, (enemy.growthStacks ?? 0) + growth.amount);
  if (stacks === enemy.growthStacks) return state;
  events.push({ type: 'enemyGrew', enemy: enemyIndex, stacks });
  return withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, growthStacks: stacks }));
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

  // Entrants remain inactive for the phase in which they were created.  A
  // previously summoned enemy becomes available at the start of the next one.
  state = {
    ...state,
    enemies: state.enemies.map((enemy) => enemy.summonSick === true ? { ...enemy, summonSick: false } : enemy)
  };

  state = {
    ...state,
    enemies: state.enemies.map((enemy, index) => {
      if (enemy.hp <= 0 || enemy.block === 0) return enemy;
      const persistentShield = Math.min(enemy.block, enemy.marchShield ?? 0);
      const clearable = enemy.block - persistentShield;
      if (clearable > 0) events.push({ type: 'blockCleared', target: { type: 'enemy', index }, amount: clearable });
      return { ...enemy, block: persistentShield, marchShield: persistentShield };
    })
  };

  state = {
    ...state,
    enemies: state.enemies.map((enemy) => {
      const link = enemy.protectionLink;
      if (link === undefined || link.active || link.turnsUntilRestore <= 0) return enemy;
      const turnsUntilRestore = Math.max(0, link.turnsUntilRestore - 1);
      return turnsUntilRestore === 0
        ? { ...enemy, protectionLink: { ...link, active: true, durability: link.restoreDurability, turnsUntilRestore: 0 } }
        : { ...enemy, protectionLink: { ...link, turnsUntilRestore } };
    })
  };

  const transitionedBeforeAction = new Set<number>();
  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    if (enemy === undefined || enemy.hp <= 0 || enemy.summonSick === true) continue;
    const nextPhaseIndex = nextPhaseIndexFor(state, enemyIndex, db);
    const nextPhase = nextPhaseIndex < 0 ? undefined : db.enemies[String(enemy.defId)]?.phases?.[nextPhaseIndex];
    if (nextPhase?.transitionBeforeAction === true) {
      state = maybeChangePhase(state, enemyIndex, db, events);
      transitionedBeforeAction.add(enemyIndex);
      state = tickMarchAfterEnemyTurn(state, enemyIndex, events);
      continue;
    }
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
    const started = maybeStartWindup(state, enemyIndex, db, events);
    state = started.state;
    if (started.started) {
      state = tickMarchAfterEnemyTurn(state, enemyIndex, events);
      continue;
    }
    const windupEnemy = state.enemies[enemyIndex];
    if (windupEnemy !== undefined && windupEnemy.cancelledWindupIntentId === windupEnemy.intent.id) {
      state = tickMarchAfterEnemyTurn(state, enemyIndex, events);
      continue;
    }
    if (windupEnemy?.windup !== undefined) {
      const beforeCancellation = state;
      state = cancelWindupIfNeeded(state, enemyIndex, events);
      if (state !== beforeCancellation) {
        state = tickMarchAfterEnemyTurn(state, enemyIndex, events);
        continue;
      }
      if (windupEnemy.windup.turnsLeft > 1) {
        const turnsLeft = windupEnemy.windup.turnsLeft - 1;
        events.push({ type: 'enemyWindupTicked', enemy: enemyIndex, intent: windupEnemy.windup.intent, turnsLeft });
        state = withEnemy(state, enemyIndex, (candidate) => ({
          ...candidate,
          windup: candidate.windup === undefined ? undefined : { ...candidate.windup, turnsLeft }
        }));
        state = tickMarchAfterEnemyTurn(state, enemyIndex, events);
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
    const resolvedIntent = state.enemies[enemyIndex]?.intent;
    if (resolvedIntent?.entersPetrify === true) {
      state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, petrifyActive: true, petrifyRawDamage: 0 }));
    }
    if (resolvedIntent?.groupMarch === true) state = applyGroupMarch(state, enemyIndex, db, events);
    // Furnace writes authored on an intent are end-of-intent pins.  The
    // automatic action-resolved gain is applied first, so a reset can
    // deterministically suppress an immediate re-arm without enemy ID logic.
    const deferredFurnaceActions: Extract<EnemyAction, { kind: 'setEnemyResource' | 'adjustEnemyResource' }>[] = [];
    let lastAttackHpDamage = 0;
    let lastAttackBlockedAmount = 0;
    let lastAttackBlocked = false;
    for (const action of state.enemies[enemyIndex]?.intent.actions ?? []) {
      const actingEnemy = state.enemies[enemyIndex];
      if (actingEnemy === undefined || actingEnemy.hp <= 0) break;
      if (action.kind === 'seizeCustody') {
        state = seizeCustody(state, enemyIndex, events);
      } else if (action.kind === 'summonEnemies') {
        if (resolvedIntent?.windup === undefined) {
          events.push({ type: 'enemySummonTelegraphed', sourceEnemyUid: enemyUid(actingEnemy, enemyIndex), enemy: String(action.enemy), maxCount: action.maxCount });
        }
        state = summonEnemies(state, enemyIndex, String(action.enemy), action.maxCount, db, events);
      } else if (action.kind === 'tickHatch') {
        state = tickHatch(state, enemyIndex, 1, db, events);
      } else if (action.kind === 'accelerateHatching') {
        const sourceUid = enemyUid(actingEnemy, enemyIndex);
        for (let target = 0; target < state.enemies.length; target += 1) {
          const targetEnemy = state.enemies[target];
          if (targetEnemy === undefined || targetEnemy.hp <= 0 || targetEnemy.hatch === undefined) continue;
          events.push({ type: 'enemyHatchAccelerated', sourceEnemyUid: sourceUid, targetEnemyUid: enemyUid(targetEnemy, target), amount: action.amount });
          state = tickHatch(state, target, action.amount, db, events);
        }
      } else if (action.kind === 'sealTriggeredSkill') {
        state = sealTriggeredSkill(state, enemyIndex, action.turns, events);
      } else if (action.kind === 'resetRepeatSkillPressure') {
        state = resetRepeatSkillPressure(state, enemyIndex, events);
      } else if (action.kind === 'royalTax') {
        const tax = openRoyalTax(state, enemyIndex, db, events);
        state = tax.state;
        if (!tax.opened) {
          state = applyDamage(
            state,
            { type: 'player' },
            scaledEnemyAttackDamage(state, enemyIndex, action.degradedDamage, db, events),
            'enemy', events, { type: 'enemy', index: enemyIndex }
          );
          if (state.phase === 'defeat') return { state, events };
        }
      } else if (action.kind === 'resetRoyalTaxDefaults') {
        state = resetRoyalTaxDefaults(state, enemyIndex);
      } else if (action.kind === 'royalVaultForeclose') {
        state = resolveRoyalVaultSeizure(state, enemyIndex, db, events);
      } else if (action.kind === 'royalVaultExactSeizure') {
        state = resolveRoyalVaultSeizure(state, enemyIndex, db, events);
      } else if (action.kind === 'royalVaultBarrier') {
        state = applyRoyalVaultBarrier(state, enemyIndex, action.blockPerStoredCoin, events);
      } else if (action.kind === 'leadDecree') {
        state = startLeadDecree(state, enemyIndex, db, events);
      } else if (action.kind === 'returnOldestRoyalVaultCoin') {
        state = returnOldestRoyalVaultCoin(state, enemyIndex, events, action.reason ?? 'phaseEntry');
      } else if (action.kind === 'clearLeadCoins') {
        state = clearLeadCoins(state, enemyIndex, db, events);
      } else if (action.kind === 'createCounterfeit') {
        state = createCounterfeits(state, String(action.coin), action.count, events);
      } else if (action.kind === 'removeCounterfeits') {
        state = removeCounterfeits(state, action.count, events);
      } else if (action.kind === 'sealRecentSkill') {
        state = sealRecentSkill(state, enemyIndex, db, events);
        if (state.phase === 'defeat') return { state, events };
      } else if (action.kind === 'attack') {
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
        const paidReduction = action.ordinary === true ? actingEnemy.royalTaxPaidAttackReduction ?? 0 : 0;
        const scaledDamage = scaledEnemyAttackDamage(state, enemyIndex, Math.max(0, baseDamage - paidReduction), db, events);
        if (paidReduction > 0) state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, royalTaxPaidAttackReduction: undefined }));
        for (let hit = 0; hit < hits; hit += 1) {
          const beforeEventCount = events.length;
          // P6 D1 — 막별 스케일은 공격 피해에만 적용(버프 보너스는 원수치 가산)
          state = applyDamage(
            state,
            { type: 'player' },
            scaledDamage + (hit === 0 ? bonus : 0),
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
          scaledEnemyAttackDamage(state, enemyIndex, action.damage + bonusDamage + (actingEnemy.growthStacks ?? 0), db, events),
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
      } else if (action.kind === 'setEnemyResource') {
        deferredFurnaceActions.push(action);
      } else if (action.kind === 'adjustEnemyResource') {
        deferredFurnaceActions.push(action);
      } else if (action.kind === 'removePlayerStatus') {
        const current = state.player.statuses[action.status];
        if (current === undefined) continue;
        const statuses = { ...state.player.statuses };
        if (current.kind === 'stack') {
          const stacks = Math.max(0, current.stacks - action.stacks);
          if (stacks === 0) delete statuses[action.status]; else statuses[action.status] = { kind: 'stack', stacks };
        } else {
          const turns = Math.max(0, current.turns - action.stacks);
          if (turns === 0) delete statuses[action.status]; else statuses[action.status] = { kind: 'duration', turns };
        }
        state = { ...state, player: { ...state.player, statuses } };
      } else if (action.kind === 'reduceGrowthStacks') {
        state = withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, growthStacks: Math.max(0, (candidate.growthStacks ?? 0) - action.amount) }));
      } else {
        // 미래 행동 타입이 조용히 buff로 흘러들지 않도록 컴파일 타임 exhaustiveness 고정
        const exhausted: never = action;
        throw new Error(`unknown enemy action: ${JSON.stringify(exhausted)}`);
      }
    }
    const completedEnemy = state.enemies[enemyIndex];
    const completedPetrifyIntent = completedEnemy?.petrifyCancelIntentId;
    state = withEnemy(state, enemyIndex, (candidate) => ({
      ...candidate,
      boundHealAlly: undefined,
      ...(resolvedIntent?.windup !== undefined && resolvedIntent.actions.some((action) => action.kind === 'summonEnemies')
        ? { intentIndex: -1 }
        : {}),
      ...(completedPetrifyIntent !== undefined && resolvedIntent?.id === completedPetrifyIntent
        ? { petrifyActive: false, petrifyRawDamage: 0 }
        : {})
    }));
    state = applyPhaseGrowthOnActionResolved(state, enemyIndex, db, events);
    state = applyFurnaceActionResolved(state, enemyIndex, db, events);
    for (const action of deferredFurnaceActions) {
      state = setFurnaceTemperature(
        state,
        enemyIndex,
        action.kind === 'setEnemyResource' ? action.value : (state.enemies[enemyIndex]?.furnaceTemperature ?? 0) + action.amount,
        action.reason,
        events
      );
    }
    state = tickMarchAfterEnemyTurn(state, enemyIndex, events);
  }

  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    for (const status of ['burn', 'poison', 'bleed'] as const) {
      const enemy = state.enemies[enemyIndex];
      const stacks = enemy === undefined ? 0 : statusStacks(enemy.statuses, status);
      if (enemy === undefined || enemy.hp <= 0 || enemy.summonSick === true || stacks <= 0) continue;
      if (status !== 'bleed') state = applyDamage(state, { type: 'enemy', index: enemyIndex }, stacks, status, events);
      const updated = state.enemies[enemyIndex];
      if (updated !== undefined) {
        const remaining = status === 'burn' || status === 'bleed' ? Math.max(0, stacks - 1) : stacks;
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
    if (enemy === undefined || enemy.hp <= 0 || enemy.summonSick === true) continue;
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
    if (!transitionedBeforeAction.has(enemyIndex)) state = maybeChangePhase(state, enemyIndex, db, events);
    state = clearStaleRepeatPressure(state, enemyIndex, db, events);
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
