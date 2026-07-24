import type { StatusId, ConsumeSkillDef, ContentDb, EffectAtom, FlipSkillDef, TargetRef } from '../../content-types';
import { effectiveElements, isStackStatus, isSuccessLadderFlipSkill, skillCooldown } from '../../content-types';
import type { Element, EquipmentDefId, CoinUid, Face, SkillId, SlotId } from '../../ids';
import { rngFrom } from '../../rng';
import { drawCards, drawSpecificCoin, HAND_LIMIT } from '../draw';
import { recordDirective15SkillResolution } from '../directive15';
import { applyLeadToCreatedCoin } from '../directive18';
import type { CombatEvent, DamageSource } from '../events';
import { assertCoinEnchantEligibility, firstUseEchoCoins, rollEnchantedFace } from '../enchant';
import { activeSkillSeal, assertCombatCoinZoneInvariant, isSkillCommandSealed, MAX_PRESERVED_COINS, recordRecentSkillUse, statusStacks, statusTurns } from '../state';
import type { CombatState, StatusState, TurnTriggerInstance } from '../state';
import { actSummon, addSummon, defaultEquipmentId, tickSummonDuration } from '../summons';
import { applyFurnacePlayerBurnClear, applyFurnacePlayerBurnDamage, applyFurnacePlayerDamageThreshold, cancelWindupIfNeeded, skillDamageCancelMatches } from '../furnace';

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
  sourceSkill?: SkillId;
  desiredCoin?: import('../../ids').CoinDefId;
  consumedCount?: number;
}

export const scaleSkillAuthoredEffect = (atom: EffectAtom, multiplier: number | undefined): EffectAtom => {
  if (multiplier === undefined || multiplier === 1) return atom;
  const scale = (value: number) => Math.max(0, Math.floor(value * multiplier));
  switch (atom.kind) {
    case 'damage':
    case 'block':
    case 'nextTurnBlock':
    case 'heal':
    case 'lifesteal':
    case 'prepareNextAttackDamage':
    case 'damageIfTargetShocked':
    case 'damageIfReused':
      return { ...atom, amount: scale(atom.amount) };
    case 'applyStatus':
      return { ...atom, stacks: scale(atom.stacks) };
    case 'removeStatus':
      return { ...atom, stacks: scale(atom.stacks) };
    case 'damageByConsumed':
      return {
        ...atom,
        base: scale(atom.base),
        perCoin: scale(atom.perCoin),
        ...(atom.frostbittenBonusPerCoin === undefined ? {} : { frostbittenBonusPerCoin: scale(atom.frostbittenBonusPerCoin) })
      };
    case 'damageByTargetFrostbite':
      return { ...atom, base: scale(atom.base), multiplier: scale(atom.multiplier), cap: scale(atom.cap) };
    case 'damageByBloodSword':
      return { ...atom, base: scale(atom.base), multiplier: scale(atom.multiplier) };
    case 'damagePlusBlock':
      return { ...atom, base: scale(atom.base), cap: scale(atom.cap) };
    case 'aoeDamage':
      return { ...atom, amount: scale(atom.amount) };
    case 'blockPerTargetShock':
      return { ...atom, base: scale(atom.base), cap: scale(atom.cap) };
    case 'damagePerTargetBurn':
      return { ...atom, amountPerStack: scale(atom.amountPerStack) };
    case 'lifestealByConsumed':
      return { ...atom, amountPerCoin: scale(atom.amountPerCoin) };
    case 'damagePerBlock':
      return { ...atom, amountPerBlock: scale(atom.amountPerBlock) };
    case 'blockFromCurrent':
    case 'scheduleEndTurnBlockAoe':
      return { ...atom, cap: scale(atom.cap) };
    case 'commandChosenSummon':
      return { ...atom, bonusPerTails: scale(atom.bonusPerTails) };
    case 'virtualManaSwordVolley':
      return { ...atom, baseDamage: scale(atom.baseDamage) };
    case 'addTurnTrigger':
      return {
        ...atom,
        trigger: { ...atom.trigger, effects: atom.trigger.effects.map((effect) => scaleSkillAuthoredEffect(effect, multiplier)) }
      };
    // Coin-native output is intentionally never reduced by a skill seal.
    case 'coinDamage':
    case 'fixedDamage':
      return atom;
    // These costs/losses and non-output utility atoms are not skill effects
    // measured by the seal's damage/block/heal/status rule.
    case 'selfDamage':
    case 'loseHp':
    case 'payHp':
    case 'draw':
    case 'drawSpecific':
    case 'returnDiscardCoin':
    case 'nextTurnDraw':
    case 'damageIfTargetStatus':
    case 'preserveChosenCoin':
    case 'increasePreserveCapacity':
    case 'reduceCooldown':
    case 'enterOverheat':
    case 'scheduleOverheat':
    case 'addCoin':
    case 'grantElement':
    case 'investBloodSword':
    case 'bloodOffering':
    case 'summonEquipment':
    case 'empowerSummons':
    case 'increaseWeaponOutput':
    case 'extendAllSummons':
    case 'extendChosenSummon':
    case 'grantChosenSummonAoe':
    case 'cloneChosenSummon':
    case 'doubleTargetShock':
      return atom;
    // Execution/discharge is determined entirely by current target HP/shock.
    case 'executeOrDischargeShock':
    case 'readyRemise':
      return atom;
  }
};

const isAliveEnemy = (state: CombatState, index: number): boolean => {
  const enemy = state.enemies[index];
  return enemy !== undefined && enemy.hp > 0;
};

const firstAliveEnemy = (state: CombatState): number | undefined =>
  state.enemies.findIndex((enemy) => enemy.hp > 0) >= 0 ? state.enemies.findIndex((enemy) => enemy.hp > 0) : undefined;

const remiseTotal = (charges: number, amount: number): number => Math.min(3, Math.max(0, charges + amount));

const removeCounterfeitsAtCombatEnd = (state: CombatState, events: CombatEvent[]): CombatState => {
  const counterfeits = Object.values(state.coins).filter((coin) => coin.counterfeit === true).map((coin) => coin.uid);
  const leads = Object.values(state.coins).filter((coin) => coin.lead === true).map((coin) => coin.uid);
  if (counterfeits.length === 0 && leads.length === 0) return state;
  const removed = new Set([...counterfeits, ...leads]);
  if (counterfeits.length > 0) events.push({ type: 'counterfeitsRemoved', coins: counterfeits });
  if (leads.length > 0) events.push({ type: 'leadCoinsExhausted', coins: leads });
  return {
    ...state,
    coins: Object.fromEntries(Object.entries(state.coins).filter(([, coin]) => coin.counterfeit !== true && coin.lead !== true)),
    zones: {
      ...state.zones,
      draw: state.zones.draw.filter((coin) => !removed.has(coin)),
      hand: state.zones.hand.filter((coin) => !removed.has(coin)),
      discard: state.zones.discard.filter((coin) => !removed.has(coin)),
      exhausted: state.zones.exhausted.filter((coin) => !removed.has(coin)),
      placed: Object.fromEntries(Object.entries(state.zones.placed).map(([slot, coins]) => [slot, coins.filter((coin) => !removed.has(coin))]))
    }
  };
};

export const checkCombatEnd = (state: CombatState, events: CombatEvent[]): CombatState => {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  if (state.player.hp <= 0) {
    events.push({ type: 'combatEnded', result: 'defeat', turns: state.turn });
    const ended = { ...state, phase: 'defeat' as const, player: { ...state.player, pendingOverheat: false } };
    return removeCounterfeitsAtCombatEnd(ended, events);
  }
  if (state.enemies.every((enemy) => enemy.hp <= 0)) {
    // M5 run settlement hook: remove temporary coins from all zones when combat finalization spans combats.
    events.push({ type: 'combatEnded', result: 'victory', turns: state.turn });
    const ended = { ...state, phase: 'victory' as const, player: { ...state.player, pendingOverheat: false } };
    return removeCounterfeitsAtCombatEnd(ended, events);
  }
  return state;
};

const statusCarrier = (state: CombatState, target: TargetRef) => (target.type === 'player' ? state.player : state.enemies[target.index]);

const vassalGuardMultiplier = (state: CombatState, enemyIndex: number): number => {
  const sourceEnemyUid = state.enemies[enemyIndex]?.enemyUid;
  const guards = state.enemies.filter((candidate) => candidate.hp > 0 && candidate.vassalGuard?.sourceEnemyUid === sourceEnemyUid).map((candidate) => candidate.vassalGuard!);
  const maxSources = guards.length === 0 ? 0 : Math.min(...guards.map((guard) => guard.maxSources));
  return Math.max(0, 1 - guards.slice(0, maxSources).reduce((total, guard) => total + guard.damageReductionPercent, 0));
};

