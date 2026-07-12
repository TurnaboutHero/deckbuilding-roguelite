import { describe, expect, it } from "vitest";

import { CONTENT_VERSION, contentDb } from "@game/content";
import { createRun, generateRunGraph, type RunState } from "@game/core";

import {
  P4_ECONOMY_REPORT_SCHEMA_VERSION,
  resolveShop,
  runP4EconomyReport,
} from "./economy-report";
import { resolveBuildPolicy } from "./run-sim";

describe("P4 economy Monte Carlo report", () => {
  it("builds the small-sample schema golden with eight character x policy cells", () => {
    const report = runP4EconomyReport({ games: 5 });

    expect(report.schemaVersion).toBe(P4_ECONOMY_REPORT_SCHEMA_VERSION);
    expect(report.configuration).toMatchObject({
      games: 5,
      totalRuns: 40,
      combatPolicy: "aggro",
      seedRule: "p45-<node-policy>-<character>-<index>",
      isCiGate: false,
    });
    expect(report.tuningDecision.numericContentChange).toBe("none");
    expect(report.phase3).toEqual({
      conclusionLabels: [
        "engineering-safe",
        "balance-provisional",
        "experience-unverified",
      ],
      reportOnly: true,
    });
    expect(report.cells).toHaveLength(8);
    expect(
      report.cells.map((cell) => `${cell.characterId}/${cell.nodePolicyId}`),
    ).toEqual([
      "warrior/fight-first",
      "warrior/economy-first",
      "guardian/fight-first",
      "guardian/economy-first",
      "sorcerer/fight-first",
      "sorcerer/economy-first",
      "frost-knight/fight-first",
      "frost-knight/economy-first",
    ]);
    for (const cell of report.cells) {
      expect(cell.runs).toBe(5);
      expect(cell.safety.terminalRuns).toBe(5);
      expect(cell.safety.crashRuns).toBe(0);
      expect(cell.safety.invariantViolationCount).toBe(0);
      expect(cell.progression.completedCombats.count).toBe(5);
      expect(cell.purchases.coins.count).toBe(5);
      expect(Object.keys(cell.exposureRate).sort()).toEqual([
        "basic",
        "fire",
        "frost",
        "lightning",
        "mana",
      ]);
    }
  });

  it("replays byte-identically for the same small sample", () => {
    expect(JSON.stringify(runP4EconomyReport({ games: 5 }))).toBe(
      JSON.stringify(runP4EconomyReport({ games: 5 })),
    );
  });
});

describe("bankruptcy definition (D7 문자적 — 2차 감사)", () => {
  const shopRun = (gold: number): RunState => {
    const base = createRun(
      { contentVersion: CONTENT_VERSION, runSeed: "P45-BANKRUPT", character: "warrior" as never },
      contentDb,
    );
    // 단일 상점 노드 그래프로 이동시킨 뒤 정본 가격의 pendingShop을 부여한다
    const graph = generateRunGraph("P45-BANKRUPT", contentDb);
    const shopLayer = graph.layers.findIndex((layer) =>
      layer.length === 1 && layer[0]?.kind === "shop",
    );
    return {
      ...base,
      graph,
      nodeChoices: graph.layers.map(() => 0),
      combatIndex: shopLayer,
      currentHp: 50,
      gold,
      phase: "shop",
      pendingShop: {
        coinOptions: ["fire" as never],
        coinPrices: [50],
        skillOptions: ["smash" as never],
        skillPrices: [50],
      },
    };
  };
  const buildPolicy = resolveBuildPolicy("warrior", "baseline");

  it("부분 구매 방문: 운영 파산 아님·잔여 수요 참 (지표 분리)", () => {
    // 130골드: 제거 75 → 55, 대표 코인 50 → 5, 스킬 50은 불가
    const { run, bankrupt, unmetDemand } = resolveShop(
      shopRun(130),
      buildPolicy,
      new Set(),
    );
    expect(bankrupt).toBe(false);
    expect(unmetDemand).toBe(true);
    expect(run.shopRemovals).toBe(1);
    expect(run.shopPurchasedCoins).toBe(1);
    expect(run.gold).toBe(5);
  });

  it("모든 의도 품목을 소화하면 두 지표 다 거짓", () => {
    // 180골드: 제거 75 + 코인 50 + 스킬 50 = 175 전부 구매
    const { bankrupt, unmetDemand } = resolveShop(
      shopRun(180),
      buildPolicy,
      new Set(),
    );
    expect(bankrupt).toBe(false);
    expect(unmetDemand).toBe(false);
  });

  it("무구매 방문은 운영 파산이자 잔여 수요", () => {
    const { run, bankrupt, unmetDemand } = resolveShop(
      shopRun(10),
      buildPolicy,
      new Set(),
    );
    expect(bankrupt).toBe(true);
    expect(unmetDemand).toBe(true);
    expect(run.shopRemovals).toBe(0);
  });
});
