import type { Command, CoinUid, SlotId } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  cycleTarget,
  defaultTarget,
  legalTargetsForCommand,
  livingEnemyTargets,
} from "./targeting";

const slot = (value: number): SlotId => value as SlotId;
const coin = (value: number): CoinUid => value as CoinUid;

describe("targeting", () => {
  it("chooses the last attacked living legal target before the leftmost target", () => {
    expect(defaultTarget([0, 2], 2)).toBe(2);
    expect(defaultTarget([0, 2], null)).toBe(0);
  });

  it("cycles left and right through living targets only", () => {
    const targets = livingEnemyTargets([{ hp: 12 }, { hp: 0 }, { hp: 8 }]);

    expect(targets).toEqual([0, 2]);
    expect(cycleTarget(targets, 0, "right")).toBe(2);
    expect(cycleTarget(targets, 2, "right")).toBe(0);
    expect(cycleTarget(targets, 0, "left")).toBe(2);
  });

  it("matches targetable skills by type and slot without replacing manual fuel", () => {
    const commands: Command[] = [
      { type: "useImmediateFlipSkill", slot: slot(0), coins: [coin(1)], target: 0 },
      { type: "useImmediateFlipSkill", slot: slot(0), coins: [coin(1)], target: 2 },
      { type: "useImmediateFlipSkill", slot: slot(1), coins: [coin(2)], target: 1 },
      {
        type: "useConsumeSkill",
        slot: slot(2),
        coins: [coin(7), coin(8)],
        target: 2,
      },
      {
        type: "useConsumeSkill",
        slot: slot(2),
        coins: [coin(8), coin(7)],
        target: 0,
      },
    ];

    expect(
      legalTargetsForCommand(commands, {
        type: "useImmediateFlipSkill",
        slot: slot(0),
        coins: [coin(1)],
        target: 0,
      }),
    ).toEqual([0, 2]);
    expect(
      legalTargetsForCommand(commands, {
        type: "useConsumeSkill",
        slot: slot(2),
        coins: [coin(9)],
        target: 0,
      }),
    ).toEqual([2, 0]);
  });

  it("keeps immediate self-skill targets scoped to the selected coins", () => {
    const commands: Command[] = [
      {
        type: "useImmediateFlipSkill",
        slot: slot(0),
        coins: [coin(1), coin(2)],
        target: 0,
      },
      {
        type: "useImmediateFlipSkill",
        slot: slot(0),
        coins: [coin(1), coin(2)],
        target: 2,
      },
      {
        type: "useImmediateFlipSkill",
        slot: slot(0),
        coins: [coin(3), coin(4)],
      },
    ];

    expect(
      legalTargetsForCommand(commands, {
        type: "useImmediateFlipSkill",
        slot: slot(0),
        coins: [coin(2), coin(1)],
      }),
    ).toEqual([0, 2]);
    expect(
      legalTargetsForCommand(commands, {
        type: "useImmediateFlipSkill",
        slot: slot(0),
        coins: [coin(4), coin(3)],
      }),
    ).toEqual([]);
  });

  it("falls back when the last attacked target is dead or illegal", () => {
    expect(defaultTarget([1, 3], 0)).toBe(1);
    expect(defaultTarget([], 0)).toBeNull();
  });
});
