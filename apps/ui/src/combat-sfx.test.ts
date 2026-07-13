import { describe, expect, it } from "vitest";
import type { CombatEvent } from "@game/core";
import { sfxCuesFor } from "./combat-sfx";

const cues = (event: CombatEvent) => sfxCuesFor(event);

describe("sfxCuesFor", () => {
  it("distinguishes coin and resource actions", () => {
    expect(cues({ type: "coinPlaced", coin: 1 as never, slot: 0 as never })).toEqual(["coin-place"]);
    expect(cues({ type: "coinsConsumed", coins: [1 as never] })).toEqual(["coin-consume"]);
    expect(cues({ type: "pileShuffled", count: 4 })).toEqual(["coin-shuffle"]);
  });

  it("distinguishes elements, overheat, cooldown and summons", () => {
    expect(cues({ type: "statusApplied", target: { type: "enemy", index: 0 }, status: "frostbite", stacks: 1 })).toEqual(["frost"]);
    expect(cues({ type: "overheatEntered" })).toEqual(["overheat-enter"]);
    expect(cues({ type: "cooldownReduced", slots: [2], amount: 1 })).toEqual(["cooldown"]);
    expect(cues({ type: "summonActed", uid: 1, equipment: "mana-sword", bonus: 0 })).toEqual(["summon-act"]);
  });

  it("stays silent for zero-value and bookkeeping events", () => {
    expect(cues({ type: "healed", target: { type: "player" }, amount: 0, hp: 5 })).toEqual([]);
    expect(cues({ type: "turnStarted", turn: 2 })).toEqual([]);
  });
});
