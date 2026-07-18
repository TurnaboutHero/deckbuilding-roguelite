import { effectiveElements } from '../content-types';
import type { ContentDb, EnemyDef } from '../content-types';
import type { CoinUid, Element, SlotId } from '../ids';
import { coinSatisfiesFlipRequirement, isSlotUsableNow } from './commands';
import { consumeRequirementFor } from './consume-requirement';
import type { CombatEvent } from './events';
import { aggregateSkillSeal, skillSealOwners } from './state';
import type { CombatState, EnemyState } from './state';
import { returnOldestRoyalVaultCoin, weakenLeadDecreeForSkill, weakenLeadDecreeForSkillDamage } from './directive18';

const PUBLIC_ELEMENT_ORDER: readonly Element[] = ['fire', 'mana', 'frost', 'lightning', 'blood'];

const withEnemy = (state: CombatState, enemyIndex: number, update: (enemy: EnemyState) => EnemyState): CombatState => ({
  ...state,
  enemies: state.enemies.map((enemy, index) => (index === enemyIndex ? update(enemy) : enemy))
});

const isCounterfeit = (state: CombatState, coin: CoinUid): boolean => state.coins[Number(coin)]?.counterfeit === true;

const sealSlot = (state: CombatState, enemyIndex: number, slot: SlotId, turns: number, events: CombatEvent[]): CombatState => {
  const existing = state.player.skillSeals[Number(slot)];
  const owners = existing === undefined ? [] : skillSealOwners(existing);
  if (owners.some((owner) => owner.sourceEnemy === enemyIndex && owner.turns > 0)) return state;
  const seal = aggregateSkillSeal([...owners, { sourceEnemy: enemyIndex, turns }]);
  if (seal === undefined) return state;
  events.push({ type: 'skillSealed', sourceEnemy: enemyIndex, slot, turns });
  return { ...state, player: { ...state.player, skillSeals: { ...state.player.skillSeals, [Number(slot)]: seal } } };
};

const usableSlots = (state: CombatState, db: ContentDb): SlotId[] =>
  state.slots.flatMap((_, index) => isSlotUsableNow(state, db, index as SlotId) ? [index as SlotId] : []);

const sameElementSkillCanSpendTax = (state: CombatState, db: ContentDb, slot: SlotId, element: Element, denomination: number): boolean => {
  const skill = db.skills[String(state.slots[Number(slot)]?.skillId)];
  if (skill === undefined) return false;
  if (skill.type === 'consume') {
    if (skill.consume.element !== element) return false;
    const matchingHand = state.zones.hand.filter((coin) => {
      const instance = state.coins[Number(coin)];
      const def = instance === undefined ? undefined : db.coins[String(instance.defId)];
      return !isCounterfeit(state, coin) && instance !== undefined &&
        (element === 'frost' ? def?.element === 'frost' : effectiveElements(instance, db).includes(element));
    });
    const requirement = consumeRequirementFor(state, skill);
    return requirement.mode === 'exact'
      ? requirement.min === denomination
      : requirement.mode === 'upTo'
        ? requirement.min <= denomination && denomination <= requirement.max && matchingHand.length >= denomination
        : matchingHand.length === denomination && requirement.min <= denomination;
  }
  const matchingHand = state.zones.hand.filter((coin) =>
    !isCounterfeit(state, coin) && effectiveElements(state.coins[Number(coin)]!, db).includes(element)
  );
  return (
    skill.element === element &&
    skill.cost === denomination &&
    matchingHand.filter((coin) => coinSatisfiesFlipRequirement(state, db, skill, coin)).length >= denomination
  );
};

/** Pure, deterministic selector used by tax previews and property tests. */
export const royalTaxPayableElement = (state: CombatState, db: ContentDb, enemy: EnemyDef): Element | undefined => {
  const tax = enemy.royalTax;
  if (tax === undefined) return undefined;
  const usable = usableSlots(state, db);
  for (const element of PUBLIC_ELEMENT_ORDER) {
    const canSpend = usable.some((slot) => sameElementSkillCanSpendTax(state, db, slot, element, tax.denomination));
    if (canSpend) return element;
  }
  return undefined;
};

export const openRoyalTax = (state: CombatState, enemyIndex: number, db: ContentDb, events: CombatEvent[]): { state: CombatState; opened: boolean } => {
  const enemy = state.enemies[enemyIndex];
  const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
  const element = def === undefined ? undefined : royalTaxPayableElement(state, db, def);
  if (enemy === undefined || def?.royalTax === undefined || element === undefined) return { state, opened: false };
  const pending = { element, paid: 0, deadlineTurn: state.turn + 1 };
  events.push({ type: 'royalTaxOpened', sourceEnemy: enemyIndex, element, denomination: def.royalTax.denomination, deadlineTurn: pending.deadlineTurn });
  return { state: withEnemy(state, enemyIndex, (candidate) => ({ ...candidate, royalTaxPending: pending })), opened: true };
};