const modifiedDamage = (state: CombatState, target: TargetRef, amount: number, attacker?: TargetRef): number => {
  if (attacker === undefined) return amount;
  const attackerStatuses = statusCarrier(state, attacker)?.statuses;
  const targetStatuses = statusCarrier(state, target)?.statuses;
  const frostbiteMultiplier = attackerStatuses !== undefined && (statusTurns(attackerStatuses, 'frostbite') > 0 || statusTurns(attackerStatuses, 'frost') > 0) ? 0.75 : 1;
  const shockMultiplier = targetStatuses !== undefined && statusTurns(targetStatuses, 'shock') > 0 ? 1.5 : 1;
  const bleedMultiplier = targetStatuses !== undefined && statusStacks(targetStatuses, 'bleed') > 0 ? 1.5 : 1;
  const windupMultiplier =
    target.type === 'enemy' && state.enemies[target.index]?.windup !== undefined
      ? (state.enemies[target.index]?.windup?.intent.vulnerableWhileWindup ?? 1)
      : 1;
  const phaseMultiplier = target.type === 'enemy' ? (state.enemies[target.index]?.damageTakenMultiplier ?? 1) : 1;
  const growthTarget = target.type === 'enemy' ? state.enemies[target.index] : undefined;
  const growthMultiplier =
    growthTarget?.roundGrowth === undefined
      ? 1
      : Math.max(0, 1 - (growthTarget.growthStacks ?? 0) * growthTarget.roundGrowth.damageReductionPerStack);
  const petrifyTarget = target.type === 'enemy' ? state.enemies[target.index] : undefined;
  const crackedMultiplier = petrifyTarget !== undefined && (petrifyTarget.crackedTurns ?? 0) > 0 ? (petrifyTarget.petrifyCrackedDamageTakenMultiplier ?? 1) : 1;
  const brokenProtectionMultiplier = petrifyTarget?.protectionLink !== undefined && petrifyTarget.protectionLink.active === false
    ? petrifyTarget.protectionLink.brokenDamageTakenMultiplier
    : 1;
  const guardMultiplier = target.type === 'enemy' ? vassalGuardMultiplier(state, target.index) : 1;
  return Math.floor(amount * frostbiteMultiplier * shockMultiplier * bleedMultiplier * windupMultiplier * phaseMultiplier * growthMultiplier * crackedMultiplier * brokenProtectionMultiplier * guardMultiplier);
};

const statusDamageAmount = (state: CombatState, target: TargetRef, amount: number): number => {
  if (target.type !== 'enemy') return amount;
  const enemy = state.enemies[target.index];
  if (enemy === undefined) return amount;
  const growthMultiplier = enemy.roundGrowth === undefined
    ? 1
    : Math.max(0, 1 - (enemy.growthStacks ?? 0) * enemy.roundGrowth.damageReductionPerStack);
  return Math.floor(
    amount *
    growthMultiplier *
    vassalGuardMultiplier(state, target.index)
  );
};

export const applyDamage = (
  state: CombatState,
  target: TargetRef,
  amount: number,
  source: DamageSource,
  events: CombatEvent[],
  attacker?: TargetRef
): CombatState => {
  if (amount < 0) throw new Error('damage amount cannot be negative');
  const isStatusDamage = source === 'burn' || source === 'poison';
  const bypassesBlock = isStatusDamage || source === 'fixed';
  const baseFinalAmount = isStatusDamage ? statusDamageAmount(state, target, amount) : modifiedDamage(state, target, amount, attacker);
  const petrifyReduction = target.type === 'enemy' ? state.enemies[target.index]?.petrifyDamageReduction : undefined;
  const finalAmount = target.type === 'enemy' && state.enemies[target.index]?.petrifyActive === true && petrifyReduction !== undefined
    ? Math.floor(baseFinalAmount * (1 - petrifyReduction))
    : baseFinalAmount;
  if (target.type === 'player') {
    const canReduce =
      !isStatusDamage && finalAmount > 0 && !state.player.firstDamageReducedThisTurn && state.passives.some((id) => String(id) === 'opening-stance');
    const reducedAmount = Math.max(0, finalAmount - (canReduce ? 1 : 0));
    const blocked = bypassesBlock ? 0 : Math.min(state.player.block, reducedAmount);
    const hpDamage = reducedAmount - blocked;
    const nextHp = Math.max(0, state.player.hp - hpDamage);
    const shouldBreathe =
      hpDamage > 0 &&
      !state.player.combatBreathingUsed &&
      state.passives.some((id) => String(id) === 'thick-hide') &&
      state.player.hp > state.player.maxHp / 2 &&
      nextHp <= state.player.maxHp / 2;
    const player = {
      ...state.player,
      block: state.player.block - blocked,
      hp: shouldBreathe ? Math.min(state.player.maxHp, nextHp + 3) : nextHp,
      firstDamageReducedThisTurn: state.player.firstDamageReducedThisTurn || canReduce,
      combatBreathingUsed: state.player.combatBreathingUsed || shouldBreathe,
    };
    events.push({ type: 'damageDealt', target, amount: hpDamage, blocked, source });
    const damaged = checkCombatEnd({ ...state, player }, events);
    return source === 'burn' && hpDamage > 0 && damaged.phase !== 'defeat'
      ? applyFurnacePlayerBurnDamage(damaged, events)
      : damaged;
  }

  const enemy = state.enemies[target.index];
  if (enemy === undefined || enemy.hp <= 0) return state;
  const protection = state.enemies.findIndex(
    (candidate) => candidate.hp > 0 && candidate.protectionLink?.active === true && candidate.protectionLink.target === target.index
  );
  if (protection >= 0) {
    const redirected = Math.floor(finalAmount * state.enemies[protection]!.protectionLink!.redirectFraction);
    const retained = finalAmount - redirected;
    events.push({ type: 'damageRedirected', protector: protection, protected: target.index, amount: redirected });
    // Both units independently spend their block.  The recursive calls are
    // deliberately fed pre-modified slices and bypass further link lookup.
    let split = applyEnemyDamage(state, target.index, retained, source, events, true, baseFinalAmount, attacker);
    split = applyEnemyDamage(split, protection, redirected, source, events, false, redirected, attacker);
    return checkCombatEnd(cleanupDeadEnemies(split, events), events);
  }
  return checkCombatEnd(cleanupDeadEnemies(applyEnemyDamage(state, target.index, finalAmount, source, events, true, baseFinalAmount, attacker), events), events);
};

const applyEnemyDamage = (
  state: CombatState,
  enemyIndex: number,
  finalAmount: number,
  source: DamageSource,
  events: CombatEvent[],
  trackPetrify: boolean,
  prePetrifyAmount: number,
  attacker?: TargetRef
): CombatState => {
  const enemy = state.enemies[enemyIndex];
  if (enemy === undefined || enemy.hp <= 0) return state;
  const isStatusDamage = source === 'burn' || source === 'poison';
  const blocked = (isStatusDamage || source === 'fixed') ? 0 : Math.min(enemy.block, finalAmount);
  const hpDamage = finalAmount - blocked;
  const nextHp = Math.max(0, enemy.hp - hpDamage);
  const countsTowardRoundGrowth = attacker?.type === 'player' || source === 'burn' || source === 'poison';
  const shouldCancelWindup = source === 'skill' && skillDamageCancelMatches(enemy, nextHp);
  const hatchDelay =
    enemy.hatch !== undefined &&
    !enemy.hatch.delayed &&
    nextHp > 0 &&
    enemy.hp > enemy.maxHp * (enemy.hatch.delayAtHpFraction ?? 0.5) &&
    nextHp <= enemy.maxHp * (enemy.hatch.delayAtHpFraction ?? 0.5);
  const enemies = state.enemies.map((candidate, index) =>
    index === enemyIndex
      ? {
          ...candidate,
          block: candidate.block - blocked,
          marchShield: Math.max(0, (candidate.marchShield ?? 0) - Math.min(blocked, candidate.marchShield ?? 0)),
          hp: nextHp,
          damageTakenThisRound:
            (candidate.damageTakenThisRound ?? 0) + (countsTowardRoundGrowth ? hpDamage : 0),
          hatch: hatchDelay && candidate.hatch !== undefined
            ? { ...candidate.hatch, delayed: true, turnsRemaining: candidate.hatch.turnsRemaining + 1 }
            : candidate.hatch
        }
      : candidate
  );
  events.push({ type: 'damageDealt', target: { type: 'enemy', index: enemyIndex }, amount: hpDamage, blocked, source });
  if (hatchDelay) events.push({ type: 'enemyHatchDelayed', sourceEnemyUid: enemy.enemyUid ?? enemyIndex + 1 });
  let result: CombatState = { ...state, enemies };
  if (shouldCancelWindup) result = cancelWindupIfNeeded(result, enemyIndex, events, true);
  if (source === 'skill' && attacker?.type === 'player' && hpDamage > 0) result = applyFurnacePlayerDamageThreshold(result, enemyIndex, hpDamage, events);
  if (trackPetrify && enemy.petrifyActive === true && enemy.petrifyShatterRawDamageFraction !== undefined && (enemy.crackedTurns ?? 0) <= 0) {
    const threshold = Math.ceil(enemy.maxHp * enemy.petrifyShatterRawDamageFraction);
    const rawDamage = (enemy.petrifyRawDamage ?? 0) + prePetrifyAmount;
    const latestRawDamage = prePetrifyAmount;
    events.push({ type: 'petrifyProgressed', enemy: enemyIndex, rawDamage: latestRawDamage, threshold });
    if (rawDamage >= threshold) {
      events.push({ type: 'petrifyShattered', enemy: enemyIndex, rawDamage });
      const current = result.enemies[enemyIndex]!;
      const cancelsConfiguredWindup = current.windup?.intent.id === current.petrifyCancelIntentId;
      result = {
        ...result,
        enemies: result.enemies.map((candidate, index) =>
          index === enemyIndex
            ? {
                ...candidate,
                petrifyActive: false,
                petrifyRawDamage: 0,
                crackedTurns: candidate.petrifyCrackedTurns ?? 0,
                windup: cancelsConfiguredWindup ? undefined : candidate.windup,
                cancelledWindupIntentId: cancelsConfiguredWindup ? current.windup?.intent.id : candidate.cancelledWindupIntentId
              }
            : candidate
        )
      };
      if (cancelsConfiguredWindup && enemy.windup !== undefined) events.push({ type: 'enemyWindupCancelled', enemy: enemyIndex, intent: enemy.windup.intent });
    } else {
      result = { ...result, enemies: result.enemies.map((candidate, index) => (index === enemyIndex ? { ...candidate, petrifyRawDamage: rawDamage } : candidate)) };
    }
  }
  return result;
};

