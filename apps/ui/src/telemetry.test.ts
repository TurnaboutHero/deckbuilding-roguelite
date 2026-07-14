import { contentDb } from "@game/content";
import type { CoinUid, CombatState, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  beginHumanCombat,
  createHumanRunTrace,
  downloadHumanRunTrace,
  finishHumanCombat,
  finishHumanRun,
  recordHumanDecision,
  recordHumanReward,
  sanitizeHumanRunTrace,
} from "./telemetry";
import type { HumanRunTrace, LocalDownloadPort } from "./telemetry";

const fixedStart = new Date(2026, 6, 10, 20, 30, 40, 123);
const fixedEnd = new Date(2026, 6, 10, 20, 45, 50, 456);

const bootCombat = (): CombatState =>
  createCombat(
    { character: "warrior" as never, enemies: ["raider" as never] },
    contentDb,
    "telemetry-seed",
  );

const withOneDecision = (): {
  trace: HumanRunTrace;
  combat: CombatState;
} => {
  const combat = bootCombat();
  const coin = combat.zones.hand[0];
  if (coin === undefined) throw new Error("missing test coin");
  const command = {
    type: "placeCoin" as const,
    coin: coin as CoinUid,
    slot: 0 as SlotId,
  };
  const result = step(combat, command, contentDb);
  if (!result.ok) throw new Error(result.error);
  const started = beginHumanCombat(
    createHumanRunTrace({
      runSeed: "telemetry-seed",
      contentVersion: "test-content",
      maxHp: combat.player.maxHp,
      startedAt: fixedStart,
    }),
    { combatIndex: 0, attempt: 0, combat },
  );
  return {
    trace: recordHumanDecision(started, {
      combatIndex: 0,
      attempt: 0,
      before: combat,
      commands: [command],
      after: result.state,
      events: result.events,
    }),
    combat: result.state,
  };
};

const terminalTrace = (): HumanRunTrace => {
  const { trace, combat } = withOneDecision();
  const won: CombatState = {
    ...combat,
    phase: "victory",
    player: { ...combat.player, hp: 47 },
    enemies: combat.enemies.map((enemy) => ({ ...enemy, hp: 0 })),
  };
  const completed = finishHumanCombat(trace, 0, 0, won);
  const rewarded = recordHumanReward(completed, {
    combatIndex: 0,
    stage: "coin",
    options: ["basic", "fire", "mana"],
    choice: "fire",
    resolution: "selected",
  });
  return finishHumanRun(rewarded, {
    result: "victory",
    finalHp: 47,
    maxHp: won.player.maxHp,
    endedAt: fixedEnd,
  });
};

describe("human telemetry capture", () => {
  it("records only core command/event/state facts with a versioned schema", () => {
    const trace = terminalTrace();
    const initial = bootCombat();
    expect(trace).toMatchObject({
      // P6: UI 텔레메트리 스키마 v3 (rest/treasure/passive-reward 경로 사실 가산)
      schemaVersion: 3,
      source: "human",
      runSeed: "telemetry-seed",
      contentVersion: "test-content",
      buildId: "m6-ui-local-telemetry",
      startedAtLocal: "2026-07-10T20:30:40.123",
      maxHp: initial.player.maxHp,
      result: "victory",
      endedAtLocal: "2026-07-10T20:45:50.456",
      finalHp: 47,
      rewards: [
        {
          combatIndex: 0,
          stage: "coin",
          options: ["basic", "fire", "mana"],
          choice: "fire",
          resolution: "selected",
        },
      ],
    });
    expect(trace.combats).toHaveLength(1);
    expect(trace.combats[0]).toMatchObject({
      combatIndex: 0,
      attempt: 0,
      enemyIds: ["raider"],
      startingHp: initial.player.hp,
      maxHp: initial.player.maxHp,
      outcome: {
        result: "victory",
        playerHp: 47,
        enemyHp: [0],
      },
    });
    expect(trace.combats[0]?.decisions[0]).toEqual({
      turn: 1,
      commands: [{ type: "placeCoin", coin: expect.any(Number), slot: 0 }],
      skills: [],
      flips: [],
      damage: [],
      hp: {
        playerBefore: initial.player.hp,
        playerAfter: initial.player.hp,
        enemiesBefore: initial.enemies.map((enemy) => enemy.hp),
        enemiesAfter: initial.enemies.map((enemy) => enemy.hp),
      },
    });
  });

  it("captures flip, damage, and HP deltas only from the returned core events/state", () => {
    const { trace: placed, combat } = withOneDecision();
    const command = {
      type: "useFlipSkill" as const,
      slot: 0 as SlotId,
      target: 0,
    };
    const result = step(combat, command, contentDb);
    if (!result.ok) throw new Error(result.error);
    const trace = recordHumanDecision(placed, {
      combatIndex: 0,
      attempt: 0,
      before: combat,
      commands: [command],
      after: result.state,
      events: result.events,
    });
    const fact = trace.combats[0]?.decisions[1];
    expect(fact?.commands).toEqual([
      { type: "useFlipSkill", slot: 0, target: 0 },
    ]);
    // P6 D5: 화염 격투가 시작 슬롯 0은 slash → jab (정권)
    expect(fact?.skills).toEqual([{ slot: 0, skill: "jab", kind: "flip" }]);
    expect(fact?.flips).toEqual(
      result.events
        .filter((event) => event.type === "coinFlipped")
        .map((event) => ({ coin: Number(event.coin), face: event.face })),
    );
    expect(fact?.damage).toEqual(
      result.events
        .filter((event) => event.type === "damageDealt")
        .map((event) => ({
          target: event.target.type,
          ...(event.target.type === "enemy"
            ? { enemyIndex: event.target.index }
            : {}),
          amount: event.amount,
          blocked: event.blocked,
          source: event.source,
        })),
    );
    expect(fact?.hp).toEqual({
      playerBefore: combat.player.hp,
      playerAfter: result.state.player.hp,
      enemiesBefore: combat.enemies.map((enemy) => enemy.hp),
      enemiesAfter: result.state.enemies.map((enemy) => enemy.hp),
    });
  });
});

