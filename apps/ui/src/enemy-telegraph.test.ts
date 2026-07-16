import { describe, expect, it, vi } from "vitest";
import type { CombatState } from "@game/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntentBadge, UnitPanel } from "./App";
import { KEYWORD_GLOSSARY } from "./keywords";

const enemy = (overrides: Partial<CombatState["enemies"][number]>): CombatState["enemies"][number] => ({
  block: 0,
  defId: "silverbell-healer" as never,
  hp: 20,
  intent: { id: "idle", actions: [] },
  intentIndex: 0,
  maxHp: 30,
  nextAttackBonus: 0,
  statuses: {},
  ...overrides,
});

const sprite = {
  atlasUrl: "about:blank",
  manifest: {
    animation: { rows: { idle: { frames: 1, fps: 1, loop: true } } },
    frame_layout: { sheetHeight: 1, sheetWidth: 1, rows: { idle: [{ h: 1, w: 1, x: 0, y: 0 }] } },
  },
};

describe("enemy telegraph UI", () => {
  it("renders windup countdown, forecast, cancel threshold, vulnerability and bound heal target", () => {
    const mend = {
      id: "silver-mend",
      cancelOn: { damageThreshold: 10 },
      vulnerableWhileWindup: 1.5,
      actions: [{ kind: "healAlly" as const, amount: 12, target: "lowestHpAlly" as const }],
    };
    const html = renderToStaticMarkup(
      createElement(IntentBadge, {
        enemies: [
          enemy({
            boundHealAlly: 1,
            intent: mend,
            windup: { boundHealAlly: 1, cancelThreshold: 10, intent: mend, startHp: 20, turnsLeft: 1 },
          }),
          enemy({ defId: "chalice-thrall" as never }),
        ],
        enemy: enemy({
          boundHealAlly: 1,
          intent: mend,
          windup: { boundHealAlly: 1, cancelThreshold: 10, intent: mend, startHp: 20, turnsLeft: 1 },
        }),
      }),
    );

    expect(html).toContain("준비 1턴");
    expect(html).toContain("10 피해로 취소");
    expect(html).toContain("취약 ×1.5");
    expect(html).toContain("회복 12");
    expect(html).toContain("붉은성배 흡혈귀 시종");
  });

  it("renders enemy phase and growth chips without index selectors", () => {
    vi.stubGlobal("window", {
      clearTimeout,
      matchMedia: () => ({ addEventListener: () => undefined, matches: true, removeEventListener: () => undefined }),
      setTimeout,
    });
    const html = renderToStaticMarkup(
      createElement(UnitPanel, {
        block: 0,
        floats: [],
        growthStacks: 3,
        hp: 20,
        maxHp: 30,
        motion: "idle",
        name: "쇠사슬 광전사",
        phaseIndex: 0,
        playKey: 0,
        side: "enemy",
        sprite,
        statuses: {},
        unitKey: "enemy-0",
        vfx: new Set<string>(),
      }),
    );

    expect(html).toContain("광란 1");
    expect(html).toContain("성장 3");
  });

  it("defines glossary entries for telegraph terms", () => {
    expect(KEYWORD_GLOSSARY.windup.label).toBe("준비(예고)");
    expect(KEYWORD_GLOSSARY.vulnerable.label).toBe("취약");
    expect(KEYWORD_GLOSSARY.frenzy.label).toBe("광란(페이즈)");
    expect(KEYWORD_GLOSSARY.growth.label).toBe("성장");
  });
});
