import { describe, expect, it } from "vitest";
import type { CombatEvent } from "@game/core";
import { contentDb } from "@game/content";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { feedbackCuesFor } from "./feedback-cues";
import { combatEventLogSummary, RemiseSpendBadge, RemiseStackChip } from "./App";

const keys = (event: CombatEvent) => feedbackCuesFor(event).map((item) => item.key);

describe("feedbackCuesFor", () => {
  it("maps recovery, elemental status and overheat to their affected units", () => {
    expect(keys({ type: "healed", target: { type: "player" }, amount: 2, hp: 9 })).toEqual([
      "heal-player",
    ]);
    expect(keys({ type: "statusApplied", target: { type: "enemy", index: 1 }, status: "frostbite", stacks: 1 })).toEqual([
      "frostbite-enemy-1",
    ]);
    expect(keys({ type: "overheatEntered" })).toEqual([
      "overheat-player",
    ]);
    expect(keys({ type: "overheatScheduled" })).toEqual([
      "overheat-player",
    ]);
    expect(keys({ type: "overheatActivated" })).toEqual([
      "overheat-player",
    ]);
  });

  it("maps cooldown and summon lifecycle without changing core facts", () => {
    expect(keys({ type: "cooldownReduced", slots: [1, 3], amount: 1 })).toEqual([
      "cooldown-slot-1",
      "cooldown-slot-3",
    ]);
    expect(keys({ type: "summonActed", uid: 7, equipment: "mana-sword", bonus: 2 })).toEqual([
      "summon-7",
    ]);
  });

  it("maps enemy telegraph feedback to the rendered enemy unit", () => {
    const intent = { id: "charge", actions: [{ kind: "attack" as const, damage: 12 }] };
    expect(keys({ type: "enemyWindupStarted", enemy: 1, intent, turnsLeft: 1, cancelThreshold: 8 })).toEqual([
      "unit-enemy-1",
    ]);
    expect(keys({ type: "enemyWindupCancelled", enemy: 1, intent })).toEqual([
      "unit-enemy-1",
    ]);
    expect(keys({ type: "enemyPhaseChanged", enemy: 1 })).toEqual([
      "unit-enemy-1",
    ]);
    expect(keys({ type: "enemyGrew", enemy: 1, stacks: 2 })).toEqual([
      "unit-enemy-1",
    ]);
    expect(keys({ type: "enemyCleansed", enemy: 1, statuses: ["burn", "shock"] })).toEqual([
      "unit-enemy-1",
    ]);
    expect(keys({ type: "enemyHealFailed", enemy: 1, target: 0 })).toEqual([
      "unit-enemy-1",
    ]);
  });

  it("maps Directive 12 feedback to the affected player and ring bearer", () => {
    expect(keys({ type: "healPrevented", target: { type: "player" }, amount: 5, reason: "healLock" })).toEqual([
      "heal-lock-player",
      "unit-player",
    ]);
    expect(keys({ type: "enemyGrowthReduced", enemy: 1, removed: 2, stacks: 3, damage: 17, threshold: 17 })).toEqual([
      "unit-enemy-1",
    ]);
    expect(keys({ type: "playerTurnEndPunished", enemy: 1, coinCount: 4, threshold: 4, status: "frostbite", stacks: 1 })).toEqual([
      "unit-player",
      "frostbite-player",
    ]);
  });

  it("adds Directive 12 outcomes to the combat history summary", () => {
    const entry = combatEventLogSummary([
      { type: "healPrevented", target: { type: "player" }, amount: 5, reason: "healLock" },
      { type: "enemyGrowthReduced", enemy: 0, removed: 2, stacks: 3, damage: 17, threshold: 17 },
      { type: "playerTurnEndPunished", enemy: 0, coinCount: 4, threshold: 4, status: "frostbite", stacks: 1 },
    ]);

    expect(entry?.totalLine).toContain("회복 봉인 — 회복 5 무효");
    expect(entry?.totalLine).toContain("나이테 2개 파괴");
    expect(entry?.totalLine).toContain("미사용 속성 코인 경고 — 4/4");
  });

  it("maps Remise and weapon output feedback to the rendered player unit", () => {
    expect(keys({ type: "remiseGained", amount: 1, total: 2 })).toEqual([
      "unit-player",
    ]);
    expect(keys({ type: "remiseSpent", skill: "fente" as never, firstFace: "heads", repeat: true, remaining: 1 })).toEqual([
      "unit-player",
    ]);
    expect(keys({ type: "remiseSpent", skill: "fente" as never, firstFace: "tails", repeat: false, remaining: 0 })).toEqual([
      "unit-player",
    ]);
    expect(keys({ type: "remiseRepeatResolved", skill: "fente" as never })).toEqual([
      "unit-player",
    ]);
    expect(keys({ type: "weaponOutputChanged", amount: 1, value: 2 })).toEqual([
      "unit-player",
    ]);
  });

  it("does not create motion cues for zero-value or bookkeeping events", () => {
    expect(keys({ type: "healed", target: { type: "player" }, amount: 0, hp: 5 })).toEqual([]);
    expect(keys({ type: "turnStarted", turn: 2 })).toEqual([]);
    expect(keys({ type: "coinCreated", coin: 9 as never, defId: "fire", zone: "discard" })).toEqual([]);
  });

  it("renders Remise stack and spend badges only for eligible Sorcerer attack cards", () => {
    const stack = renderToStaticMarkup(createElement(RemiseStackChip, { charges: 2 }));
    expect(stack).toContain("르미즈 스택 2/3");
    expect(stack).toContain("르미즈 2/3");

    const skill = contentDb.skills.fente;
    const sorcererBadge = renderToStaticMarkup(
      createElement(RemiseSpendBadge, {
        displaySkillName: "팡트",
        isSorcerer: true,
        loaded: 1,
        remiseCharges: 1,
        skill,
      }),
    );
    expect(sorcererBadge).toContain("르미즈 1 소비 예정");
    expect(sorcererBadge).toContain("팡트 르미즈 1 소비 예정");

    expect(
      renderToStaticMarkup(
        createElement(RemiseSpendBadge, {
          displaySkillName: "팡트",
          isSorcerer: false,
          loaded: 1,
          remiseCharges: 1,
          skill,
        }),
      ),
    ).toBe("");
  });
});
