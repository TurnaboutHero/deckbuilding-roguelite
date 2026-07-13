import type { CoinUid, CombatState, Command, ContentDb, SlotId } from "@game/core";
import { effectiveElements, legalCommands } from "@game/core";

export interface FuelSelection {
  slot: SlotId;
  coins: CoinUid[];
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
  return (
    skill !== null &&
    state.zones.hand.includes(coin) &&
    instance !== undefined &&
    effectiveElements(instance, db).includes(skill.consume.element)
  );
};

export function autoSuggestFuel(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): CoinUid[] {
  const skill = consumeSkill(state, slot, db);
  if (skill === null) return [];
  return state.zones.hand
    .filter((coin) => isFuelCoin(state, coin, slot, db))
    .sort((left, right) => {
      const leftGranted =
        state.coins[Number(left)]?.grants.includes(skill.consume.element) ===
        true;
      const rightGranted =
        state.coins[Number(right)]?.grants.includes(skill.consume.element) ===
        true;
      if (leftGranted === rightGranted) return 0;
      return leftGranted ? -1 : 1;
    })
    .slice(0, skill.consume.count);
}

export function requiresFuelSelection(
  state: CombatState,
  slot: SlotId,
  db: ContentDb,
): boolean {
  const skill = consumeSkill(state, slot, db);
  return skill !== null && skill.consume.count >= 2;
}

export function toggleFuel(
  selection: FuelSelection,
  coin: CoinUid,
  state: CombatState,
  db: ContentDb,
): FuelSelection {
  const skill = consumeSkill(state, selection.slot, db);
  if (skill === null || !isFuelCoin(state, coin, selection.slot, db))
    return selection;
  if (selection.coins.includes(coin)) {
    return {
      ...selection,
      coins: selection.coins.filter((selected) => selected !== coin),
    };
  }
  if (selection.coins.length >= skill.consume.count) return selection;
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
  if (skill === null || selection.coins.length !== skill.consume.count)
    return null;
  const coins = handOrder(state, selection.coins);
  if (
    coins.some((coin, index) => coins.indexOf(coin) !== index) ||
    coins.some((coin) => !isFuelCoin(state, coin, selection.slot, db))
  )
    return null;
  const command: Extract<Command, { type: "useConsumeSkill" }> = {
    type: "useConsumeSkill",
    slot: selection.slot,
    coins,
    target: skill.targetType === "single-enemy" ? 0 : undefined,
  };
  const hasLegalConsumeSlot = legalCommands(state, db).some(
    (candidate) =>
      candidate.type === "useConsumeSkill" &&
      candidate.slot === command.slot &&
      candidate.target === command.target,
  );
  return hasLegalConsumeSlot ? command : null;
}
