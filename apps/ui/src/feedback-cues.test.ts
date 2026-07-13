import { describe, expect, it } from "vitest";
import type { CombatEvent } from "@game/core";
import { feedbackCuesFor } from "./feedback-cues";

const keys = (event: CombatEvent) => feedbackCuesFor(event).map((item) => item.key);

describe("feedbackCuesFor", () => {
  it("maps recovery, elemental status and overheat to their affected units", () => {
    expect(keys({ type: "healed", target: { type: "player" }, amount: 2, hp: 9 })).toEqual([
      "heal-player",
    ]);
    expect(keys({ type: "statusApplied", target: { type: "enemy", index: 1 }, status: "frostbite", stacks: 1 })).toEqual([
      "frostbite-enemy-1",
    ]);
    expect(keys({ type: "overheatEntered" })).toEqual([
      "overheat-player",
    ]);
  });

  it("maps cooldown and summon lifecycle without changing core facts", () => {
    expect(keys({ type: "cooldownReduced", slots: [1, 3], amount: 1 })).toEqual([
      "cooldown-slot-1",
      "cooldown-slot-3",
    ]);
    expect(keys({ type: "summonActed", uid: 7, equipment: "mana-sword", bonus: 2 })).toEqual([
      "summon-7",
    ]);
  });

  it("maps coin placement and recovery to the rendered coin key", () => {
    expect(keys({ type: "coinPlaced", coin: 4 as never, slot: 0 as never })).toEqual([
      "coin-4",
    ]);
    expect(keys({ type: "coinUnplaced", coin: 4 as never, slot: 0 as never })).toEqual([
      "coin-4",
    ]);
  });

  it("maps Remise and weapon output feedback to the rendered player unit", () => {
    expect(keys({ type: "remiseReflipped", coin: 4 as never, face: "heads" })).toEqual([
      "unit-player",
    ]);
    expect(keys({ type: "remiseReused", skill: "fente" as never })).toEqual([
      "unit-player",
    ]);
    expect(keys({ type: "weaponOutputChanged", amount: 1, value: 2 })).toEqual([
      "unit-player",
    ]);
  });

  it("does not create motion cues for zero-value or bookkeeping events", () => {
    expect(keys({ type: "healed", target: { type: "player" }, amount: 0, hp: 5 })).toEqual([]);
    expect(keys({ type: "turnStarted", turn: 2 })).toEqual([]);
    expect(keys({ type: "coinCreated", coin: 9 as never, defId: "fire", zone: "discard" })).toEqual([]);
  });
});
