import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CombatEvent, CombatState, CoinUid, SlotId } from "@game/core";

import { combatEventLogSummary, IntentBadge, SkillSealBadges } from "./App";

const enemy = (overrides: Partial<CombatState["enemies"][number]>): CombatState["enemies"][number] => ({
  block: 0,
  defId: "black-pouch-coin-thief" as never,
  hp: 44,
  intent: { id: "seize-purse", actions: [{ kind: "seizeCustody" }] },
  intentIndex: 0,
  maxHp: 44,
  nextAttackBonus: 0,
  statuses: {},
  ...overrides,
});

describe("Directive 14 combat UI", () => {
  it("renders the frozen M09 seizure target and quantity before resolution", () => {
    const html = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: enemy({
          coinSeizure: {
            cap: 1,
            element: "fire",
            handCountAtTelegraph: 3,
            nominated: [0 as CoinUid],
            quantity: 1,
          },
        }),
      }),
    );

    expect(html).toContain('data-testid="coin-seizure-telegraph"');
    expect(html).toContain('data-testid="coin-seizure-intent"');
    expect(html).toContain("1");
    expect(html).toContain("3");
  });

  it("states seal or reduction type and remaining player turns without relying on color", () => {
    const html = renderToStaticMarkup(
      createElement(SkillSealBadges, {
        seals: [
          { name: "Slash", slot: 0, turns: 2 },
          { effectMultiplier: 0.75, name: "Guard", slot: 1, turns: 1 },
        ],
      }),
    );

    expect(html).toContain('data-testid="skill-seal-status-0"');
    expect(html).toContain('data-testid="skill-seal-status-1"');
    expect(html).toContain("2");
    expect(html).toContain("75%");
  });

  it("adds M09/M10 outcomes to the semantic combat log", () => {
    const summary = combatEventLogSummary([
      {
        cap: 1,
        element: "fire",
        handCountAtTelegraph: 3,
        nominated: [0 as CoinUid],
        quantity: 1,
        sourceEnemy: 0,
        type: "coinSeizureTelegraphed",
      },
      { coins: [0 as CoinUid], element: "fire", seizureOrder: 0, sourceEnemy: 0, type: "coinsSeized" },
      { multiplier: 0.75, slot: 1 as SlotId, sourceEnemy: 0, turns: 1, type: "skillSealFallbackReduced" },
    ] satisfies CombatEvent[]);

    expect(summary?.triggerLines).toHaveLength(3);
    expect(summary?.totalLine).toContain("75%");
  });
});