/** Remove source-owned effects in the same damage resolution as the death. */
export const cleanupDeadEnemies = (state: CombatState, events: CombatEvent[]): CombatState => {
  let enemies = state.enemies;
  let custody = state.custody;
  let discard = state.zones.discard;
  let returnedCustody = false;
  for (let source = 0; source < enemies.length; source += 1) {
    const dead = enemies[source];
    if (dead === undefined || dead.hp > 0 || dead.deathCleanupComplete === true) continue;
    for (let index = 0; index < enemies.length; index += 1) {
      const target = enemies[index];
      if (target === undefined) continue;
      if (target.protectionLink?.target === source) {
        events.push({ type: 'protectionLinkRemoved', protector: index, protected: source });
        enemies = enemies.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, protectionLink: undefined } : candidate);
      }
      if (target.protectionLink !== undefined && index === source) {
        events.push({ type: 'protectionLinkRemoved', protector: source, protected: target.protectionLink.target });
        enemies = enemies.map((candidate, candidateIndex) => candidateIndex === source ? { ...candidate, protectionLink: undefined } : candidate);
      }
      if (target.marchSource === source) {
        events.push({ type: 'enemyMarchRemoved', source, target: index });
        enemies = enemies.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, block: Math.max(0, candidate.block - (candidate.marchShield ?? 0)), marchTurns: 0, marchShield: 0, marchAttackPercent: 0, marchSource: undefined } : candidate);
      }
    }
    if (dead.warBannerAuraPercent !== undefined) events.push({ type: 'enemyAuraRemoved', source });
    const deadUid = dead.enemyUid ?? source + 1;
    events.push({ type: 'enemyRemoved', enemyUid: deadUid, reason: 'killed' });
    const returned = custody
      .filter((entry) => entry.sourceEnemy === source && (entry.sourceEnemyUid === undefined || entry.sourceEnemyUid === deadUid))
      .sort((left, right) => left.seizureOrder - right.seizureOrder);
    returnedCustody = returnedCustody || returned.length > 0;
    for (const entry of returned) {
      discard = [...discard, ...entry.coins];
      const event: CombatEvent = { type: 'coinsReturned', sourceEnemy: source, coins: [...entry.coins] };
      events.push(event);
    }
    custody = custody.filter((entry) => !(entry.sourceEnemy === source && (entry.sourceEnemyUid === undefined || entry.sourceEnemyUid === deadUid)));
    enemies = enemies.map((candidate, index) => index === source ? { ...candidate, deathCleanupComplete: true } : candidate);
  }
  if (enemies === state.enemies) return state;
  const next = { ...state, enemies, custody, zones: { ...state.zones, discard } };
  if (returnedCustody) assertCombatCoinZoneInvariant(next);
  return next;
};

/** Attack skills wear a guard once, even if that skill has multiple hits. */
export const wearProtectionForAttack = (state: CombatState, target: number, events: CombatEvent[]): CombatState => {
  const guard = state.enemies[target];
  const link = guard?.protectionLink;
  if (guard === undefined || link === undefined || !link.active) return state;
  const remaining = Math.max(0, link.durability - 1);
  if (remaining > 0) return { ...state, enemies: state.enemies.map((enemy, index) => index === target ? { ...enemy, protectionLink: { ...link, durability: remaining } } : enemy) };
  events.push({ type: 'protectionLinkBroken', protector: target, protected: link.target, turns: link.brokenTurns });
  return { ...state, enemies: state.enemies.map((enemy, index) => index === target ? { ...enemy, protectionLink: { ...link, durability: 0, active: false, turnsUntilRestore: link.brokenTurns } } : enemy) };
};

const scheduleOverheat = (state: CombatState, events: CombatEvent[]): CombatState => {
  if (state.player.overheat || state.player.pendingOverheat) return state;
  events.push({ type: 'overheatScheduled' });
  return { ...state, player: { ...state.player, pendingOverheat: true } };
};

export const applyBlock = (state: CombatState, target: TargetRef, amount: number, events: CombatEvent[]): CombatState => {
  if (amount < 0) throw new Error('block amount cannot be negative');
  events.push({ type: 'blockGained', target, amount });
  if (target.type === 'player') {
    return { ...state, player: { ...state.player, block: state.player.block + amount } };
  }
  const enemies = state.enemies.map((enemy, index) => (index === target.index ? { ...enemy, block: enemy.block + amount } : enemy));
  return { ...state, enemies };
};

const addStatus = (current: StatusState | undefined, status: EffectAtom & { kind: 'applyStatus' }): StatusState => {
  if (isStackStatus(status.status)) {
    return { kind: 'stack', stacks: (current?.kind === 'stack' ? current.stacks : 0) + status.stacks };
  }
  return { kind: 'duration', turns: (current?.kind === 'duration' ? current.turns : 0) + status.stacks };
};

const addTemporaryCoin = (state: CombatState, atom: Extract<EffectAtom, { kind: 'addCoin' }>, db: ContentDb, events: CombatEvent[]): CombatState => {
  let nextState = state;
  const rng = nextState.rngImpl?.shuffle ?? rngFrom(nextState.rng.shuffle);

  for (let i = 0; i < atom.count; i += 1) {
    const coin = nextState.nextUid as CoinUid;
    const coins = {
      ...nextState.coins,
      [Number(coin)]: { uid: coin, defId: atom.coin, permanent: false as const, grants: [] }
    };

    if (atom.zone === 'draw') {
      const draw = [...nextState.zones.draw];
      if (atom.position === 'top') draw.unshift(coin);
      else draw.splice(rng.int(draw.length + 1), 0, coin);
      nextState = {
        ...nextState,
        coins,
        nextUid: nextState.nextUid + 1,
        rng: atom.position === 'top' ? nextState.rng : { ...nextState.rng, shuffle: rng.snapshot() },
        zones: { ...nextState.zones, draw }
      };
      events.push({ type: 'coinCreated', coin, defId: String(atom.coin), zone: 'draw' });
      nextState = applyLeadToCreatedCoin(nextState, coin, db, events);
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
      nextState = applyLeadToCreatedCoin(nextState, coin, db, events);
      continue;
    }

    nextState = {
      ...nextState,
      coins,
      nextUid: nextState.nextUid + 1,
      zones: { ...nextState.zones, discard: [coin, ...nextState.zones.discard] }
    };
    events.push({ type: 'coinCreated', coin, defId: String(atom.coin), zone: 'discard' });
    nextState = applyLeadToCreatedCoin(nextState, coin, db, events);
  }

  return nextState;
};

const healPlayer = (state: CombatState, amount: number, events: CombatEvent[]): CombatState => {
  if (statusTurns(state.player.statuses, 'healLock') > 0) {
    events.push({ type: 'healPrevented', target: { type: 'player' }, amount, reason: 'healLock' });
    return state;
  }
  const hp = Math.min(state.player.maxHp, state.player.hp + amount);
  const gained = hp - state.player.hp;
  if (gained <= 0) return state;
  events.push({
    type: 'healed',
    target: { type: 'player' },
    amount: gained,
    hp
  });
  return { ...state, player: { ...state.player, hp } };
};

