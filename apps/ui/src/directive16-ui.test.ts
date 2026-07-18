import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CombatEvent, CombatState, EnemyIntent } from "@game/core";

import { combatEventLogSummary, IntentBadge } from "./App";
import { feedbackCuesFor } from "./feedback-cues";
import { sfxCuesFor } from "./combat-sfx";

const intent = (actions: EnemyIntent["actions"]): EnemyIntent => ({ id: "directive-16", actions });

const enemy = (overrides: Partial<CombatState["enemies"][number]> = {}): CombatState["enemies"][number] => ({
  block: 0,
  defId: "mud-egg" as never,
  enemyUid: 42,
  hp: 10,
  intent: intent([{ kind: "tickHatch" }]),
  intentIndex: 0,
  maxHp: 10,
  nextAttackBonus: 0,
  slot: 1,
  statuses: {},
  ...overrides,
});

describe("Directive 16 combat UI", () => {
  it("renders hatch, summon sickness, and summon target/count in the intent badge", () => {
    const html = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemy: enemy({
          hatch: { into: "marsh-hatchling" as never, turnsRemaining: 2, delayed: true, delayAtHpFraction: 0.5 },
          summonSick: true,
          intent: intent([{ kind: "summonEnemies", enemy: "skeleton-servant" as never, maxCount: 2 }]),
        }),
      }),
    );

    expect(html).toContain('data-testid="enemy-hatch-status"');
    expect(html).toContain("부화 2턴");
    expect(html).toContain('data-testid="enemy-summon-sick-status"');
    expect(html).toContain('data-testid="enemy-summon-intent"');
    expect(html).toContain("최대 2마리");
  });

  it("adds every enemy lifecycle transition to the Korean resolution summary", () => {
    const events = [
      { type: "enemySummonTelegraphed", sourceEnemyUid: 1, enemy: "skeleton-servant", maxCount: 2 },
      { type: "enemySummoned", sourceEnemyUid: 1, enemy: "skeleton-servant", slot: 1, enemyUid: 7 },
      { type: "enemySummonFailed", sourceEnemyUid: 1, enemy: "skeleton-servant", maxCount: 2 },
      { type: "enemyRemoved", enemyUid: 7, reason: "killed" },
      { type: "enemyHatchDelayed", sourceEnemyUid: 3 },
      { type: "enemyHatchAccelerated", sourceEnemyUid: 3, targetEnemyUid: 4, amount: 1 },
      { type: "enemyHatched", sourceEnemyUid: 4, into: "marsh-hatchling" },
    ] satisfies CombatEvent[];

    const summary = combatEventLogSummary(events);
    expect(summary?.triggerLines).toHaveLength(7);
    expect(summary?.totalLine).toContain("소환 예고");
    expect(summary?.totalLine).toContain("소환 완료");
    expect(summary?.totalLine).toContain("소환 실패");
    expect(summary?.totalLine).toContain("부화 지연");
    expect(summary?.totalLine).toContain("부화 가속");
    expect(summary?.totalLine).toContain("부화 완료");
  });

  it("uses only the spawned slot for visual feedback and reuses lifecycle sounds", () => {
    const spawned = { type: "enemySummoned", sourceEnemyUid: 1, enemy: "skeleton-servant", slot: 2, enemyUid: 8 } satisfies CombatEvent;
    expect(feedbackCuesFor(spawned).map((cue) => cue.key)).toEqual(["unit-enemy-2"]);
    expect(sfxCuesFor({ type: "enemySummonTelegraphed", sourceEnemyUid: 1, enemy: "skeleton-servant", maxCount: 2 })).toEqual(["cooldown"]);
    expect(sfxCuesFor(spawned)).toEqual(["summon-add"]);
    expect(sfxCuesFor({ type: "enemyHatched", sourceEnemyUid: 8, into: "marsh-hatchling" })).toEqual(["summon-replace"]);
  });
});
