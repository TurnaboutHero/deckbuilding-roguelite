import type { SlotId } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  activateNextExecution,
  abandonPendingExecutions,
  beginAutoTurnEnd,
  blockActiveExecution,
  cancelAutoTurnEnd,
  classifyExecutionSlot,
  completeActiveExecution,
  executionQueueSnapshot,
  finishAutoTurnEnd,
  moveExecutionSlot,
  pauseForExecutionChoice,
  reconcileExecutionOrder,
  resumeExecutionChoice,
  retryBlockedExecution,
  swapExecutionSlots,
  type ExecutionSlotLoad,
} from "./auto-turn-end";

const slot = (value: number): SlotId => value as SlotId;

const load = (
  slotId: number,
  loadedCount: number,
  requiredCount = 1,
  queueable = true,
): ExecutionSlotLoad => ({
  slot: slot(slotId),
  loadedCount,
  requiredCount,
  queueable,
});

describe("execution-order reconciliation", () => {
  it("uses first-loaded observation order and retains it across snapshots", () => {
    const initial = reconcileExecutionOrder([], [load(2, 1), load(0, 1)]);
    expect(initial).toEqual([slot(2), slot(0)]);

    expect(
      reconcileExecutionOrder(initial, [load(0, 1), load(2, 1), load(1, 1)]),
    ).toEqual([slot(2), slot(0), slot(1)]);
  });

  it("removes unloaded slots and appends a later reload", () => {
    const afterUnload = reconcileExecutionOrder(
      [slot(0), slot(1)],
      [load(0, 0), load(1, 1)],
    );
    expect(afterUnload).toEqual([slot(1)]);

    expect(
      reconcileExecutionOrder(afterUnload, [load(0, 1), load(1, 1)]),
    ).toEqual([slot(1), slot(0)]);
  });

  it("keeps partial loads out of the queue and deduplicates slot IDs", () => {
    expect(
      reconcileExecutionOrder(
        [slot(1), slot(1), slot(0)],
        [load(0, 1, 2), load(1, 2, 2), load(1, 2, 2)],
      ),
    ).toEqual([slot(1)]);
  });

  it("moves and swaps slots without changing physical slot identity", () => {
    const order = [slot(0), slot(1), slot(2)];
    expect(moveExecutionSlot(order, slot(2), 0)).toEqual([
      slot(2),
      slot(0),
      slot(1),
    ]);
    expect(swapExecutionSlots(order, slot(0), slot(2))).toEqual([
      slot(2),
      slot(1),
      slot(0),
    ]);
    expect(moveExecutionSlot(order, slot(9), 0)).toEqual(order);
  });
});

describe("execution queue snapshots", () => {
  it("classifies full, partial, empty, zero-cost, and disabled slots", () => {
    expect(classifyExecutionSlot(load(0, 2, 2))).toBe("loaded");
    expect(classifyExecutionSlot(load(1, 1, 2))).toBe("partial");
    expect(classifyExecutionSlot(load(2, 0, 2))).toBe("not-queued");
    expect(classifyExecutionSlot(load(3, 0, 0))).toBe("not-queued");
    expect(classifyExecutionSlot(load(4, 1, 1, false))).toBe("not-queued");
  });

  it("returns an ordered, deduplicated view for UI rendering", () => {
    const snapshot = executionQueueSnapshot(
      [slot(2), slot(0), slot(2)],
      [load(0, 1), load(1, 1, 2), load(2, 1), load(3, 0)],
    );

    expect(snapshot.order).toEqual([slot(2), slot(0)]);
    expect(snapshot.loaded.map((entry) => entry.slot)).toEqual([
      slot(2),
      slot(0),
    ]);
    expect(snapshot.partial.map((entry) => entry.slot)).toEqual([slot(1)]);
    expect(snapshot.notQueued.map((entry) => entry.slot)).toEqual([slot(3)]);
  });
});

describe("automatic turn-end workflow", () => {
  it("claims the next slot idempotently and pauses/resumes for a choice", () => {
    const started = beginAutoTurnEnd("turn-7", [slot(2), slot(0)]);
    const active = activateNextExecution(started);
    const duplicateEffect = activateNextExecution(active);

    expect(active.phase).toBe("running");
    expect(active.active).toEqual({ slot: slot(2), token: "turn-7:0:2" });
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
      beginAutoTurnEnd("turn-3", [slot(0), slot(1)]),
    );
    expect(completeActiveExecution(firstActive, "stale-token")).toBe(
      firstActive,
    );

    const afterFirst = completeActiveExecution(
      firstActive,
      firstActive.active?.token ?? "missing",
    );
    expect(afterFirst.completed).toEqual([slot(0)]);
    expect(afterFirst.pending).toEqual([slot(1)]);

    const secondActive = activateNextExecution(afterFirst);
    const afterSecond = completeActiveExecution(
      secondActive,
      secondActive.active?.token ?? "missing",
    );
    expect(afterSecond.phase).toBe("preserving");
    expect(afterSecond.completed).toEqual([slot(0), slot(1)]);
    expect(finishAutoTurnEnd(afterSecond).phase).toBe("finished");
  });

  it("blocks visibly, retries with a new token, and never consumes the slot", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-4", [slot(0), slot(1)]),
    );
    const blocked = blockActiveExecution(
      active,
      active.active?.token ?? "missing",
      "skill is no longer legal",
    );
    expect(blocked.phase).toBe("blocked");
    expect(blocked.blockedReason).toBe("skill is no longer legal");
    expect(blocked.pending).toEqual([slot(0), slot(1)]);

    const retried = activateNextExecution(retryBlockedExecution(blocked));
    expect(retried.active?.slot).toBe(slot(0));
    expect(retried.active?.token).toBe("turn-4:1:0");
  });

  it("cancels after partial completion while preserving the remaining queue", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-5", [slot(0), slot(1), slot(2)]),
    );
    const afterFirst = completeActiveExecution(
      active,
      active.active?.token ?? "missing",
    );
    const secondActive = activateNextExecution(afterFirst);
    const cancelled = cancelAutoTurnEnd(secondActive);

    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.completed).toEqual([slot(0)]);
    expect(cancelled.pending).toEqual([slot(1), slot(2)]);
    expect(cancelled.active).toBeNull();
    expect(activateNextExecution(cancelled)).toBe(cancelled);
  });

  it("can abandon blocked remaining skills and continue to preservation without marking them completed", () => {
    const active = activateNextExecution(
      beginAutoTurnEnd("turn-6", [slot(0), slot(1)]),
    );
    const blocked = blockActiveExecution(
      active,
      active.active?.token ?? "missing",
      "skill is no longer legal",
    );
    const preserving = abandonPendingExecutions(blocked);

    expect(preserving.phase).toBe("preserving");
    expect(preserving.pending).toEqual([slot(0), slot(1)]);
    expect(preserving.completed).toEqual([]);
    expect(preserving.active).toBeNull();
    expect(preserving.blockedReason).toBeNull();
  });
});
