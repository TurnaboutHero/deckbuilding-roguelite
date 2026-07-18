import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CombatEvent, CombatState, EnemyIntent } from "@game/core";

import { combatEventLogSummary, IntentBadge } from "./App";
import { feedbackCuesFor } from "./feedback-cues";
import { sfxCuesFor } from "./combat-sfx";

const intent = (overrides: Partial<EnemyIntent> = {}): EnemyIntent => ({
  id: "crown-confiscation",
  actions: [{ kind: "royalVaultExactSeizure", maxCoins: 3, selection: "handFraction" }],
  windup: { turns: 1, revealAtStart: true },
  cancelOn: [{ kind: "vaultCoinsRecovered", count: 2 }, { kind: "skillDamage", threshold: 10 }],
  ...overrides,
});

const enemy = (overrides: Partial<CombatState["enemies"][number]> = {}): CombatState["enemies"][number] => ({
  block: 0,
  defId: "uncrowned-coin-king-aurel" as never,
  enemyUid: 72,
  hp: 100,
  intent: intent(),
  intentIndex: 0,
  maxHp: 180,
  nextAttackBonus: 0,
  slot: 0,
  statuses: {},
  royalVaultSeizure: { nominated: [41 as never, 42 as never], capacity: 6 },
  leadDecree: { initial: 3, remaining: 1, weakenedThisTurn: 1, weakenedTotal: 2 },
  windup: { intent: intent(), turnsLeft: 1, startHp: 100 },
  ...overrides,
});

describe("Directive 18 royal vault combat UI", () => {
  it("renders exact vault storage order, seizure nominations, Lead state, and both Crown cancel paths", () => {
    const html = renderToStaticMarkup(createElement(IntentBadge, {
      enemy: enemy(),
      custody: [{ sourceEnemy: 0, sourceEnemyUid: 72, kind: "royalVault", element: "fire", seizureOrder: 1, coins: [41 as never, 42 as never] }],
      coins: {
        41: { uid: 41 as never, defId: "fire" as never, grants: [], permanent: false },
        42: { uid: 42 as never, defId: "mana" as never, grants: [], permanent: false },
      },
    }));

    expect(html).toContain('data-testid="royal-vault-status"');
    expect(html).toContain("41:");
    expect(html).toContain("42:");
    expect(html).toContain('data-testid="royal-vault-seizure-nominations"');
    expect(html).toContain('data-testid="lead-decree-status"');
    expect(html).toContain("2");
    expect(html).toContain("10");
    expect(html).toContain('data-testid="royal-vault-exact-seizure-intent"');
  });

  it("adds vault, Lead, and before/after recovery facts to the semantic log and feedback surfaces", () => {
    const events = [
      { type: "royalVaultForeclosed", sourceEnemy: 0, sourceEnemyUid: 72, element: "fire", nominated: [41 as never], capacity: 6 },
      { type: "royalVaultSeized", sourceEnemy: 0, sourceEnemyUid: 72, coins: [41 as never, 42 as never], elements: [{ coin: 41 as never, element: "fire" }, { coin: 42 as never, element: "mana" }], before: 0, after: 2, seizureOrder: 1 },
      { type: "royalVaultReturned", sourceEnemy: 0, sourceEnemyUid: 72, coin: 41 as never, before: 1, after: 0, reason: "crownCancelled" },
      { type: "leadDecreeStarted", sourceEnemy: 0, sourceEnemyUid: 72, initial: 3, remaining: 3 },
      { type: "leadDecreeWeakened", sourceEnemy: 0, sourceEnemyUid: 72, before: 3, after: 2, reason: "distinctElements" },
    ] satisfies CombatEvent[];

    expect(combatEventLogSummary(events)?.triggerLines).toHaveLength(events.length);
    expect(feedbackCuesFor(events[1]!).map((cue) => cue.key)).toEqual(["unit-enemy-0"]);
    expect(sfxCuesFor(events[2]!)).toEqual(["coin-consume"]);
  });
});
