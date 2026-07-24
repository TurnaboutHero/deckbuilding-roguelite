import { contentDb } from "@game/content";
import type { CombatState, CoinUid, SlotId } from "@game/core";
import { createCombat, legalCommands, step } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  equipmentChoiceCommand,
  equipmentChoiceOptions,
  requiresEquipmentChoice,
} from "./equipment-choice";

const slot = (value: number): SlotId => value as SlotId;

const immediateChargedState = (): CombatState => {
  const initial = createCombat(
    { character: "arcanist" as never, enemies: ["raider" as never] },
    contentDb,
    "immediate-equipment-choice",
  );
  return {
    ...initial,
    slots: initial.slots.map((entry, index) =>
      index === 0 ? { ...entry, skillId: "arcane-charge" as never } : entry,
    ),
  };
};

describe("equipment choice", () => {
  it("offers every equipment definition in stable order only for a chosen-equipment skill", () => {
    const state = immediateChargedState();
    const command = legalCommands(state, contentDb).find(
      (candidate) =>
        candidate.type === "useImmediateFlipSkill" && candidate.slot === slot(0),
    );
    if (command?.type !== "useImmediateFlipSkill") throw new Error("missing command");

    expect(requiresEquipmentChoice(state, command, contentDb)).toBe(true);
    expect(equipmentChoiceOptions(contentDb)).toEqual([
      {
        id: "mana-shield",
        name: expect.any(String),
        description: expect.any(String),
      },
      {
        id: "mana-sword",
        name: expect.any(String),
        description: expect.any(String),
      },
    ]);

    const ordinary = {
      type: "useImmediateFlipSkill" as const,
      slot: slot(1),
      coins: [state.zones.hand[0] as CoinUid],
    };
    expect(requiresEquipmentChoice(state, ordinary, contentDb)).toBe(false);
  });

  it("replaces the policy default while preserving the rest of the explicit command", () => {
    const state = immediateChargedState();
    const suggested = legalCommands(state, contentDb).find(
      (candidate) =>
        candidate.type === "useImmediateFlipSkill" && candidate.slot === slot(0),
    );
    if (suggested?.type !== "useImmediateFlipSkill") throw new Error("missing command");
    const explicitBase = {
      ...suggested,
      chosen: [state.zones.hand[0] as CoinUid],
      desiredCoin: "mana" as never,
    };

    const command = equipmentChoiceCommand(
      state,
      explicitBase,
      "mana-sword" as never,
      contentDb,
    );

    expect(command).toEqual({
      ...explicitBase,
      chosenEquipment: "mana-sword",
    });
    expect(command !== null && step(state, command, contentDb).ok).toBe(true);
    expect(
      equipmentChoiceCommand(
        state,
        explicitBase,
        "missing-equipment" as never,
        contentDb,
      ),
    ).toBeNull();
  });

  it("supports equipment selection for the immediate flip flow", () => {
    const state = immediateChargedState();
    const coin = state.zones.hand.find(
      (candidate) => String(state.coins[Number(candidate)]?.defId) === "basic",
    );
    if (coin === undefined) throw new Error("missing test coin");
    const base = {
      type: "useImmediateFlipSkill" as const,
      slot: slot(0),
      coins: [coin],
    };

    expect(requiresEquipmentChoice(state, base, contentDb)).toBe(true);
    const command = equipmentChoiceCommand(
      state,
      base,
      "mana-shield" as never,
      contentDb,
    );

    expect(command).toEqual({ ...base, chosenEquipment: "mana-shield" });
    expect(command !== null && step(state, { ...command, target: 0 }, contentDb).ok).toBe(true);
  });
});
