import type { CoinUid, SlotId } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  activateNextExecution,
  abandonPendingExecutions,
  beginAutoTurnEnd,
  blockActiveExecution,
  cancelAutoTurnEnd,
  completeActiveExecution,
  executionQueueSnapshot,
  finishAutoTurnEnd,
  moveExecutionSlot,
  pauseForExecutionChoice,
  reconcileExecutionOrder,
  resumeExecutionChoice,
  retryBlockedExecution,
  swapExecutionSlots,
  type ExecutionReservation,
} from "./auto-turn-end";

const slot = (value: number): SlotId => value as SlotId;
const coin = (value: number): CoinUid => value as CoinUid;

const reservation = (
  id: string,
  slotId: number,
  coinUids: number[],
): ExecutionReservation => ({
  id,
  slot: slot(slotId),
  coinUids: coinUids.map(coin),
});

describe("execution-order reconciliation", () => {
  it("uses reservation identity and retains first-ready observation order", () => {
    const initial = reconcileExecutionOrder([], [
      reservation("slot-2:a", 2, [20]),
      reservation("slot-0:a", 0, [10]),
    ]);
    expect(initial).toEqual(["slot-2:a", "slot-0:a"]);

    expect(
      reconcileExecutionOrder(initial, [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-2:a", 2, [20]),
        reservation("slot-1:a", 1, [11]),
      ]),
    ).toEqual(["slot-2:a", "slot-0:a", "slot-1:a"]);
  });

  it("removes absent reservations and appends a newly observed reservation", () => {
    const afterUnload = reconcileExecutionOrder(
      ["slot-0:a", "slot-1:a"],
      [reservation("slot-1:a", 1, [11])],
    );
    expect(afterUnload).toEqual(["slot-1:a"]);

    expect(
      reconcileExecutionOrder(afterUnload, [
        reservation("slot-0:b", 0, [12]),
        reservation("slot-1:a", 1, [11]),
      ]),
    ).toEqual(["slot-1:a", "slot-0:b"]);
  });

  it("allows multiple reservations from one slot and deduplicates reservation IDs", () => {
    expect(
      reconcileExecutionOrder(
        ["slot-1:a", "slot-1:b", "slot-0:draft"],
        [
          reservation("slot-1:a", 1, [2]),
          reservation("slot-1:b", 1, [3]),
          reservation("slot-1:b", 1, [3]),
        ],
      ),
    ).toEqual(["slot-1:a", "slot-1:b"]);
  });

  it("moves and swaps reservation IDs without changing slot display metadata", () => {
    const order = ["slot-0:a", "slot-0:b", "slot-2:a"];
    expect(moveExecutionSlot(order, "slot-2:a", 0)).toEqual([
      "slot-2:a",
      "slot-0:a",
      "slot-0:b",
    ]);
    expect(swapExecutionSlots(order, "slot-0:a", "slot-2:a")).toEqual([
      "slot-2:a",
      "slot-0:b",
      "slot-0:a",
    ]);
    expect(moveExecutionSlot(order, "missing", 0)).toEqual(order);
  });
});

describe("execution queue snapshots", () => {
  it("returns an ordered reservation view with slot display metadata", () => {
    const snapshot = executionQueueSnapshot(
      ["slot-2:a", "slot-0:a", "slot-2:a"],
      [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-2:a", 2, [12]),
        reservation("slot-2:b", 2, [13]),
      ],
    );

    expect(snapshot.order).toEqual(["slot-2:a", "slot-0:a", "slot-2:b"]);
    expect(snapshot.loaded.map((entry) => entry.id)).toEqual([
      "slot-2:a",
      "slot-0:a",
      "slot-2:b",
    ]);
    expect(snapshot.loaded.map((entry) => entry.slot)).toEqual([
      slot(2),
      slot(0),
      slot(2),
    ]);
  });

  it("excludes reservations that have no currently legal execution command", () => {
    const snapshot = executionQueueSnapshot(
      ["slot-0:illegal", "slot-1:legal"],
      [
        reservation("slot-0:illegal", 0, [10]),
        reservation("slot-1:legal", 1, [11]),
      ],
      ["slot-1:legal"],
    );

    expect(snapshot.order).toEqual(["slot-1:legal"]);
    expect(snapshot.loaded.map((entry) => entry.id)).toEqual(["slot-1:legal"]);
  });
});

