import type { CoinUid, CombatState, Command, ContentDb, SlotId } from "@game/core";
import { effectiveElements, legalCommands } from "@game/core";

export interface FuelSelection {
  slot: SlotId;
  coins: CoinUid[];
}

export interface FuelRequirement {
  mode: "exact" | "upTo" | "all";
  min: number;
  max: number;
  available: number;
}

const consumeSkill = (state: CombatState, slot: SlotId, db: ContentDb) => {
  const slotState = state.slots[Number(slot)];
  if (slotState === undefined) return null;
  const skill = db.skills[String(slotState.skillId)];
  return skill?.type === "consume" ? skill : null;
};

const handOrder = (state: CombatState, coins: readonly CoinUid[]): CoinUid[] =>
  [...coins].sort(
    (left, right) =>
      state.zones.hand.indexOf(left) - state.zones.hand.indexOf(right),
  );

const isFuelCoin = (
  state: CombatState,
  coin: CoinUid,
  slot: SlotId,
  db: ContentDb,
): boolean => {
  const skill = consumeSkill(state, slot, db);
  const instance = state.coins[Number(coin)];
  const definition =
    instance === undefined ? undefined : db.coins[String(instance.defId)];
  return (
    skill !== null &&
    state.zones.hand.includes(coin) &&
    instance !== undefined &&
    (skill.consume.element === "frost"
      ? definition?.element === "frost"
      : effectiveElements(instance, db).includes(skill.consume.element))
  );
};

const fuelCoins = (
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): CoinUid[] =>
  state.zones.hand.filter((coin) => isFuelCoin(state, coin, slot, db));

export function fuelRequirement(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): FuelRequirement | null {
  const skill = consumeSkill(state, slot, db);
  if (skill === null) return null;
  const available = fuelCoins(state, slot, db).length;
  if (skill.consume.mode === "upTo") {
    return { mode: "upTo", min: 1, max: skill.consume.count, available };
  }
  if (skill.consume.mode === "all") {
    return { mode: "all", min: skill.consume.count, max: available, available };
  }
  return {
    mode: "exact",
    min: skill.consume.count,
    max: skill.consume.count,
    available,
  };
}

export function autoSuggestFuel(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): CoinUid[] {
  const skill = consumeSkill(state, slot, db);
  if (skill === null) return [];
  const candidates = fuelCoins(state, slot, db)
    .sort((left, right) => {
      if (skill.consume.element === "frost") return 0;
      const leftGranted =
        state.coins[Number(left)]?.grants.includes(skill.consume.element) ===
        true;
      const rightGranted =
        state.coins[Number(right)]?.grants.includes(skill.consume.element) ===
        true;
      if (leftGranted === rightGranted) return 0;
      return leftGranted ? -1 : 1;
    });
  return skill.consume.mode === "all"
    ? candidates
    : candidates.slice(0, skill.consume.count);
}

export function requiresFuelSelection(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): boolean {
  const skill = consumeSkill(state, slot, db);
  const requirement = fuelRequirement(state, slot, db);
  return (
    skill !== null &&
    requirement !== null &&
    (skill.consume.mode !== undefined ||
      skill.consume.count >= 2 ||
      (skill.preservedBonus?.length ?? 0) > 0)
  );
}

export function toggleFuel(
  selection: FuelSelection,
  coin: CoinUid,
  state: CombatState,
  db: ContentDb,
): FuelSelection {
  const skill = consumeSkill(state, selection.slot, db);
  const requirement = fuelRequirement(state, selection.slot, db);
  if (skill === null || !isFuelCoin(state, coin, selection.slot, db))
    return selection;
  if (selection.coins.includes(coin)) {
    return {
      ...selection,
      coins: selection.coins.filter((selected) => selected !== coin),
    };
  }
  if (requirement === null || selection.coins.length >= requirement.max)
    return selection;
  return {
    ...selection,
    coins: handOrder(state, [...selection.coins, coin]),
  };
}

export function fuelCommand(
  selection: FuelSelection,
  state: CombatState,
  db: ContentDb,
): Extract<Command, { type: "useConsumeSkill" }> | null {
  const skill = consumeSkill(state, selection.slot, db);
  const requirement = fuelRequirement(state, selection.slot, db);
  if (skill === null || requirement === null) return null;
  if (
    selection.coins.length < requirement.min ||
    selection.coins.length > requirement.max ||
    (requirement.mode === "all" &&
      selection.coins.length !== requirement.available)
  ) return null;
  const coins = handOrder(state, selection.coins);
  if (
    coins.some((coin, index) => coins.indexOf(coin) !== index) ||
    coins.some((coin) => !isFuelCoin(state, coin, selection.slot, db))
  )
    return null;
  const legalConsume = legalCommands(state, db).find(
    (candidate) =>
      candidate.type === "useConsumeSkill" &&
      candidate.slot === selection.slot,
  );
  if (legalConsume?.type !== "useConsumeSkill") return null;
  return {
    type: "useConsumeSkill",
    slot: selection.slot,
    coins,
    target: legalConsume.target,
    desiredCoin: legalConsume.desiredCoin,
  };
}