const investBloodSword = (state: CombatState, amount: number, db: ContentDb, events: CombatEvent[]): CombatState => {
  const investment = Math.min(30, state.player.bloodSwordInvestment + amount);
  const invested = investment - state.player.bloodSwordInvestment;
  if (invested <= 0) return state;
  let next: CombatState = {
    ...state,
    player: {
      ...state.player,
      bloodSwordInvestment: investment,
      bloodSwordPower: investment >= 30 ? 5 : investment >= 25 ? 4 : investment >= 15 ? 3 : investment >= 10 ? 2 : investment >= 5 ? 1 : 0
    }
  };
  const dividend = state.passives.some((id) => (db.passives ?? {})[String(id)]?.mechanic === 'bloodSwordDividend');
  if (dividend) next = applyBlock(next, { type: 'player' }, Math.min(5, invested), events);
  return next;
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
        targetSet.has(coin.uid) && !coin.grants.includes(atom.element) ? { ...coin, grants: [...coin.grants, atom.element] } : coin
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
    case 'coinDamage':
      return target.type === 'enemy' && isAliveEnemy(state, target.index)
        ? applyDamage(state, target, atom.amount, 'coin', events, { type: 'player' })
        : state;
    case 'fixedDamage':
      return target.type === 'enemy' && isAliveEnemy(state, target.index)
        ? applyDamage(state, target, atom.amount, 'fixed', events)
        : state;
    case 'damageIfTargetStatus': {
      if (target.type !== 'enemy') return state;
      const statuses = state.enemies[target.index]?.statuses ?? {};
      const active = isStackStatus(atom.status) ? statusStacks(statuses, atom.status) > 0 : statusTurns(statuses, atom.status) > 0;
      return active ? applyDamage(state, target, atom.amount, 'skill', events, { type: 'player' }) : state;
    }
    case 'aoeDamage': {
      let next = state;
      for (let index = 0; index < next.enemies.length; index += 1) {
        if ((next.enemies[index]?.hp ?? 0) <= 0) continue;
        next = applyDamage(next, { type: 'enemy', index }, atom.amount, 'skill', events, { type: 'player' });
      }
      return next;
    }
    case 'block':
      return applyBlock(state, { type: 'player' }, atom.amount, events);
    case 'nextTurnBlock':
      return { ...state, player: { ...state.player, nextTurnBlock: state.player.nextTurnBlock + atom.amount } };
    case 'selfDamage':
      return applyDamage(state, { type: 'player' }, atom.amount, 'self', events);
    case 'loseHp': {
      if (state.player.hp <= atom.amount) return state;
      events.push({ type: 'damageDealt', target: { type: 'player' }, amount: atom.amount, blocked: 0, source: 'self' });
      return { ...state, player: { ...state.player, hp: state.player.hp - atom.amount } };
    }
    case 'payHp': {
      if (state.player.hp <= atom.amount) throw new Error('not enough hp to pay skill cost');
      const hp = state.player.hp - atom.amount;
      events.push({ type: 'damageDealt', target: { type: 'player' }, amount: atom.amount, blocked: 0, source: 'self' });
      return { ...state, player: { ...state.player, hp } };
    }
    // P7 D4 — 회복: 플레이어 전용, maxHp 상한
    case 'heal': {
      return healPlayer(state, atom.amount, events);
    }
    // P7 D3 — 즉시 드로우 / 다음 턴 드로우 보너스
    case 'draw': {
      const drawn = drawCards(state, atom.count);
      events.push(...drawn.events);
      return drawn.state;
    }
    case 'drawSpecific': {
      const requested = options?.desiredCoin;
      const defId = requested !== undefined && atom.coins.some((coin) => String(coin) === String(requested)) ? requested : atom.coins[0];
      if (defId === undefined) return state;
      const drawn = drawSpecificCoin(state, defId, atom.count, atom.preserve === true);
      events.push(...drawn.events);
      return drawn.state;
    }
    case 'returnDiscardCoin': {
      const room = Math.max(0, HAND_LIMIT - state.zones.hand.length);
      const selected = state.zones.discard
        .filter((coin) => String(state.coins[Number(coin)]?.defId) === String(atom.coin))
        .slice(0, Math.min(atom.count, room));
      if (selected.length === 0) return state;
      const selectedSet = new Set(selected);
      events.push({ type: 'coinsDrawn', coins: selected });
      return {
        ...state,
        zones: {
          ...state.zones,
          discard: state.zones.discard.filter((coin) => !selectedSet.has(coin)),
          hand: [...state.zones.hand, ...selected]
        }
      };
    }
    case 'nextTurnDraw':
      return {
        ...state,
        player: { ...state.player, nextDrawBonus: state.player.nextDrawBonus + atom.count }
      };
    case 'preserveChosenCoin': {
      const coin = chosen?.find((candidate) => state.zones.hand.includes(candidate));
      if (coin === undefined) return state;
      if (state.coins[Number(coin)]?.preserved === true) return state;
      if (Object.values(state.coins).filter((candidate) => candidate.preserved === true).length >= MAX_PRESERVED_COINS) {
        return state;
      }
      events.push({ type: 'coinsPreserved', coins: [coin] });
      return {
        ...state,
        coins: { ...state.coins, [Number(coin)]: { ...state.coins[Number(coin)]!, preserved: true } }
      };
    }
    case 'increasePreserveCapacity':
      return { ...state, player: { ...state.player, additionalPreserveThisTurn: Math.min(2, state.player.additionalPreserveThisTurn + atom.count) } };
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
    case 'scheduleOverheat':
      return scheduleOverheat(state, events);
    case 'applyStatus': {
      const statusTarget = atom.to === 'self' ? { type: 'player' as const } : target;
      if (statusTarget.type === 'enemy' && !isAliveEnemy(state, statusTarget.index)) return state;
      const firstBurnBoost =
        atom.status === 'burn' && atom.to === 'target' && !state.player.firstBurnBoostUsedThisTurn && state.passives.some((id) => String(id) === 'ember-stock');
      const appliedAtom = firstBurnBoost ? { ...atom, stacks: atom.stacks + 1 } : atom;
      const event =
        isStackStatus(atom.status)
          ? { type: 'statusApplied' as const, target: statusTarget, status: atom.status, stacks: appliedAtom.stacks }
          : { type: 'statusApplied' as const, target: statusTarget, status: atom.status, stacks: atom.stacks, turns: atom.stacks };
      if (statusTarget.type === 'player') {
        events.push(event);
        return {
          ...state,
          player: {
            ...state.player,
            statuses: { ...state.player.statuses, [atom.status]: addStatus(state.player.statuses[atom.status], appliedAtom) },
            firstBurnBoostUsedThisTurn: state.player.firstBurnBoostUsedThisTurn || firstBurnBoost
          }
        };
      }
      const enemies = state.enemies.map((enemy, index) =>
        index === statusTarget.index ? { ...enemy, statuses: { ...enemy.statuses, [atom.status]: addStatus(enemy.statuses[atom.status], appliedAtom) } } : enemy
      );
      events.push(event);
      return {
        ...state,
        enemies,
        player: {
          ...state.player,
          firstBurnBoostUsedThisTurn: state.player.firstBurnBoostUsedThisTurn || firstBurnBoost,
          burnAppliedThisTurn: state.player.burnAppliedThisTurn || atom.status === 'burn'
        }
      };
    }
    case 'removeStatus': {
      const statusTarget = atom.to === 'self' ? { type: 'player' as const } : target;
      const current = statusTarget.type === 'player' ? state.player.statuses[atom.status] : state.enemies[statusTarget.index]?.statuses[atom.status];
      if (current === undefined) return state;
      const removed = current.kind === 'stack' ? Math.min(current.stacks, atom.stacks) : Math.min(current.turns, atom.stacks);
      const nextStatus = current.kind === 'stack' ? current.stacks - removed : current.turns - removed;
      if (statusTarget.type === 'player') {
        const statuses = { ...state.player.statuses };
        if (nextStatus === 0) delete statuses[atom.status]; else statuses[atom.status] = current.kind === 'stack' ? { kind: 'stack', stacks: nextStatus } : { kind: 'duration', turns: nextStatus };
        const cleared = { ...state, player: { ...state.player, statuses } };
        return atom.to === 'self' && atom.status === 'burn' && removed > 0 ? applyFurnacePlayerBurnClear(cleared, events) : cleared;
      }
      const enemies = state.enemies.map((enemy, index) => {
        if (index !== statusTarget.index) return enemy;
        const statuses = { ...enemy.statuses };
        if (nextStatus === 0) delete statuses[atom.status]; else statuses[atom.status] = current.kind === 'stack' ? { kind: 'stack', stacks: nextStatus } : { kind: 'duration', turns: nextStatus };
        return { ...enemy, statuses };
      });
      return { ...state, enemies };
    }
    case 'addCoin':
      return addTemporaryCoin(state, atom, db, events);
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
      return options?.suppressTurnTriggers !== true ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope) : damaged;
    }
    case 'damageByConsumed': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const count = options?.consumedCount ?? 0;
      const frozen = statusTurns(state.enemies[target.index]?.statuses ?? {}, 'frostbite') > 0;
      const amount = atom.base + count * (atom.perCoin + (frozen ? (atom.frostbittenBonusPerCoin ?? 0) : 0));
      const damaged = applyDamage(state, target, amount, 'skill', events, { type: 'player' });
      return options?.suppressTurnTriggers !== true ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope) : damaged;
    }
    case 'damageByTargetFrostbite': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const turns = statusTurns(state.enemies[target.index]?.statuses ?? {}, 'frostbite');
      const damaged = applyDamage(state, target, Math.min(atom.cap, atom.base + turns * atom.multiplier), 'skill', events, { type: 'player' });
      return options?.suppressTurnTriggers !== true ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope) : damaged;
    }
    case 'lifesteal':
      return events.some((event) => event.type === 'damageDealt' && event.target.type === 'enemy' && event.amount > 0 && event.source === 'skill')
        ? healPlayer(state, atom.amount, events)
        : state;
    case 'lifestealByConsumed':
      return events.some((event) => event.type === 'damageDealt' && event.target.type === 'enemy' && event.amount > 0 && event.source === 'skill')
        ? healPlayer(state, atom.amountPerCoin * (options?.consumedCount ?? 0), events)
        : state;
    case 'investBloodSword':
      return investBloodSword(state, options?.consumedCount ?? 0, db, events);
    case 'bloodOffering':
      return state.player.bloodSwordPower >= 5
        ? {
            ...state,
            player: {
              ...state.player,
              bloodSwordReleaseBonus: state.player.bloodSwordReleaseBonus + (options?.consumedCount ?? 0) * 2
            }
          }
        : investBloodSword(state, options?.consumedCount ?? 0, db, events);
    case 'damageByBloodSword': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const amount = atom.base + state.player.bloodSwordPower * atom.multiplier + state.player.bloodSwordReleaseBonus;
      const damaged = applyDamage(state, target, amount, 'skill', events, {
        type: 'player'
      });
      return options?.suppressTurnTriggers !== true ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope) : damaged;
    }
    // P6 D6 — 마력 갑주: 현재 방어 참조 피해 (방어 비소모)
    case 'damagePerBlock': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      const block = state.player.block;
      if (block <= 0) return state;
      const damaged = applyDamage(state, target, block * atom.amountPerBlock, 'skill', events, { type: 'player' });
      return options?.suppressTurnTriggers !== true ? fireTurnTriggers(damaged, 'onDamageDealt', target, db, events, options?.turnTriggerScope) : damaged;
    }
    case 'blockFromCurrent':
      return applyBlock(state, { type: 'player' }, Math.min(atom.cap, state.player.block), events);
    case 'damagePlusBlock': {
      if (target.type !== 'enemy' || !isAliveEnemy(state, target.index)) return state;
      return applyDamage(state, target, atom.base + Math.min(atom.cap, state.player.block), 'skill', events, { type: 'player' });
    }
    case 'prepareNextAttackDamage':
      return { ...state, player: { ...state.player, nextAttackDamageBonus: state.player.nextAttackDamageBonus + atom.amount } };
    case 'scheduleEndTurnBlockAoe':
      return { ...state, player: { ...state.player, endTurnBlockAoeCap: Math.max(state.player.endTurnBlockAoeCap, atom.cap) } };
    // P6 D6 — 소환 (뒷면당 지속 연장)
    case 'summonEquipment': {
      const equipmentId = atom.equipment === 'chosen' ? (options?.chosenEquipment ?? defaultEquipmentId(db)) : atom.equipment;
      if (equipmentId === undefined) return state;
      const duration = atom.duration + (atom.durationPerTails ?? 0) * (options?.tailsCount ?? 0);
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
      return tickSummonDuration(acted, uid, events, db, true);
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
        summons: state.summons.map((summon) => (summon.uid === uid ? { ...summon, duration: summon.duration + atom.amount } : summon))
      };
    }
    case 'grantChosenSummonAoe': {
      if (state.summons.length === 0) return state;
      const uid = options?.chosenSummon ?? state.summons[0]!.uid;
      const uses = atom.uses + (atom.usesPerHeads ?? 0) * (options?.headsCount ?? 0);
      events.push({ type: 'summonAoeGranted', uid, uses });
      return { ...state, summons: state.summons.map((summon) => (summon.uid === uid ? { ...summon, aoeUses: summon.aoeUses + uses } : summon)) };
    }
    case 'cloneChosenSummon': {
      if (state.summons.length === 0) return state;
      const uid = options?.chosenSummon ?? state.summons[0]!.uid;
      const source = state.summons.find((summon) => summon.uid === uid);
      if (source === undefined) return state;
      if (state.summons.length >= 3) {
        return {
          ...state,
          summons: state.summons.map((summon) => (summon.uid === uid ? { ...summon, duration: summon.duration + atom.fullCapExtension } : summon))
        };
      }
      const clone = { ...source, uid: state.nextSummonUid, duration: atom.duration };
      events.push({ type: 'summonCloned', sourceUid: source.uid, uid: clone.uid, equipment: String(clone.defId) });
      return { ...state, summons: [...state.summons, clone], nextSummonUid: state.nextSummonUid + 1 };
    }
    case 'virtualManaSwordVolley': {
      const count = (atom.baseCount ?? 3) + state.summons.length;
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
      return {
        ...state,
        enemies: state.enemies.map((enemy, index) =>
          index === target.index ? { ...enemy, statuses: { ...enemy.statuses, shock: { kind: 'duration', turns: turns * 2 } } } : enemy
        )
      };
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
      return {
        ...damaged,
        enemies: damaged.enemies.map((item, index) => (index === target.index ? { ...item, statuses: { ...item.statuses, shock: undefined } } : item))
      };
    }
    case 'damageIfTargetShocked': {
      if (target.type !== 'enemy' || statusTurns(state.enemies[target.index]?.statuses ?? {}, 'shock') <= 0) return state;
      return applyDamage(state, target, atom.amount, 'skill', events, { type: 'player' });
    }
    case 'damageIfReused':
      return options?.isReuse === true ? applyDamage(state, target, atom.amount, 'skill', events, { type: 'player' }) : state;
    case 'readyRemise': {
      const total = remiseTotal(state.player.remiseCharges, atom.amount ?? 1);
      const amount = total - state.player.remiseCharges;
      if (amount <= 0) return state;
      events.push({ type: 'remiseGained', amount, total });
      return { ...state, player: { ...state.player, remiseCharges: total } };
    }
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

