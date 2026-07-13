import { contentDb } from "@game/content";
import type { CoinUid, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  PRESERVE_SELECTION_INSTRUCTIONS,
  beginPreserveSelection,
  preserveSelectionCommand,
  togglePreservedCoin,
} from "./preserve-selection";

const slot = (value: number) => value as SlotId;

describe("turn-end preserve selection", () => {
  it("exposes the keyboard contract and includes hand plus placed candidates", () => {
    let state = createCombat(
      { character: "frost-knight" as never, enemies: ["raider" as never] },
      contentDb,
      "preserve-ui-candidates",
    );
    const placedCoin = state.zones.hand[0]!;
    const placed = step(
      state,
      { type: "placeCoin", coin: placedCoin, slot: slot(0) },
      contentDb,
    );
    if (!placed.ok) throw new Error(placed.error);
    state = placed.state;
    const selection = beginPreserveSelection(state, contentDb);
    expect(selection?.candidates).toEqual([
      ...state.zones.hand,
      placedCoin,
    ]);
    expect(PRESERVE_SELECTION_INSTRUCTIONS).toContain("Enter");
    expect(PRESERVE_SELECTION_INSTRUCTIONS).toContain("Escape");
  });

  it("toggles up to the legal new capacity and keeps prior preserved coins locked", () => {
    const base = createCombat(
      { character: "frost-knight" as never, enemies: ["raider" as never] },
      contentDb,
      "preserve-ui-capacity",
    );
    const oldCoin = base.zones.hand[0]!;
    const state = {
      ...base,
      player: { ...base.player, additionalPreserveThisTurn: 2 },
      coins: {
        ...base.coins,
        [Number(oldCoin)]: { ...base.coins[Number(oldCoin)]!, preserved: true },
      },
    };
    const initial = beginPreserveSelection(state, contentDb)!;
    expect(initial.coins).toEqual([oldCoin]);
    expect(togglePreservedCoin(initial, oldCoin)).toBe(initial);
    const selected = state.zones.hand
      .slice(1, 4)
      .reduce(togglePreservedCoin, initial);
    expect(selected.coins).toHaveLength(3);
    expect(selected.coins).toContain(oldCoin);
  });

  it("builds an explicit command accepted by the core instead of using auto-preserve", () => {
    const state = createCombat(
      { character: "frost-knight" as never, enemies: ["raider" as never] },
      contentDb,
      "preserve-ui-command",
    );
    const chosen = state.zones.hand.at(-1) as CoinUid;
    const selection = togglePreservedCoin(
      beginPreserveSelection(state, contentDb)!,
      chosen,
    );
    const command = preserveSelectionCommand(selection);
    const result = step(state, command, contentDb);
    expect(command).toEqual({ type: "endTurn", preserve: [chosen] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.zones.hand).toContain(chosen);
    expect(result.state.coins[Number(chosen)]?.preserved).toBe(true);
  });

  it("does not open a picker when three or more candidates are already preserved", () => {
    const base = createCombat(
      { character: "frost-knight" as never, enemies: ["raider" as never] },
      contentDb,
      "preserve-ui-full",
    );
    const withLocked = (count: number) => ({
      ...base,
      player: { ...base.player, additionalPreserveThisTurn: 2 },
      coins: Object.fromEntries(
        Object.entries(base.coins).map(([key, value]) => [
          key,
          {
            ...value,
            preserved: base.zones.hand.slice(0, count).includes(value.uid),
          },
        ]),
      ),
    });

    expect(beginPreserveSelection(withLocked(3), contentDb)).toBeNull();
    expect(beginPreserveSelection(withLocked(4), contentDb)).toBeNull();
  });
});