/** Called only after a flip/consume resolver has completed successfully. */
export const recordDirective15SkillResolution = (
  state: CombatState,
  preUseState: CombatState,
  slot: SlotId,
  spentCoins: readonly CoinUid[],
  db: ContentDb,
  events: CombatEvent[]
): CombatState => {
  const skillId = preUseState.slots[Number(slot)]?.skillId;
  if (skillId === null || skillId === undefined) return state;
  let next = state;
  for (let enemyIndex = 0; enemyIndex < next.enemies.length; enemyIndex += 1) {
    const enemy = next.enemies[enemyIndex];
    const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
    if (enemy === undefined || enemy.hp <= 0 || def === undefined) continue;
    const pressure = def.repeatSkillPressure;
    if (pressure !== undefined) {
      const previous = enemy.repeatSkillPressure;
      const currentlyUsable = usableSlots(preUseState, db);
      const onlyUsableSlot = currentlyUsable.length === 1 && currentlyUsable[0] === slot;
      const sameSkill = previous?.lastSkillId === skillId;
      const singleUsableResolvedUses = onlyUsableSlot
        ? (sameSkill ? (previous?.singleUsableResolvedUses ?? 0) + 1 : 1)
        : 0;
      const gainsZeal = !onlyUsableSlot || singleUsableResolvedUses % pressure.singleUsableZealEveryUses === 0;
      const zeal = previous?.lastSkillId !== undefined && !sameSkill
        ? pressure.differentSkillReset
        : gainsZeal
          ? Math.min(pressure.maxZeal, (previous?.zeal ?? 0) + pressure.sameSkillGain)
          : (previous?.zeal ?? 0);
      next = withEnemy(next, enemyIndex, (candidate) => ({
        ...candidate,
        repeatSkillPressure: { lastSkillId: skillId, triggeringSlot: slot, zeal, singleUsableResolvedUses }
      }));
      events.push({ type: 'repeatSkillZealChanged', sourceEnemy: enemyIndex, skill: skillId, zeal, maxZeal: pressure.maxZeal });
    }
    const pending = next.enemies[enemyIndex]?.royalTaxPending;
    if (pending !== undefined) {
      const resolvedSkill = db.skills[String(preUseState.slots[Number(slot)]?.skillId)];
      const isMatchingElementSkill = resolvedSkill !== undefined && (resolvedSkill.type === 'consume' ? resolvedSkill.consume.element : resolvedSkill.element) === pending.element;
      const paidNow = isMatchingElementSkill
        ? spentCoins.filter((coin) => !isCounterfeit(preUseState, coin) && effectiveElements(preUseState.coins[Number(coin)]!, db).includes(pending.element)).length
        : 0;
      if (paidNow > 0) {
        const denomination = def.royalTax?.denomination ?? 0;
        const paid = Math.min(denomination, pending.paid + paidNow);
        if (paid >= denomination) {
          next = withEnemy(next, enemyIndex, (candidate) => ({ ...candidate, royalTaxPending: undefined, royalTaxDefaultStreak: 0, royalTaxPaidAttackReduction: def.royalTax?.paidNextOrdinaryAttackReduction }));
          events.push({ type: 'royalTaxPaid', sourceEnemy: enemyIndex, element: pending.element, paid, denomination });
        } else {
          next = withEnemy(next, enemyIndex, (candidate) => ({ ...candidate, royalTaxPending: { ...pending, paid } }));
          events.push({ type: 'royalTaxPaymentProgressed', sourceEnemy: enemyIndex, element: pending.element, paid, denomination });
        }
      }
    }
    const vault = def.royalVault;
    if (vault !== undefined) {
      const matching = spentCoins.find((coin) => {
        const instance = preUseState.coins[Number(coin)];
        if (instance === undefined || instance.counterfeit === true || instance.lead === true) return false;
        return next.custody.some((entry) => entry.kind === 'royalVault' && entry.sourceEnemyUid === enemy.enemyUid && entry.element !== undefined && effectiveElements(instance, db).includes(entry.element));
      });
      if (matching !== undefined) {
        const element = effectiveElements(preUseState.coins[Number(matching)]!, db).find((candidate) =>
          next.custody.some((entry) => entry.kind === 'royalVault' && entry.sourceEnemyUid === enemy.enemyUid && entry.element === candidate)
        );
        const before = next;
        next = returnOldestRoyalVaultCoin(next, enemyIndex, events, 'skillRecovery', element);
        if (next !== before) {
          const reduction = vault.blockLostPerRecovery ?? 0;
          if (reduction > 0) next = withEnemy(next, enemyIndex, (candidate) => ({ ...candidate, block: Math.max(0, candidate.block - reduction) }));
          if (next.enemies[enemyIndex]?.windup !== undefined) {
            next = withEnemy(next, enemyIndex, (candidate) => ({ ...candidate, royalVaultRecoveredThisWindup: (candidate.royalVaultRecoveredThisWindup ?? 0) + 1 }));
          }
        }
      }
      next = weakenLeadDecreeForSkill(next, enemyIndex, spentCoins, db, events);
      const skillDamage = events.reduce((total, event) =>
        event.type === 'damageDealt' && event.source === 'skill' && event.target.type === 'enemy' && event.target.index === enemyIndex
          ? total + event.amount
          : total,
      0);
      if (skillDamage > 0) next = weakenLeadDecreeForSkillDamage(next, enemyIndex, skillDamage, db, events);
    }
  }
  return next;
};