const HOSTILE_STATUSES: ReadonlySet<StatusId> = new Set(['burn', 'bleed', 'frostbite', 'frost', 'shock']);

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
  if (atom.kind === 'coinDamage' || atom.kind === 'fixedDamage') {
    if (explicitTarget !== undefined && isAliveEnemy(state, explicitTarget)) {
      return [{ type: 'enemy', index: explicitTarget }];
    }
    if (skillTarget.type === 'enemy' && isAliveEnemy(state, skillTarget.index)) return [skillTarget];
    return [];
  }
  const hostile =
    atom.kind === 'damage' ||
    atom.kind === 'damageIfTargetStatus' ||
    atom.kind === 'damagePerTargetBurn' ||
    atom.kind === 'damageByConsumed' ||
    atom.kind === 'damageByTargetFrostbite' ||
    atom.kind === 'damageByBloodSword' ||
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
  atom.kind === 'fixedDamage' ||
  atom.kind === 'damageIfTargetStatus' ||
  atom.kind === 'damagePerTargetBurn' ||
  atom.kind === 'damageByConsumed' ||
  atom.kind === 'damageByTargetFrostbite' ||
  atom.kind === 'damageByBloodSword' ||
  atom.kind === 'damagePerBlock' ||
  atom.kind === 'damagePlusBlock' ||
  (atom.kind === 'applyStatus' && atom.to === 'target');

/** 전체 대상 스킬의 본체/면 효과를 모든 생존 적에게 적용한다. */
export const targetsForSkillEffect = (state: CombatState, atom: EffectAtom, skill: FlipSkillDef | ConsumeSkillDef, fallback: TargetRef): TargetRef[] => {
  if (
    atom.kind === 'block' ||
    atom.kind === 'nextTurnBlock' ||
    atom.kind === 'blockFromCurrent' ||
    atom.kind === 'prepareNextAttackDamage' ||
    atom.kind === 'scheduleEndTurnBlockAoe' ||
    atom.kind === 'payHp' ||
    atom.kind === 'heal' ||
    atom.kind === 'scheduleOverheat' ||
    atom.kind === 'aoeDamage' ||
    atom.kind === 'returnDiscardCoin' ||
    atom.kind === 'lifesteal' ||
    atom.kind === 'lifestealByConsumed' ||
    atom.kind === 'investBloodSword' ||
    atom.kind === 'bloodOffering'
  ) {
    return [{ type: 'player' }];
  }
  return skill.targetType === 'all-enemies' && isTargetEffect(atom)
    ? state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [{ type: 'enemy' as const, index }] : []))
    : [fallback];
};

/** 첫 기존 피해 축에 고정 피해를 합산한다. 별도 타격을 만들지 않는다. */
export const applyPrimaryDamageBonus = (input: readonly EffectAtom[], bonus: number): EffectAtom[] => {
  let damageBoosted = false;
  return input.map((atom): EffectAtom => {
    if (!damageBoosted) {
      if (
        atom.kind === 'damage' ||
        atom.kind === 'aoeDamage' ||
        atom.kind === 'damageIfTargetShocked' ||
        atom.kind === 'damageIfReused'
      ) {
        damageBoosted = true;
        return { ...atom, amount: atom.amount + bonus };
      }
      if (
        atom.kind === 'damageByConsumed' ||
        atom.kind === 'damageByTargetFrostbite' ||
        atom.kind === 'damageByBloodSword' ||
        atom.kind === 'damagePlusBlock'
      ) {
        damageBoosted = true;
        return { ...atom, base: atom.base + bonus };
      }
    }
    return atom;
  });
};

/** P11 숙성된 패: 피해 축과 방어 축을 각각 한 번만 +2 한다. */
export const applyMaturedHandBonus = (input: readonly EffectAtom[]): EffectAtom[] => {
  let blockBoosted = false;
  const effects = applyPrimaryDamageBonus(input, 2).map((atom): EffectAtom => {
    if (!blockBoosted) {
      if (atom.kind === 'block') {
        blockBoosted = true;
        return { ...atom, amount: atom.amount + 2 };
      }
      if (atom.kind === 'blockPerTargetShock') {
        blockBoosted = true;
        return { ...atom, base: atom.base + 2 };
      }
    }
    return atom;
  });
  return effects;
};

/** 자기 대상 스킬도 현재 지정한 생존 적에게 차가운 손버릇을 적용한다. */
export const currentEnemyTargetForPassive = (state: CombatState, skillTarget: TargetRef): TargetRef | undefined => {
  if (skillTarget.type === 'enemy' && isAliveEnemy(state, skillTarget.index)) return skillTarget;
  if (state.lastTargetedEnemy !== null && isAliveEnemy(state, state.lastTargetedEnemy)) {
    return { type: 'enemy', index: state.lastTargetedEnemy };
  }
  const index = firstAliveEnemy(state);
  return index === undefined ? undefined : { type: 'enemy', index };
};

