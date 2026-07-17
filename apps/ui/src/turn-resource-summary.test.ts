import { contentDb } from "@game/content";
import type { CoinUid, CombatState, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it } from "vitest";

import { executionQueueSnapshot, type ExecutionSlotLoad } from "./auto-turn-end";
import { summarizeTurnResources } from "./turn-resource-summary";

const slot = (value: number): SlotId => value as SlotId;

const place = (state: CombatState, coin: CoinUid, target: SlotId): CombatState => {
  const result = step(state, { type: "placeCoin", coin, slot: target }, contentDb);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

describe("turn resource summary", () => {
  it("separates queued coins from coins that will remain for end-turn discard", () => {
    const initial = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "turn-summary",
    );
    const first = initial.zones.hand[0];
    const second = initial.zones.hand[1];
    if (first === undefined || second === undefined) throw new Error("missing test coins");

    const state = place(place(initial, first, slot(0)), second, slot(2));
    const loads: ExecutionSlotLoad[] = [
      { slot: slot(0), loadedCount: 1, requiredCount: 1, queueable: true },
      { slot: slot(2), loadedCount: 1, requiredCount: 2, queueable: true },
    ];
    const queue = executionQueueSnapshot([], loads);

    expect(summarizeTurnResources(state, queue)).toEqual({
      usable: 1,
      loaded: 2,
      queued: 1,
      discardedOnEnd: 2,
    });
  });

  it("does not count explicitly preserved coins as discarded", () => {
    const state = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "turn-summary-preserve",
    );
    const preserved = state.zones.hand[0];
    if (preserved === undefined) throw new Error("missing preserved coin");

    expect(
      summarizeTurnResources(state, executionQueueSnapshot([], []), [preserved]),
    ).toEqual({
      usable: state.zones.hand.length,
      loaded: 0,
      queued: 0,
      discardedOnEnd: state.zones.hand.length - 1,
    });
  });

  it("excludes already-preserved coins in both hand and placed zones", () => {
    const initial = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "turn-summary-preserved-state",
    );
    const preservedInHand = initial.zones.hand[0];
    const preservedPlaced = initial.zones.hand[1];
    if (preservedInHand === undefined || preservedPlaced === undefined) {
      throw new Error("missing preserved test coins");
    }
    const placed = place(initial, preservedPlaced, slot(2));
    const state: CombatState = {
      ...placed,
      coins: {
        ...placed.coins,
        [Number(preservedInHand)]: {
          ...placed.coins[Number(preservedInHand)]!,
          preserved: true,
        },
        [Number(preservedPlaced)]: {
          ...placed.coins[Number(preservedPlaced)]!,
          preserved: true,
        },
      },
    };

    const summary = summarizeTurnResources(
      state,
      executionQueueSnapshot([], []),
    );
    expect(summary).toEqual({
      usable: state.zones.hand.length,
      loaded: 1,
      queued: 0,
      discardedOnEnd: state.zones.hand.length - 1,
    });

    const ended = step(state, { type: "endTurn" }, contentDb);
    if (!ended.ok) throw new Error(ended.error);
    const discarded = ended.events.find(
      (event) => event.type === "coinsDiscarded",
    );
    expect(discarded?.coins).not.toContain(preservedInHand);
    expect(discarded?.coins).not.toContain(preservedPlaced);
    expect(discarded?.coins).toHaveLength(summary.discardedOnEnd);
  });

  it("deduplicates stale queue entries and never returns negative counts", () => {
    const state = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "turn-summary-stale",
    );
    const staleQueue = executionQueueSnapshot([slot(0)], [
      { slot: slot(0), loadedCount: 1, requiredCount: 1, queueable: true },
    ]);

    expect(summarizeTurnResources(state, staleQueue)).toMatchObject({
      loaded: 0,
      queued: 0,
      discardedOnEnd: state.zones.hand.length,
    });
  });
});
