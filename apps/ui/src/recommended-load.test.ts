import { contentDb } from "@game/content";
import type { CombatState, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it } from "vitest";

import { recommendedLoadProposal } from "./recommended-load";

const slot = (value: number): SlotId => value as SlotId;

describe("recommended load proposal", () => {
  it("previews legal placements from left to right without mutating or firing skills", () => {
    const state = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "recommend-load",
    );
    const before = structuredClone(state);

    const proposal = recommendedLoadProposal(state, contentDb);

    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.commands).toHaveLength(3);
    expect(proposal.commands.every((command) => command.type === "placeCoin")).toBe(true);
    expect(proposal.placements.map((placement) => placement.slot)).toEqual([
      slot(0),
      slot(1),
      slot(2),
    ]);
    expect(state).toEqual(before);
  });

  it("continues from an existing partial load and revalidates every proposed command", () => {
    const initial = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "recommend-partial",
    );
    const coin = initial.zones.hand[0];
    if (coin === undefined) throw new Error("missing test coin");
    const partial = step(initial, { type: "placeCoin", coin, slot: slot(2) }, contentDb);
    if (!partial.ok) throw new Error(partial.error);
    const suppliedCoin = partial.state.zones.draw[0];
    if (suppliedCoin === undefined) throw new Error("missing supplied test coin");
    const supplied: CombatState = {
      ...partial.state,
      zones: {
        ...partial.state.zones,
        hand: [...partial.state.zones.hand, suppliedCoin],
        draw: partial.state.zones.draw.slice(1),
      },
    };

    const proposal = recommendedLoadProposal(supplied, contentDb);
    let simulated: CombatState = supplied;
    for (const command of proposal.commands) {
      const result = step(simulated, command, contentDb);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      simulated = result.state;
    }

    expect(proposal.commands.every((command) => command.type === "placeCoin")).toBe(true);
    expect(proposal.placements.some((placement) => placement.slot === slot(2))).toBe(true);
  });

  it("returns an empty, non-confirmable proposal outside the player phase", () => {
    const initial = createCombat(
      { character: "warrior" as never, enemies: ["raider" as never] },
      contentDb,
      "recommend-enemy-phase",
    );
    const state: CombatState = { ...initial, phase: "enemy" };

    expect(recommendedLoadProposal(state, contentDb)).toEqual({
      commands: [],
      placements: [],
      requiresConfirmation: false,
    });
  });
});