export const applyBloodSwordSkillResolved = (
  input: CombatState,
  skill: FlipSkillDef | ConsumeSkillDef,
  aliveBefore: number,
  db: ContentDb,
  events: CombatEvent[]
): CombatState => {
  if (skill.bloodSword !== true) return input;
  let state = input;
  if (state.player.bloodSwordPower >= 2 && !state.player.bloodSwordFirstSkillBlockUsedThisTurn) {
    state = applyBlock(state, { type: 'player' }, 2, events);
    state = {
      ...state,
      player: { ...state.player, bloodSwordFirstSkillBlockUsedThisTurn: true }
    };
  }
  const aliveAfter = state.enemies.filter((enemy) => enemy.hp > 0).length;
  if (state.player.bloodSwordPower >= 3 && aliveAfter < aliveBefore && !state.player.bloodSwordKillCoinUsedThisTurn) {
    const blood = Object.values(db.coins).find((coin) => coin.element === 'blood')?.id;
    if (blood !== undefined) state = addTemporaryCoin(state, { kind: 'addCoin', coin: blood, zone: 'discard', count: 1 }, db, events);
    state = {
      ...state,
      player: { ...state.player, bloodSwordKillCoinUsedThisTurn: true }
    };
  }
  return state;
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

const collectEffects = (
  skill: FlipSkillDef,
  faces: readonly Face[],
  coinElements: readonly (readonly Element[])[] = [],
  overheatActive = false
): EffectAtom[] => {
  const headCount = faces.filter((face) => face === 'heads').length;
  const tailCount = faces.length - headCount;
  if (isSuccessLadderFlipSkill(skill)) {
    const successCount = skill.successFace === 'heads' ? headCount : tailCount;
    return [...(skill.successLadder[successCount] ?? [])];
  }
  const base = skill.base ?? [];
  const effects: EffectAtom[] = [...base];
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
      for (let i = 0; i < base.length; i += 1) {
        if (base[i]!.kind === 'damage') insertAt = i;
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

const resonanceEffects = (
  skill: FlipSkillDef,
  faces: readonly Face[],
  coinElements: readonly (readonly Element[])[]
): readonly EffectAtom[] => {
  if (!isSuccessLadderFlipSkill(skill) || skill.resonance === undefined) return [];
  const resonates = faces.some(
    (face, index) => face === skill.successFace && (coinElements[index] ?? []).includes(skill.resonance!.element)
  );
  return resonates ? skill.resonance.effects : [];
};

const isRemiseRepeatAtom = (atom: EffectAtom): boolean =>
  atom.kind === 'damage' ||
  atom.kind === 'block' ||
  atom.kind === 'selfDamage' ||
  atom.kind === 'heal' ||
  atom.kind === 'applyStatus' ||
  atom.kind === 'damagePerTargetBurn' ||
  atom.kind === 'damageByConsumed' ||
  atom.kind === 'damageByTargetFrostbite' ||
  atom.kind === 'lifesteal' ||
  atom.kind === 'lifestealByConsumed' ||
  atom.kind === 'damageByBloodSword' ||
  atom.kind === 'damagePerBlock' ||
  atom.kind === 'blockFromCurrent' ||
  atom.kind === 'damagePlusBlock' ||
  atom.kind === 'aoeDamage' ||
  atom.kind === 'doubleTargetShock' ||
  atom.kind === 'blockPerTargetShock' ||
  atom.kind === 'executeOrDischargeShock' ||
  atom.kind === 'damageIfTargetShocked' ||
  atom.kind === 'damageIfReused';

const repeatTargetForSkill = (state: CombatState, skill: FlipSkillDef, original: TargetRef): TargetRef | undefined => {
  if (skill.targetType === 'self') return { type: 'player' };
  if (skill.targetType === 'single-enemy') {
    if (original.type === 'enemy' && isAliveEnemy(state, original.index)) return original;
    const fallback = firstAliveEnemy(state);
    return fallback === undefined ? undefined : { type: 'enemy', index: fallback };
  }
  const fallback = firstAliveEnemy(state);
  return fallback === undefined ? undefined : { type: 'enemy', index: fallback };
};

export const resolveFlip = (
  input: CombatState,
  slot: SlotId,
  skill: FlipSkillDef,
  target: number | undefined,
  db: ContentDb,
  coinUids: readonly CoinUid[],
  chosen?: readonly CoinUid[],
  summonChoice?: { chosenEquipment?: EquipmentDefId; chosenSummon?: number; desiredCoin?: import('../../ids').CoinDefId }
): ResolveResult => {
  const slotState = input.slots[Number(slot)];
  if (slotState === undefined) throw new Error('slot does not exist');
  if (slotState.cooldownRemaining > 0) throw new Error('skill is cooling down');
  if (isSkillCommandSealed(input, slot)) throw new Error('skill is sealed');
  if (skill.oncePerCombat === true && slotState.usedThisCombat) throw new Error('skill already used this combat');

  const placed = coinUids;
  if (placed.length !== skill.cost) throw new Error('placed coin count must equal skill cost');
  assertCoinEnchantEligibility(input, placed);
  if (skill.requiredCoin !== undefined && placed.some((coin) => String(input.coins[Number(coin)]?.defId) !== String(skill.requiredCoin))) {
    throw new Error('placed coin does not satisfy required coin');
  }
  const hpCost = (skill.base ?? []).reduce((total, atom) => total + (atom.kind === 'payHp' ? atom.amount : 0), 0);
  if (hpCost > 0 && input.player.hp <= hpCost) throw new Error('not enough hp to pay skill cost');
  for (const atom of skill.base ?? []) {
    if (atom.kind === 'returnDiscardCoin' && !input.zones.discard.some((coin) => String(input.coins[Number(coin)]?.defId) === String(atom.coin))) {
      throw new Error('required coin is not in discard');
    }
  }
  const skillTarget = targetForSkill(input, skill, target);
  const aliveBefore = input.enemies.filter((enemy) => enemy.hp > 0).length;
  const events: CombatEvent[] = [{ type: 'skillUsed', slot, skill: skill.id, kind: 'flip' }];
  const turnTriggerScope = input.turnTriggers;
  const passiveMechanics = new Set(
    input.passives.flatMap((id) => {
      const mechanic = (db.passives ?? {})[String(id)]?.mechanic;
      return mechanic === undefined ? [] : [mechanic];
    })
  );
  const usedPreserved = placed.some((coin) => input.coins[Number(coin)]?.preserved === true);
  let retrievalCoin: CoinUid | undefined;
  const residualCoin =
    !input.player.residualChargeUsed && passiveMechanics.has('residualCharge')
      ? placed.find((uid) => {
          const coin = input.coins[Number(uid)];
          return coin !== undefined && effectiveElements(coin, db).includes('lightning');
        })
      : undefined;
  // P7 D5 — 과열 강화 분기 보유 스킬이 성공 해결되면 해결 후 과열 소비 (finish 단일 경로)
  const consumesOverheat = input.player.overheat && (skill.overheatBonus?.length ?? 0) > 0;
  const effectMultiplier = activeSkillSeal(input, slot)?.effectMultiplier;
  const finish = (finishedState: CombatState): ResolveResult => {
    const echoed = firstUseEchoCoins(finishedState, placed, events);
    const echoCoins = new Set(echoed.coins);
    const routedState = echoed.state;
    const returnElement = skill.returnUsedElementToDrawTop?.element;
    const minimumUsed = skill.returnUsedElementToDrawTop?.minimumUsed ?? 1;
    const canReturnUsedElement =
      returnElement !== undefined &&
      placed.length >= minimumUsed &&
      placed.every((coin) => {
        const instance = routedState.coins[Number(coin)];
        return instance !== undefined && db.coins[String(instance.defId)]?.element === returnElement;
      });
    const skillReturned = new Set(
      !canReturnUsedElement || skill.returnUsedElementToDrawTop === undefined
        ? []
        : placed
            .filter((coin) => {
              const instance = routedState.coins[Number(coin)];
              return instance !== undefined && db.coins[String(instance.defId)]?.element === skill.returnUsedElementToDrawTop!.element;
            })
            .slice(0, skill.returnUsedElementToDrawTop.count)
    );
    const routedToDraw = new Set(
      [retrievalCoin, residualCoin, ...skillReturned].filter(
        (coin): coin is CoinUid => coin !== undefined && !echoCoins.has(coin),
      ),
    );
    // Cost order is the deterministic top-of-draw order. Two passives may route
    // different coins, while a coin claimed by both is returned only once.
    const topDraw = placed.filter((coin) => routedToDraw.has(coin));
    const exhaustedLead = placed.filter((coin) => routedState.coins[Number(coin)]?.lead === true && !echoCoins.has(coin));
    const discarded = placed.filter((coin) => !echoCoins.has(coin) && !routedToDraw.has(coin) && !exhaustedLead.includes(coin));
    events.push({ type: 'coinsDiscarded', coins: [...discarded], reason: 'skillCost' });
    if (exhaustedLead.length > 0) events.push({ type: 'leadCoinsExhausted', coins: exhaustedLead });
    let state = {
      ...routedState,
      coins: Object.fromEntries(
        Object.entries(routedState.coins).map(([key, coin]) => [key, placed.includes(coin.uid) ? { ...coin, preserved: false } : coin])
      ),
      player: {
        ...routedState.player,
        retrievalHabitUsed: routedState.player.retrievalHabitUsed || retrievalCoin !== undefined,
        residualChargeUsed: routedState.player.residualChargeUsed || residualCoin !== undefined
      },
      zones: {
        ...routedState.zones,
        placed: { ...routedState.zones.placed, [slot]: (routedState.zones.placed[slot] ?? []).filter((coin) => !placed.includes(coin)) },
        hand: [...echoed.coins, ...routedState.zones.hand],
        draw: topDraw.length === 0 ? routedState.zones.draw : [...topDraw, ...routedState.zones.draw],
        discard: [...routedState.zones.discard, ...discarded],
        exhausted: [...routedState.zones.exhausted, ...exhaustedLead]
      }
    };
    if (consumesOverheat && state.player.overheat) {
      events.push({ type: 'overheatConsumed', skill: skill.id });
      state = { ...state, player: { ...state.player, overheat: false } };
    }
    state = recordRecentSkillUse(state, slot);
    state = recordDirective15SkillResolution(state, input, slot, placed, db, events);
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
  for (let index = 0; index < placed.length; index += 1) {
    const coin = placed[index]!;
    const rolled = rollEnchantedFace(
      state,
      coin,
      rng,
      isSuccessLadderFlipSkill(skill) ? skill.successFace : undefined,
      events,
    );
    state = rolled.state;
    faces.push(rolled.face);
    events.push({ type: 'coinFlipped', coin, face: rolled.face });
  }
  state = { ...state, rng: { ...state.rng, flip: rng.snapshot() } };

  const coinElements = placed.map((coin) => {
    const instance = state.coins[Number(coin)];
    if (instance === undefined) return [];
    const elements = effectiveElements(instance, db);
    const def = db.coins[String(instance.defId)];
    return skill.treatPreservedBasicAsElement !== undefined && instance.preserved === true && def?.element === null
      ? [...new Set([...elements, skill.treatPreservedBasicAsElement])]
      : elements;
  });
  const usedPreservedCold = placed.some((coin, index) => state.coins[Number(coin)]?.preserved === true && coinElements[index]?.includes('frost') === true);
  if (
    skill.tags.includes('attack') &&
    !state.player.overheat &&
    !state.player.residualHeatUsed &&
    passiveMechanics.has('residualHeat') &&
    coinElements.some((elements) => elements.includes('fire'))
  ) {
    state = scheduleOverheat(state, events);
    state = { ...state, player: { ...state.player, residualHeatUsed: true } };
  }
  const applyResolution = (
    resolutionFaces: Face[],
    resolutionElements: readonly (readonly Element[])[],
    isReuse: boolean,
    includeBase = true,
    resolutionCoins: readonly CoinUid[] = placed,
    effectSkill: FlipSkillDef = skill,
    resolutionTarget: TargetRef = skillTarget
  ): boolean => {
    const tailsCount = resolutionFaces.filter((face) => face === 'tails').length;
    const headsCount = resolutionFaces.length - tailsCount;
    const resolutionSkill = includeBase ? effectSkill : { ...effectSkill, base: [] };
    let effects = collectEffects(resolutionSkill, resolutionFaces, resolutionElements, includeBase && input.player.overheat)
      .map((atom) => scaleSkillAuthoredEffect(atom, effectMultiplier));
    if (includeBase && !isReuse && usedPreserved) {
      effects.push(...(effectSkill.preservedBonus ?? []).map((atom) => scaleSkillAuthoredEffect(atom, effectMultiplier)));
    }
    if (includeBase && !isReuse && usedPreserved && !state.player.maturedHandUsedThisTurn && passiveMechanics.has('maturedHand')) {
      effects = applyMaturedHandBonus(effects);
      state = { ...state, player: { ...state.player, maturedHandUsedThisTurn: true } };
    }
    if (includeBase && !isReuse && usedPreservedCold && !state.player.coldHandsUsedThisTurn && passiveMechanics.has('coldHands')) {
      const coldTarget = currentEnemyTargetForPassive(state, resolutionTarget);
      if (coldTarget !== undefined) {
        state = applyEffectAtom(state, { kind: 'applyStatus', status: 'frostbite', stacks: 1, to: 'target' }, coldTarget, db, events);
      }
      state = { ...state, player: { ...state.player, coldHandsUsedThisTurn: true } };
    }
    if (
      includeBase &&
      skill.tags.includes('attack') &&
      resolutionTarget.type === 'enemy' &&
      statusTurns(state.enemies[resolutionTarget.index]?.statuses ?? {}, 'frostbite') > 0 &&
      !state.player.frostCompoundUsedThisTurn &&
      passiveMechanics.has('frostCompound')
    ) {
      effects = applyPrimaryDamageBonus(effects, 3);
      state = { ...state, player: { ...state.player, frostCompoundUsedThisTurn: true } };
    }
    const sawHeads = state.player.headsSeenThisTurn || resolutionFaces.includes('heads');
    const sawTails = state.player.tailsSeenThisTurn || resolutionFaces.includes('tails');
    if (includeBase && resolutionFaces.includes('tails') && !state.player.smallChangeInsuranceUsed && passiveMechanics.has('smallChangeInsurance')) {
      effects.push({ kind: 'block', amount: 2 });
      state = { ...state, player: { ...state.player, smallChangeInsuranceUsed: true } };
    }
    if (includeBase && !isReuse && sawHeads && sawTails && !state.player.doubleEntryUsedThisTurn && passiveMechanics.has('doubleEntry')) {
      const basic = Object.values(db.coins).find((coin) => coin.element === null)?.id;
      if (basic !== undefined) effects.push({ kind: 'drawSpecific', coins: [basic], count: 1 });
      state = { ...state, player: { ...state.player, doubleEntryUsedThisTurn: true } };
    }
    if (includeBase) state = { ...state, player: { ...state.player, headsSeenThisTurn: sawHeads, tailsSeenThisTurn: sawTails } };
    if (includeBase && skill.tags.includes('attack') && state.player.nextAttackDamageBonus > 0) {
      const primaryDamage = effects.find((atom) => atom.kind === 'damage');
      if (primaryDamage !== undefined && primaryDamage.kind === 'damage') {
        primaryDamage.amount += state.player.nextAttackDamageBonus;
      } else {
        effects.push({ kind: 'damage', amount: state.player.nextAttackDamageBonus });
      }
      state = { ...state, player: { ...state.player, nextAttackDamageBonus: 0 } };
    }
    if (
      includeBase &&
      skill.tags.includes('defense') &&
      passiveMechanics.has('shieldMastery') &&
      !state.player.shieldMasteryUsedThisTurn &&
      effects.some((atom) => atom.kind === 'block')
    ) {
      effects.push({ kind: 'block', amount: 1 });
      state = { ...state, player: { ...state.player, shieldMasteryUsedThisTurn: true } };
    }
    if (includeBase && tailsCount >= 2 && !state.player.inverseGuardUsedThisTurn && passiveMechanics.has('inverseGuard')) {
      effects.push({ kind: 'block', amount: 3 });
      state = { ...state, player: { ...state.player, inverseGuardUsedThisTurn: true } };
    }
    if (includeBase && !isReuse && tailsCount > 0 && headsCount > 0 && !state.player.crossCalculationUsedThisTurn && passiveMechanics.has('crossCalculation')) {
      const basic = Object.values(db.coins).find((coin) => coin.element === null)?.id;
      if (basic !== undefined) effects.push({ kind: 'addCoin', coin: basic, zone: 'hand', count: 1 });
      state = { ...state, player: { ...state.player, crossCalculationUsedThisTurn: true } };
    }
    if (includeBase && skill.tags.includes('attack') && passiveMechanics.has('emberBlade')) {
      const fireTails = resolutionFaces.reduce(
        (count, face, index) => count + (face === 'tails' && (resolutionElements[index] ?? []).includes('fire') ? 1 : 0),
        0
      );
      for (let i = 0; i < fireTails; i += 1) effects.push({ kind: 'applyStatus', status: 'burn', stacks: 1, to: 'target' });
    }
    if (includeBase && passiveMechanics.has('manaMembrane')) {
      const manaTails = resolutionFaces.reduce(
        (count, face, index) => count + (face === 'tails' && (resolutionElements[index] ?? []).includes('mana') ? 1 : 0),
        0
      );
      const available = Math.max(0, 3 - state.player.manaMembraneBlockThisTurn);
      const gained = Math.min(available, manaTails);
      if (gained > 0) {
        effects.push({ kind: 'block', amount: gained });
        state = { ...state, player: { ...state.player, manaMembraneBlockThisTurn: state.player.manaMembraneBlockThisTurn + gained } };
      }
    }
    if (includeBase && !isReuse && input.zones.hand.length === 0 && !state.player.lastMoveUsed && passiveMechanics.has('lastMove')) {
      if (effects.some((atom) => atom.kind === 'damage')) effects.push({ kind: 'damage', amount: 2 });
      if (effects.some((atom) => atom.kind === 'block')) effects.push({ kind: 'block', amount: 2 });
      state = { ...state, player: { ...state.player, lastMoveUsed: true } };
    }
    if (resolutionFaces.includes('heads') && resolutionFaces.includes('tails') && !state.player.balanceSenseUsed && passiveMechanics.has('balanceSense')) {
      effects.push({ kind: 'block', amount: 3 });
      state = { ...state, player: { ...state.player, balanceSenseUsed: true } };
    }
    if (
      isReuse &&
      skill.tags.includes('attack') &&
      !state.player.overcurrentUsed &&
      passiveMechanics.has('overcurrent')
    ) {
      effects.push({ kind: 'damage', amount: 2 }, { kind: 'applyStatus', status: 'shock', stacks: 1, to: 'target' });
      state = { ...state, player: { ...state.player, overcurrentUsed: true } };
    }
    for (const atom of effects) {
      for (const effectTarget of targetsForSkillEffect(state, atom, skill, resolutionTarget)) {
        state = applyEffectAtom(state, atom, effectTarget, db, events, chosen, {
          turnTriggerScope,
          tailsCount,
          headsCount,
          isReuse,
          chosenEquipment: summonChoice?.chosenEquipment,
          chosenSummon: summonChoice?.chosenSummon,
          desiredCoin: summonChoice?.desiredCoin,
          sourceSlot: slot,
          sourceSkill: skill.id
        });
        if (state.phase === 'victory' || state.phase === 'defeat') return false;
      }
    }
    for (let i = 0; i < resolutionFaces.length; i += 1) {
      const coin = state.coins[Number(resolutionCoins[i])];
      const face = resolutionFaces[i];
      if (coin === undefined || face === undefined) continue;
      const baseCoinDef = db.coins[String(coin.defId)];
      const procDefs = [
        baseCoinDef,
        ...effectiveElements(coin, db).flatMap((element) => Object.values(db.coins).filter((def) => def.element === element))
      ];
      const seenProcDefs = new Set<string>();
      for (const coinDef of procDefs) {
        if (coinDef === undefined || seenProcDefs.has(String(coinDef.id))) continue;
        seenProcDefs.add(String(coinDef.id));
        const atoms = face === 'heads' ? coinDef.procs?.heads : coinDef.procs?.tails;
        const concentrated =
          coinDef.element === 'blood' &&
          baseCoinDef?.element === 'blood' &&
          !state.player.concentratedBloodUsedThisTurn &&
          passiveMechanics.has('concentratedBlood');
        const hpLoss = (atoms ?? []).reduce((total, atom) => total + (atom.kind === 'loseHp' ? atom.amount : 0), 0);
        if (hpLoss > 0 && state.player.hp <= hpLoss) {
          events.push({ type: 'bloodCoinFizzle', coin: resolutionCoins[i]! });
          if (concentrated) {
            state = {
              ...state,
              player: { ...state.player, concentratedBloodUsedThisTurn: true }
            };
          }
          continue;
        }
        for (const atom of atoms ?? []) {
          const procAtom: EffectAtom =
            concentrated && atom.kind === 'heal'
              ? { ...atom, amount: atom.amount + 1 }
              : concentrated && atom.kind === 'block'
                ? { ...atom, amount: atom.amount + 1 }
                : concentrated && atom.kind === 'coinDamage'
                  ? { ...atom, amount: atom.amount + 1 }
                : atom;
          for (const procTarget of targetsForElementProc(state, procAtom, skill, resolutionTarget, target)) {
            state = applyEffectAtom(state, procAtom, procTarget, db, events, undefined, { turnTriggerScope, isReuse });
            if (state.phase === 'victory' || state.phase === 'defeat') return false;
          }
        }
        if (concentrated)
          state = {
            ...state,
            player: { ...state.player, concentratedBloodUsedThisTurn: true }
          };
      }
    }
    const resolvedResonance = resonanceEffects(effectSkill, resolutionFaces, resolutionElements)
      .map((atom) => scaleSkillAuthoredEffect(atom, effectMultiplier));
    if (resolvedResonance.length > 0 && effectSkill.resonance !== undefined) {
      events.push({ type: 'resonanceTriggered', skill: effectSkill.id, element: effectSkill.resonance.element });
    }
    for (const atom of resolvedResonance) {
      for (const effectTarget of targetsForSkillEffect(state, atom, skill, resolutionTarget)) {
        state = applyEffectAtom(state, atom, effectTarget, db, events, chosen, {
          turnTriggerScope,
          tailsCount,
          headsCount,
          isReuse,
          sourceSlot: slot,
          sourceSkill: skill.id
        });
        if (state.phase === 'victory' || state.phase === 'defeat') return false;
      }
    }
    if (effectSkill.tags.includes('attack') && isSuccessLadderFlipSkill(effectSkill)) {
      for (let index = 0; index < resolutionFaces.length; index += 1) {
        if (resolutionFaces[index] !== effectSkill.successFace) continue;
        const coinUid = resolutionCoins[index];
        if (coinUid === undefined) continue;
        const coin = state.coins[Number(coinUid)];
        if (coin?.permanent !== true || coin.enchant !== 'sharpness') continue;
        events.push({
          type: 'enchantTriggered',
          coin: coinUid,
          enchant: coin.enchant!,
          effect: 'damage',
        });
        const atom: EffectAtom = { kind: 'coinDamage', amount: 1 };
        for (const damageTarget of targetsForElementProc(state, atom, skill, resolutionTarget, target)) {
          state = applyEffectAtom(state, atom, damageTarget, db, events);
          if (state.phase === 'victory' || state.phase === 'defeat') return false;
        }
      }
    }
    return true;
  };

  const character = db.characters[String(input.characterId)];
  const canRemise = character?.trait.mechanic === 'remise' && input.player.remiseCharges > 0 && skill.tags.includes('attack') && placed.length > 0;
  const fireAttackResolved = (targetRef: TargetRef): void => {
    if (state.phase !== 'victory' && state.phase !== 'defeat' && skill.tags.includes('attack')) {
      state = { ...state, player: { ...state.player, attackSkillUsedThisTurn: true } };
      if (targetRef.type === 'enemy') state = wearProtectionForAttack(state, targetRef.index, events);
      state = fireTurnTriggers(state, 'onAttackSkillResolved', targetRef, db, events, turnTriggerScope);
    }
  };

  const shouldRepeat = canRemise && faces[0] === 'heads';
  if (canRemise) {
    state = { ...state, player: { ...state.player, remiseCharges: Math.max(0, state.player.remiseCharges - 1) } };
    events.push({ type: 'remiseSpent', skill: skill.id, firstFace: faces[0]!, repeat: shouldRepeat, remaining: state.player.remiseCharges });
  }
  if (!applyResolution(faces, coinElements, false)) return finish(state);
  fireAttackResolved(skillTarget);

  if (shouldRepeat && state.phase !== 'victory' && state.phase !== 'defeat') {
    const repeatTarget = repeatTargetForSkill(state, skill, skillTarget);
    if (repeatTarget === undefined) return finish(state);
    const reuseFaces = placed.map((coin) => {
      const rolled = rollEnchantedFace(
        state,
        coin,
        rng,
        isSuccessLadderFlipSkill(skill) ? skill.successFace : undefined,
        events,
      );
      state = rolled.state;
      events.push({ type: 'coinFlipped', coin, face: rolled.face });
      return rolled.face;
    });
    state = { ...state, rng: { ...state.rng, flip: rng.snapshot() } };
    const repeatSkill: FlipSkillDef = {
      ...skill,
      base: (skill.base ?? []).filter(isRemiseRepeatAtom),
      heads: skill.heads === undefined ? undefined : { ...skill.heads, effects: skill.heads.effects.filter(isRemiseRepeatAtom) },
      tails: skill.tails === undefined ? undefined : { ...skill.tails, effects: skill.tails.effects.filter(isRemiseRepeatAtom) },
      mixed: skill.mixed === undefined ? undefined : { effects: skill.mixed.effects.filter(isRemiseRepeatAtom) },
      overheatBonus: undefined,
      preservedBonus: []
    };
    const repeatContinues = applyResolution(reuseFaces, coinElements, true, true, placed, repeatSkill, repeatTarget);
    fireAttackResolved(repeatTarget);
    if (repeatContinues) {
      for (const atom of (skill.remise?.onRepeatFinish ?? []).map((candidate) => scaleSkillAuthoredEffect(candidate, effectMultiplier))) {
        for (const effectTarget of targetsForSkillEffect(state, atom, skill, repeatTarget)) {
          state = applyEffectAtom(state, atom, effectTarget, db, events, chosen, {
            turnTriggerScope,
            isReuse: true,
            sourceSlot: slot
          });
          if (state.phase === 'victory' || state.phase === 'defeat') break;
        }
        if (state.phase === 'victory' || state.phase === 'defeat') break;
      }
    }
    events.push({ type: 'remiseRepeatResolved', skill: skill.id });
    if (!repeatContinues) return finish(state);
    if (!state.player.retrievalHabitUsed && passiveMechanics.has('retrievalHabit')) retrievalCoin = placed[0];
    if (!state.player.continuousMotionUsed && passiveMechanics.has('continuousMotion')) {
      const drawn = drawCards(state, 1);
      state = { ...drawn.state, player: { ...drawn.state.player, continuousMotionUsed: true } };
      events.push(...drawn.events);
    }
  }

  state = applyBloodSwordSkillResolved(state, skill, aliveBefore, db, events);
  state = checkCombatEnd(state, events);
  return finish(state);
};
