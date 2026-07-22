import { contentDb } from "@game/content";
import type { CoinUid, CombatState, RunState, SlotId } from "@game/core";
import { createCombat, createRun } from "@game/core";
import { describe, expect, it } from "vitest";

import { cardActionView, coinFacesAfterEvent, pileComposition, rewardViewStage, sameCommand } from "./interaction";

const slot = (value: number): SlotId => value as SlotId;
const boot = (): CombatState => createCombat(
  { character: "warrior" as never, enemies: ["raider" as never] },
  contentDb,
  "interaction-test",
);

describe("cardActionView", () => {
  const base = { cooldownRemaining: 0, kind: "consume" as const, loaded: 0, ready: false, resolving: false, targeting: false, total: 2, usedThisCombat: false };
  it("shows immediate consume selection and blocking states", () => {
    expect(cardActionView(base)).toEqual({ actionable: false, label: "속성 동전 2개 필요", tone: "idle" });
    expect(cardActionView({ ...base, loaded: 2, ready: true, selecting: true })).toEqual({ actionable: true, label: "2/2 소비 · 확정", tone: "ready" });
    expect(cardActionView({ ...base, resolving: true })).toEqual({ actionable: false, label: "발동 중…", tone: "busy" });
    expect(cardActionView({ ...base, cooldownRemaining: 2 })).toEqual({ actionable: false, label: "재사용까지 2턴", tone: "idle" });
  });
});

describe("sameCommand", () => {
  it("compares the exact immediate bet including coins and target", () => {
    const command = { type: "useImmediateFlipSkill" as const, slot: slot(0), coins: [1 as CoinUid], target: 0 };
    expect(sameCommand(command, { ...command })).toBe(true);
    expect(sameCommand(command, { ...command, coins: [2 as CoinUid] })).toBe(false);
    expect(sameCommand(command, { ...command, target: 1 })).toBe(false);
  });
});

describe("coin face and pile projections", () => {
  it("records a flip and clears it when the same coin is drawn again", () => {
    const flipped = coinFacesAfterEvent({}, { type: "coinFlipped", coin: 1 as CoinUid, face: "heads" });
    expect(flipped).toEqual({ 1: "heads" });
    expect(coinFacesAfterEvent(flipped, { type: "coinsDrawn", coins: [1 as CoinUid] })).toEqual({});
  });

  it("groups pile entries without exposing draw order", () => {
    const state = boot();
    const groups = pileComposition(state, "draw", contentDb);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(state.zones.draw.length);
    expect(groups.every((group) => !Object.hasOwn(group, "order"))).toBe(true);
  });
});

describe("rewardViewStage", () => {
  const run = createRun({ contentVersion: "interaction-test", runSeed: "reward-view", character: "warrior" as never }, contentDb);
  it("follows the core reward flags", () => {
    const rewards = (flags: Partial<NonNullable<RunState["pendingRewards"]>>): RunState => ({
      ...run,
      phase: "rewards",
      pendingRewards: { coinOptions: [], skillOptions: [], coinChoiceResolved: false, coinRemovalResolved: false, skillChoiceResolved: false, ...flags },
    });
    expect(rewardViewStage(rewards({}))).toBe("coin");
    expect(rewardViewStage(rewards({ coinChoiceResolved: true }))).toBe("removal");
    expect(rewardViewStage(rewards({ coinChoiceResolved: true, coinRemovalResolved: true }))).toBe("skill");
  });
});