export const resetRepeatSkillPressure = (state: CombatState, enemyIndex: number, events: CombatEvent[]): CombatState => {
  const pressure = state.enemies[enemyIndex]?.repeatSkillPressure;
  if (pressure === undefined || pressure.zeal === 0) return withEnemy(state, enemyIndex, (enemy) => ({ ...enemy, repeatSkillPressure: undefined }));
  events.push({ type: 'repeatSkillZealReset', sourceEnemy: enemyIndex });
  return withEnemy(state, enemyIndex, (enemy) => ({ ...enemy, repeatSkillPressure: undefined }));
};

export const sealTriggeredSkill = (state: CombatState, enemyIndex: number, turns: number, events: CombatEvent[]): CombatState => {
  const slot = state.enemies[enemyIndex]?.repeatSkillPressure?.triggeringSlot;
  return slot === undefined ? state : sealSlot(state, enemyIndex, slot, turns, events);
};

export const resolveRoyalTaxDeadlines = (input: CombatState, db: ContentDb, events: CombatEvent[]): CombatState => {
  let state = input;
  for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
    const enemy = state.enemies[enemyIndex];
    const def = enemy === undefined ? undefined : db.enemies[String(enemy.defId)];
    const pending = enemy?.royalTaxPending;
    if (enemy === undefined || enemy.hp <= 0 || def?.royalTax === undefined || pending === undefined || pending.deadlineTurn > state.turn) continue;
    const tax = def.royalTax;
    const firstUid = state.nextUid;
    const added = Array.from({ length: tax.counterfeitCount }, (_, offset) => (firstUid + offset) as CoinUid);
    const coins = Object.fromEntries(added.map((uid) => [Number(uid), { uid, defId: tax.counterfeitCoin, grants: [], permanent: false as const, counterfeit: true }]));
    const defaultStreak = (enemy.royalTaxDefaultStreak ?? 0) + 1;
    const scheduleForeclosure = tax.foreclosureAfterDefaults !== undefined && tax.foreclosureIntent !== undefined && defaultStreak >= tax.foreclosureAfterDefaults;
    const scheduleSeizure = tax.foreclosureAfterDefaults === undefined && tax.seizureAfterDefaults !== undefined && defaultStreak >= tax.seizureAfterDefaults;
    events.push({ type: 'royalTaxDefaulted', sourceEnemy: enemyIndex, element: pending.element, paid: pending.paid, denomination: tax.denomination, counterfeits: added, shield: tax.defaultShield, defaultStreak });
    events.push({ type: 'blockGained', target: { type: 'enemy', index: enemyIndex }, amount: tax.defaultShield });
    state = {
      ...state,
      coins: { ...state.coins, ...coins },
      nextUid: firstUid + added.length,
      zones: { ...state.zones, draw: [...state.zones.draw, ...added] }
    };
    state = withEnemy(state, enemyIndex, (candidate) => ({
      ...candidate,
      block: candidate.block + tax.defaultShield,
      royalTaxPending: undefined,
      royalTaxDefaultStreak: (scheduleSeizure || scheduleForeclosure) ? 0 : defaultStreak,
      ...(scheduleForeclosure ? { royalTaxForeclosureElement: pending.element, intent: tax.foreclosureIntent, intentIndex: -1 } : {}),
      ...(scheduleSeizure ? { intent: tax.seizureIntent, intentIndex: -1 } : {})
    }));
    const scheduledIntent = scheduleForeclosure ? tax.foreclosureIntent : tax.seizureIntent;
    if ((scheduleSeizure || scheduleForeclosure) && scheduledIntent !== undefined) events.push({ type: 'royalTaxSeizureScheduled', sourceEnemy: enemyIndex, intent: scheduledIntent });
  }
  return state;
};

export const resetRoyalTaxDefaults = (state: CombatState, enemyIndex: number): CombatState =>
  withEnemy(state, enemyIndex, (enemy) => ({ ...enemy, royalTaxDefaultStreak: 0 }));