describe("telemetry sanitization and local export", () => {
  it("rebuilds the export from the schema whitelist and drops identity/environment keys", () => {
    const trace = terminalTrace();
    const hostile = {
      ...trace,
      email: "player@example.com",
      userName: "player",
      machineId: "machine",
      os: "example-os",
      browser: "example-browser",
      absolutePath: "C:/private",
      combats: trace.combats.map((combat) => ({
        ...combat,
        userAgent: "example-agent",
        decisions: combat.decisions.map((decision) => ({
          ...decision,
          stack: "private stack",
        })),
      })),
    };
    const sanitized = sanitizeHumanRunTrace(hostile);
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          visit(child);
        }
      }
    };
    visit(sanitized);
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("userName");
    expect(keys).not.toContain("machineId");
    expect(keys).not.toContain("os");
    expect(keys).not.toContain("browser");
    expect(keys).not.toContain("userAgent");
    expect(keys).not.toContain("absolutePath");
    expect(keys).not.toContain("stack");
  });

  it("creates one JSON Blob, clicks explicitly, and always revokes its object URL", async () => {
    const trace = terminalTrace();
    let exportedBlob: Blob | undefined;
    const port: LocalDownloadPort = {
      createObjectUrl: vi.fn((blob) => {
        exportedBlob = blob;
        return "blob:local-play-log";
      }),
      clickDownload: vi.fn(),
      revokeObjectUrl: vi.fn(),
    };
    const exported = downloadHumanRunTrace(trace, port);
    expect(exported.filename).toMatch(
      /^play-log-telemetry-seed-2026-07-10T20-30-40-123\.json$/,
    );
    expect(port.clickDownload).toHaveBeenCalledOnce();
    expect(port.clickDownload).toHaveBeenCalledWith(
      "blob:local-play-log",
      exported.filename,
    );
    expect(port.revokeObjectUrl).toHaveBeenCalledWith("blob:local-play-log");
    expect(exportedBlob?.type).toBe("application/json;charset=utf-8");
    expect(await exportedBlob?.text()).toBe(exported.json);
    expect(JSON.parse(exported.json)).toEqual(sanitizeHumanRunTrace(trace));
  });

  it("revokes the object URL even if the browser click fails", () => {
    const port: LocalDownloadPort = {
      createObjectUrl: () => "blob:must-revoke",
      clickDownload: () => {
        throw new Error("click failed");
      },
      revokeObjectUrl: vi.fn(),
    };
    expect(() => downloadHumanRunTrace(terminalTrace(), port)).toThrow(
      "click failed",
    );
    expect(port.revokeObjectUrl).toHaveBeenCalledWith("blob:must-revoke");
  });

  it("rejects malformed or non-terminal traces before creating a Blob", () => {
    const createObjectUrl = vi.fn(() => "blob:unused");
    const port: LocalDownloadPort = {
      createObjectUrl,
      clickDownload: vi.fn(),
      revokeObjectUrl: vi.fn(),
    };
    const inProgress = createHumanRunTrace({
      runSeed: "pending",
      contentVersion: "test-content",
      maxHp: 50,
      startedAt: fixedStart,
    });
    expect(() => downloadHumanRunTrace(inProgress, port)).toThrow(
      "only a terminal human run can be exported",
    );
    expect(() =>
      sanitizeHumanRunTrace({ ...terminalTrace(), schemaVersion: 999 }),
    ).toThrow("trace.schemaVersion is unsupported");
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("contains no network transport or environment-fingerprint access path", () => {
    const source = readFileSync(
      new URL("./telemetry.ts", import.meta.url),
      "utf8",
    );
    const forbiddenPatterns = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bsendBeacon\b/,
      /\bnavigator\b/,
      /\buserAgent\b/,
    ];
    for (const pattern of forbiddenPatterns)
      expect(source).not.toMatch(pattern);
  });
});