describe("automatic turn-end workflow", () => {
  it("claims the next reservation idempotently and pauses/resumes for a choice", () => {
    const started = beginAutoTurnEnd("turn-7", [
      reservation("slot-2:a", 2, [20]),
      reservation("slot-0:a", 0, [10]),
    ]);
    const active = activateNextExecution(started);
    const duplicateEffect = activateNextExecution(active);

    expect(active.phase).toBe("running");
    expect(active.active).toEqual({
      reservationId: "slot-2:a",
      slot: slot(2),
      token: "turn-7:0:slot-2:a",
    });
    expect(duplicateEffect).toBe(active);

    const choosing = pauseForExecutionChoice(
      active,
      active.active?.token ?? "missing",
      "enemy-target",
    );
    expect(choosing.phase).toBe("choosing");
    expect(choosing.choice).toBe("enemy-target");
    expect(
      completeActiveExecution(choosing, choosing.active?.token ?? "missing"),
    ).toBe(choosing);
    expect(resumeExecutionChoice(choosing, "stale-token")).toBe(choosing);
    expect(
      resumeExecutionChoice(choosing, choosing.active?.token ?? "missing").phase,
    ).toBe("running");
  });

  it("ignores stale completions and finishes through preservation", () => {
    const firstActive = activateNextExecution(
      beginAutoTurnEnd("turn-3", [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-1:a", 1, [11]),
      ]),
    );
    expect(completeActiveExecution(firstActive, "stale-token")).toBe(
      firstActive,
    );

    const afterFirst = completeActiveExecution(
      firstActive,
      firstActive.active?.token ?? "missing",
    );
    expect(afterFirst.completed).toEqual(["slot-0:a"]);
    expect(afterFirst.pending).toEqual(["slot-1:a"]);

    const secondActive = activateNextExecution(afterFirst);
    const afterSecond = completeActiveExecution(
      secondActive,
      secondActive.active?.token ?? "missing",
    );
    expect(afterSecond.phase).toBe("preserving");
    expect(afterSecond.completed).toEqual(["slot-0:a", "slot-1:a"]);
    expect(finishAutoTurnEnd(afterSecond).phase).toBe("finished");
  });

  it("blocks visibly, retries with a new token, and never consumes the slot", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-4", [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-0:b", 0, [11]),
      ]),
    );
    const blocked = blockActiveExecution(
      active,
      active.active?.token ?? "missing",
      "skill is no longer legal",
    );
    expect(blocked.phase).toBe("blocked");
    expect(blocked.blockedReason).toBe("skill is no longer legal");
    expect(blocked.pending).toEqual(["slot-0:a", "slot-0:b"]);
    expect(blocked.blocked).toEqual(["slot-0:a"]);

    const retried = activateNextExecution(retryBlockedExecution(blocked));
    expect(retried.active?.reservationId).toBe("slot-0:a");
    expect(retried.active?.slot).toBe(slot(0));
    expect(retried.active?.token).toBe("turn-4:1:slot-0:a");
    expect(retried.blocked).toEqual([]);
  });

  it("cancels after partial completion while preserving the remaining queue", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-5", [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-0:b", 0, [11]),
        reservation("slot-2:a", 2, [12]),
      ]),
    );
    const afterFirst = completeActiveExecution(
      active,
      active.active?.token ?? "missing",
    );
    const secondActive = activateNextExecution(afterFirst);
    const cancelled = cancelAutoTurnEnd(secondActive);

    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.completed).toEqual(["slot-0:a"]);
    expect(cancelled.pending).toEqual([]);
    expect(cancelled.cancelled).toEqual(["slot-0:b", "slot-2:a"]);
    expect(cancelled.active).toBeNull();
    expect(activateNextExecution(cancelled)).toBe(cancelled);
  });

  it("can abort blocked remaining reservations without marking them completed", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-6", [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-0:b", 0, [11]),
      ]),
    );
    const blocked = blockActiveExecution(
      active,
      active.active?.token ?? "missing",
      "skill is no longer legal",
    );
    const preserving = abandonPendingExecutions(blocked);

    expect(preserving.phase).toBe("preserving");
    expect(preserving.pending).toEqual([]);
    expect(preserving.completed).toEqual([]);
    expect(preserving.cancelled).toEqual(["slot-0:a", "slot-0:b"]);
    expect(preserving.active).toBeNull();
    expect(preserving.blockedReason).toBeNull();
  });

  it("clears every remaining reservation on victory", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-victory", [
        reservation("slot-0:a", 0, [10]),
        reservation("slot-0:b", 0, [11]),
      ]),
    );
    const cancelled = cancelAutoTurnEnd(active);

    expect(cancelled.pending).toEqual([]);
    expect(cancelled.active).toBeNull();
    expect(cancelled.cancelled).toEqual(["slot-0:a", "slot-0:b"]);
  });
});
