import type { CoinUid, CombatState } from "@game/core";

import type { ExecutionQueueSnapshot } from "./auto-turn-end";

export interface TurnResourceSummary {
  /** Coins that can still be placed or consumed from the hand. */
  usable: number;
  /** All coins physically placed in skill sockets. */
  loaded: number;
  /** Placed coins that belong to fully loaded skills in the execution queue. */
  queued: number;
  /**
   * Current-zone estimate after queued coins and known preserved coins are
   * removed. This does not simulate future flips, generated coins, or effects.
   */
  discardedOnEnd: number;
}

const uniqueCoins = (coins: readonly CoinUid[]): CoinUid[] => [
  ...new Set(coins),
];

export const summarizeTurnResources = (
  state: CombatState,
  queue: Pick<ExecutionQueueSnapshot, "loaded">,
  preserve: readonly CoinUid[] = [],
): TurnResourceSummary => {
  const hand = uniqueCoins(state.zones.hand);
  const placed = uniqueCoins(Object.values(state.zones.placed).flat());
  const queuedSlots = new Set(queue.loaded.map((entry) => Number(entry.slot)));
  const queued = uniqueCoins(
    Object.entries(state.zones.placed).flatMap(([rawSlot, coins]) =>
      queuedSlots.has(Number(rawSlot)) ? coins : [],
    ),
  );
  const queuedCoins = new Set(queued);
  const endTurnCandidates = uniqueCoins([...hand, ...placed]);
  const preservedCoins = new Set([
    ...preserve,
    ...endTurnCandidates.filter(
      (coin) => state.coins[Number(coin)]?.preserved === true,
    ),
  ]);
  const discardedOnEnd = endTurnCandidates.filter(
    (coin) => !queuedCoins.has(coin) && !preservedCoins.has(coin),
  ).length;

  return {
    usable: hand.length,
    loaded: placed.length,
    queued: queued.length,
    discardedOnEnd: Math.max(0, discardedOnEnd),
  };
};
