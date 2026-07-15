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

const chargedState = (): CombatState => {
  const initial = createCombat(
    { character: "arcanist" as never, enemies: ["raider" as never] },
    contentDb,
    "equipment-choice",
  );
  const equipped: CombatState = {
    ...initial,
    slots: initial.slots.map((entry, index) =>
      index === 0 ? { ...entry, skillId: "arcane-charge" as never } : entry,
    ),
  };
  const coin = equipped.zones.hand[0] as CoinUid | undefined;
  if (coin === undefined) throw new Error("missing test coin");
  const placed = step(
    equipped,
    { type: "placeCoin", coin, slot: slot(0) },
    contentDb,
  );
  if (!placed.ok) throw new Error(placed.error);
  return placed.state;
};

describe("equipment choice", () => {
  it("offers every equipment definition in stable order only for a chosen-equipment skill", () => {
    const state = chargedState();
    const command = legalCommands(state, contentDb).find(
      (candidate) =>
        candidate.type === "useFlipSkill" && candidate.slot === slot(0),
    );
    if (command?.type !== "useFlipSkill") throw new Error("missing command");

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
      type: "useFlipSkill" as const,
      slot: slot(1),
    };
    expect(requiresEquipmentChoice(state, ordinary, contentDb)).toBe(false);
  });

  it("replaces the policy default while preserving the rest of the explicit command", () => {
    const state = chargedState();
    const suggested = legalCommands(state, contentDb).find(
      (candidate) =>
        candidate.type === "useFlipSkill" && candidate.slot === slot(0),
    );
    if (suggested?.type !== "useFlipSkill") throw new Error("missing command");
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
});
