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
    expect(cues({ type: "overheatScheduled" })).toEqual(["overheat-enter"]);
    expect(cues({ type: "overheatActivated" })).toEqual(["overheat-enter"]);
    expect(cues({ type: "cooldownReduced", slots: [2], amount: 1 })).toEqual(["cooldown"]);
    expect(cues({ type: "summonActed", uid: 1, equipment: "mana-sword", bonus: 0 })).toEqual(["summon-act"]);
  });

  it("reuses mana emphasis for armor echo events", () => {
    expect(cues({ type: "echoComputed", base: 4, preheat: 2, precision: 4, total: 10 })).toEqual(["mana"]);
    expect(cues({ type: "echoSpent", skill: "armor-smash" as never, amount: 6 })).toEqual(["mana"]);
  });

  it("reuses existing sounds for enemy telegraph events", () => {
    const intent = { id: "charge", actions: [{ kind: "attack" as const, damage: 12 }] };
    expect(cues({ type: "enemyWindupStarted", enemy: 0, intent, turnsLeft: 1, cancelThreshold: 8 })).toEqual(["cooldown"]);
    expect(cues({ type: "enemyWindupTicked", enemy: 0, intent, turnsLeft: 0 })).toEqual(["cooldown"]);
    expect(cues({ type: "enemyWindupCancelled", enemy: 0, intent })).toEqual(["skill"]);
    expect(cues({ type: "enemyPhaseChanged", enemy: 0 })).toEqual(["overheat-enter"]);
    expect(cues({ type: "enemyGrew", enemy: 0, stacks: 2 })).toEqual(["mana"]);
    expect(cues({ type: "enemyCleansed", enemy: 0, statuses: ["burn", "shock"] })).toEqual(["blood"]);
    expect(cues({ type: "enemyHealFailed", enemy: 0, target: 1 })).toEqual(["flip-tails"]);
  });

  it("maps Directive 12 prevention, ring break, and unused-coin punishment events", () => {
    expect(cues({ type: "healPrevented", target: { type: "player" }, amount: 5, reason: "healLock" })).toEqual(["flip-tails"]);
    expect(cues({ type: "enemyGrowthReduced", enemy: 0, removed: 2, stacks: 3, damage: 17, threshold: 17 })).toEqual(["hit"]);
    expect(cues({ type: "playerTurnEndPunished", enemy: 0, coinCount: 4, threshold: 4, status: "frostbite", stacks: 1 })).toEqual(["frost"]);
  });

  it("maps stack Remise events to charge, success, failure and hit emphasis sounds", () => {
    expect(cues({ type: "remiseGained", amount: 1, total: 2 })).toEqual(["mana"]);
    expect(cues({ type: "remiseGained", amount: 0, total: 3 })).toEqual([]);
    expect(cues({ type: "remiseSpent", skill: "fente" as never, firstFace: "heads", repeat: true, remaining: 1 })).toEqual(["skill"]);
    expect(cues({ type: "remiseSpent", skill: "fente" as never, firstFace: "tails", repeat: false, remaining: 0 })).toEqual(["flip-tails"]);
    expect(cues({ type: "remiseRepeatResolved", skill: "fente" as never })).toEqual(["hit"]);
  });

  it("stays silent for zero-value and bookkeeping events", () => {
    expect(cues({ type: "healed", target: { type: "player" }, amount: 0, hp: 5 })).toEqual([]);
    expect(cues({ type: "turnStarted", turn: 2 })).toEqual([]);
  });
});
