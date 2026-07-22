import { contentDb } from "@game/content";
import type { CombatState, SlotId } from "@game/core";
import { createCombat, legalCommands } from "@game/core";
import { describe, expect, it } from "vitest";

import { REJECTION_TEXT, cooldownReason, rejectionReason } from "./action-feedback";

const slot = (value: number): SlotId => value as SlotId;
const boot = (): CombatState => createCombat(
  { character: "warrior" as never, enemies: ["raider" as never] },
  contentDb,
  "feedback-test",
);
const withSlotState = (state: CombatState, index: number, patch: Partial<CombatState["slots"][number]>): CombatState => ({
  ...state,
  slots: state.slots.map((candidate, slotIndex) => slotIndex === index ? { ...candidate, ...patch } : candidate),
});

describe("rejectionReason", () => {
  it("accepts a legal immediate flip command", () => {
    const state = boot();
    const command = legalCommands(state, contentDb).find((candidate) => candidate.type === "useImmediateFlipSkill");
    expect(command).toBeDefined();
    expect(rejectionReason(state, command!, contentDb)).toBeNull();
  });

  it("classifies phase, cooldown, once-per-combat, and empty-slot failures", () => {
    const state = boot();
    expect(rejectionReason({ ...state, phase: "enemy" }, { type: "endTurn" }, contentDb)).toBe(REJECTION_TEXT.notPlayerPhase);
    const immediate = legalCommands(state, contentDb).find((candidate) => candidate.type === "useImmediateFlipSkill")!;
    expect(rejectionReason(withSlotState(state, Number(immediate.slot), { cooldownRemaining: 2 }), immediate, contentDb)).toBe(cooldownReason(2));
    expect(cooldownReason(2)).toBe("재사용 대기 2턴");
    expect(rejectionReason(state, { type: "useImmediateFlipSkill", slot: slot(7), coins: [] }, contentDb)).toBe(REJECTION_TEXT.emptySlot);

    const locked = withSlotState(state, 4, { skillId: "flame-rampage" as never, cooldownRemaining: 0, usedThisCombat: true });
    expect(rejectionReason(locked, { type: "useFlipSkill", slot: slot(4) }, contentDb)).toBe(REJECTION_TEXT.usedThisCombat);
  });

  it("explains missing or invalid immediate coins", () => {
    const state = boot();
    expect(rejectionReason(state, { type: "useImmediateFlipSkill", slot: slot(0), coins: [], target: 0 }, contentDb)).toBe(REJECTION_TEXT.coinCost);
    expect(rejectionReason(state, { type: "useImmediateFlipSkill", slot: slot(0), coins: [999 as never], target: 0 }, contentDb)).toBe(REJECTION_TEXT.coinNotSelectable);
  });

  it("classifies missing consume fuel", () => {
    const state = withSlotState({
      ...boot(),
      coins: Object.fromEntries(Object.entries(boot().coins).map(([key, coin]) => [key, { ...coin, defId: "basic" as never, grants: [] }])),
    }, 4, { skillId: "burnout-blow" as never });
    expect(rejectionReason(state, { type: "useConsumeSkill", slot: slot(4), coins: [], target: 0 }, contentDb)).toBe(REJECTION_TEXT.noFuel);
  });
});
