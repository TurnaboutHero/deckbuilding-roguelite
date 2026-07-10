import { contentDb } from "@game/content";
import type { CoinUid, CombatState, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it } from "vitest";

import { REJECTION_TEXT, rejectionReason } from "./action-feedback";

const slot = (value: number): SlotId => value as SlotId;

const boot = (): CombatState =>
  createCombat(
    { character: "warrior" as never, enemies: ["raider" as never] },
    contentDb,
    "feedback-test",
  );

const firstHandCoin = (state: CombatState): CoinUid => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error("missing hand coin");
  return coin;
};

const placeFirst = (
  state: CombatState,
  slotIndex: number,
): { state: CombatState; coin: CoinUid } => {
  const coin = firstHandCoin(state);
  const result = step(
    state,
    { type: "placeCoin", coin, slot: slot(slotIndex) },
    contentDb,
  );
  if (!result.ok) throw new Error(result.error);
  return { state: result.state, coin };
};

describe("rejectionReason", () => {
  it("returns null for legal commands", () => {
    const state = boot();
    expect(
      rejectionReason(
        state,
        { type: "placeCoin", coin: firstHandCoin(state), slot: slot(0) },
        contentDb,
      ),
    ).toBeNull();
  });

  it("classifies non-player phase or resolution state", () => {
    const state = { ...boot(), phase: "enemy" as const };
    expect(rejectionReason(state, { type: "endTurn" }, contentDb)).toBe(
      REJECTION_TEXT.notPlayerPhase,
    );
  });

  it("classifies the three-skill turn cap", () => {
    const { state } = placeFirst(boot(), 0);
    expect(
      rejectionReason(
        { ...state, skillUsesThisTurn: 3 },
        { type: "useFlipSkill", slot: slot(0), target: 0 },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.skillCap);
  });

  it("classifies a skill already used this turn", () => {
    const { state } = placeFirst(boot(), 0);
    expect(
      rejectionReason(
        {
          ...state,
          slots: state.slots.map((candidate, index) =>
            index === 0 ? { ...candidate, usedThisTurn: true } : candidate,
          ),
        },
        { type: "useFlipSkill", slot: slot(0), target: 0 },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.usedThisTurn);
  });

  it("classifies a once-per-combat lock", () => {
    const { state } = placeFirst(boot(), 5);
    expect(
      rejectionReason(
        {
          ...state,
          slots: state.slots.map((candidate, index) =>
            index === 5 ? { ...candidate, usedThisCombat: true } : candidate,
          ),
        },
        { type: "useFlipSkill", slot: slot(5) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.usedThisCombat);
  });

  it("classifies a full socket when placing another coin", () => {
    const { state } = placeFirst(boot(), 0);
    expect(
      rejectionReason(
        state,
        { type: "placeCoin", coin: firstHandCoin(state), slot: slot(0) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.socketFull);
  });

  it("classifies insufficient placed coins for flip cost", () => {
    const { state } = placeFirst(boot(), 2);
    expect(
      rejectionReason(
        state,
        { type: "useFlipSkill", slot: slot(2), target: 0 },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.coinCost);
  });

  it("classifies missing consume fuel in hand", () => {
    const state = {
      ...boot(),
      coins: Object.fromEntries(
        Object.entries(boot().coins).map(([key, coin]) => [
          key,
          { ...coin, defId: "basic" as never, grants: [] },
        ]),
      ),
    };
    expect(
      rejectionReason(
        state,
        { type: "useConsumeSkill", slot: slot(4), coins: [], target: 0 },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.noFuel);
  });

  it("classifies a coin that cannot be selected", () => {
    expect(
      rejectionReason(
        boot(),
        { type: "placeCoin", coin: 999 as CoinUid, slot: slot(0) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.coinNotSelectable);
  });
});
