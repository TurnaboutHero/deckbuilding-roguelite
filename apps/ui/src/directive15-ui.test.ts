import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CombatEvent, CombatState, EnemyIntent } from "@game/core";

import { combatEventLogSummary, IntentBadge } from "./App";

const intent = (id: string): EnemyIntent => ({ id, actions: [] });

const enemy = (
  overrides: Partial<CombatState["enemies"][number]>,
): CombatState["enemies"][number] => ({
  block: 0,
  defId: "blackthorn-inquisitor-roderick" as never,
  enemyUid: 0,
  hp: 96,
  intent: intent("warden-strike"),
  intentIndex: 0,
  maxHp: 96,
  nextAttackBonus: 0,
  slot: 0,
  statuses: {},
  ...overrides,
});

describe("Directive 15 combat UI", () => {
  it("renders zeal progress and the automatic tax denomination as accessible text", () => {
    const html = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: enemy({
          defId: "fallen-kings-treasurer-marcel" as never,
          repeatSkillPressure: {
            lastSkillId: "jab" as never,
            zeal: 2,
            singleUsableResolvedUses: 0,
          },
          royalTaxPending: { element: "fire", paid: 1, deadlineTurn: 3 },
        }),
      }),
    );

    expect(html).toContain('data-testid="repeat-skill-zeal"');
    expect(html).toContain('data-testid="royal-tax-demand"');
    expect(html).toContain("Zeal 2");
    expect(html).toContain("1/2");
  });

  it("withholds the execution preview until the configured zeal threshold", () => {
    const atTwo = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: enemy({
          repeatSkillPressure: {
            lastSkillId: "jab" as never,
            triggeringSlot: 2 as never,
            zeal: 2,
            singleUsableResolvedUses: 0,
          },
        }),
      }),
    );
    const atThree = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: enemy({
          repeatSkillPressure: {
            lastSkillId: "jab" as never,
            triggeringSlot: 2 as never,
            zeal: 3,
            singleUsableResolvedUses: 0,
          },
        }),
      }),
    );

    expect(atTwo).not.toContain(
      'data-testid="repeat-skill-execution-preconfirm"',
    );
    expect(atThree).toContain(
      'data-testid="repeat-skill-execution-preconfirm"',
    );
    expect(atThree).toContain("피해 18");
    expect(atThree).toContain("실제 체력 피해 15로 취소");
    expect(atThree).toContain("스킬 3 1턴 봉인");
  });

  it("uses the recorded triggering slot when duplicate skills share an ID", () => {
    const html = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: enemy({
          repeatSkillPressure: {
            lastSkillId: "jab" as never,
            triggeringSlot: 2 as never,
            zeal: 3,
            singleUsableResolvedUses: 0,
          },
        }),
      }),
    );

    expect(html).toContain("스킬 3 1턴 봉인");
    expect(html).not.toContain("스킬 1 1턴 봉인");
  });

  it("adds tax default, counterfeit exhaustion, and seizure scheduling to the semantic combat log", () => {
    const summary = combatEventLogSummary([
      {
        type: "royalTaxOpened",
        sourceEnemy: 0,
        element: "fire",
        denomination: 2,
        deadlineTurn: 3,
      },
      {
        type: "royalTaxPaymentProgressed",
        sourceEnemy: 0,
        element: "fire",
        paid: 1,
        denomination: 2,
      },
      {
        type: "royalTaxDefaulted",
        sourceEnemy: 0,
        element: "fire",
        paid: 1,
        denomination: 2,
        counterfeits: [91 as never, 92 as never],
        shield: 8,
        defaultStreak: 2,
      },
      {
        type: "royalTaxSeizureScheduled",
        sourceEnemy: 0,
        intent: intent("royal-seizure"),
      },
      { type: "counterfeitExhausted", coin: 91 as never },
    ] satisfies CombatEvent[]);

    expect(summary?.triggerLines).toHaveLength(5);
    expect(summary?.totalLine).toContain("2");
  });
});
