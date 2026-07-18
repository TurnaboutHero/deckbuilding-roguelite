import { contentDb } from "@game/content";
import type { CoinUid, CombatState, Command, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it, vi } from "vitest";

import telemetrySource from "./telemetry.ts?raw";
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
  const coin = combat.zones.hand.find(
    (candidate) => combat.coins[Number(candidate)]?.defId === "basic",
  );
  if (coin === undefined) throw new Error("missing basic test coin");
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
  it("preserves explicit combat choices and the optional decision source", () => {
    const combat = bootCombat();
    const started = beginHumanCombat(
      createHumanRunTrace({
        runSeed: "telemetry-explicit",
        contentVersion: "test-content",
        maxHp: combat.player.maxHp,
        startedAt: fixedStart,
      }),
      { combatIndex: 0, attempt: 0, combat },
    );
    const coin = combat.zones.hand[0];
    if (coin === undefined) throw new Error("missing test coin");
    const commands: Command[] = [
      {
        type: "useFlipSkill",
        slot: 0 as SlotId,
        target: 1,
        chosen: [coin],
        desiredCoin: "fire" as never,
        chosenEquipment: "mana-shield" as never,
        chosenSummon: 7,
      },
      {
        type: "useConsumeSkill",
        slot: 1 as SlotId,
        coins: [coin],
        target: 0,
        desiredCoin: "mana" as never,
        chosenSummon: 9,
      },
      { type: "endTurn", preserve: [coin] },
    ];

    const trace = recordHumanDecision(started, {
      combatIndex: 0,
      attempt: 0,
      before: combat,
      commands,
      after: combat,
      events: [],
      source: "auto-turn-end",
    });

    expect(trace.combats[0]?.decisions[0]).toMatchObject({
      source: "auto-turn-end",
      commands: [
        {
          type: "useFlipSkill",
          slot: 0,
          target: 1,
          chosen: [Number(coin)],
          desiredCoin: "fire",
          chosenEquipment: "mana-shield",
          chosenSummon: 7,
        },
        {
          type: "useConsumeSkill",
          slot: 1,
          coins: [Number(coin)],
          target: 0,
          desiredCoin: "mana",
          chosenSummon: 9,
        },
        { type: "endTurn", preserve: [Number(coin)] },
      ],
    });
    expect(sanitizeHumanRunTrace(trace)).toEqual(trace);

    const legacy = structuredClone(trace) as unknown as {
      combats: Array<{ decisions: Array<{ source?: string }> }>;
    };
    delete legacy.combats[0]?.decisions[0]?.source;
    expect(
      sanitizeHumanRunTrace(legacy).combats[0]?.decisions[0]?.source,
    ).toBeUndefined();
  });

  it("records only core command/event/state facts with a versioned schema", () => {
    const trace = terminalTrace();
    const initial = bootCombat();
    expect(trace).toMatchObject({
      // P6: UI 텔레메트리 스키마 v3 (rest/treasure/passive-reward 경로 사실 가산)
      schemaVersion: 5,
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
        enemyFurnaceBefore: initial.enemies.map((enemy) => enemy.furnaceTemperature ?? 0),
        enemyFurnaceAfter: initial.enemies.map((enemy) => enemy.furnaceTemperature ?? 0),
        enemyRoyalVaultBefore: [],
        enemyRoyalVaultAfter: [],
        enemyLeadBefore: [],
        enemyLeadAfter: [],
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
      enemyFurnaceBefore: combat.enemies.map((enemy) => enemy.furnaceTemperature ?? 0),
      enemyFurnaceAfter: result.state.enemies.map((enemy) => enemy.furnaceTemperature ?? 0),
      enemyRoyalVaultBefore: [],
      enemyRoyalVaultAfter: [],
      enemyLeadBefore: [],
      enemyLeadAfter: [],
    });
  });

  it("captures furnace changes even when every enemy HP value is unchanged", () => {
    const combat = bootCombat();
    const before = {
      ...combat,
      enemies: combat.enemies.map((enemy) => ({ ...enemy, furnaceTemperature: 6 })),
    } as CombatState;
    const after = {
      ...before,
      enemies: before.enemies.map((enemy) => ({ ...enemy, furnaceTemperature: 3 })),
    } as CombatState;
    const started = beginHumanCombat(
      createHumanRunTrace({
        runSeed: "telemetry-furnace",
        contentVersion: "test-content",
        maxHp: before.player.maxHp,
        startedAt: fixedStart,
      }),
      { combatIndex: 0, attempt: 0, combat: before },
    );

    const trace = recordHumanDecision(started, {
      combatIndex: 0,
      attempt: 0,
      before,
      commands: [],
      after,
      events: [],
    });

    expect(trace.combats[0]?.decisions[0]?.hp).toMatchObject({
      enemiesBefore: before.enemies.map((enemy) => enemy.hp),
      enemiesAfter: after.enemies.map((enemy) => enemy.hp),
      enemyFurnaceBefore: [6],
      enemyFurnaceAfter: [3],
    });
  });

  it("captures complete ordered vault, cancellation, and active Lead facts before and after a custody-only change", () => {
    const base = createCombat(
      { character: "warrior" as never, enemies: ["uncrowned-coin-king-aurel" as never] },
      contentDb,
      "telemetry-aurel",
    );
    const [first, second, third] = base.zones.hand;
    const crown = contentDb.enemies["uncrowned-coin-king-aurel"]?.royalVault?.atCapacityIntent;
    if (first === undefined || second === undefined || third === undefined || crown === undefined) throw new Error("missing Aurel setup");
    const before: CombatState = {
      ...base,
      custody: [
        { sourceEnemy: 0, sourceEnemyUid: base.enemies[0]!.enemyUid, kind: "royalVault", element: "fire", seizureOrder: 1, coins: [first] },
        { sourceEnemy: 0, sourceEnemyUid: base.enemies[0]!.enemyUid, kind: "royalVault", element: "frost", seizureOrder: 2, coins: [second] },
      ],
      enemies: base.enemies.map((enemy) => ({ ...enemy, intent: crown, windup: { intent: crown, turnsLeft: 1, startHp: enemy.hp }, royalVaultSeizure: { nominated: [third], capacity: 6 }, royalVaultRecoveredThisWindup: 1, leadDecree: { initial: 3, remaining: 3, active: true, weakenedThisTurn: 0, weakenedTotal: 0 } })),
    };
    const after: CombatState = {
      ...before,
      custody: [...before.custody, { sourceEnemy: 0, sourceEnemyUid: before.enemies[0]!.enemyUid, kind: "royalVault", element: "fire", seizureOrder: 3, coins: [third] }],
      enemies: before.enemies.map((enemy) => ({ ...enemy, windup: undefined, royalVaultSeizure: undefined, royalVaultRecoveredThisWindup: 2, cancelledWindupIntentId: crown.id, leadDecree: { initial: 3, remaining: 1, weakenedThisTurn: 2, weakenedTotal: 2 } })),
    };
    const started = beginHumanCombat(
      createHumanRunTrace({ runSeed: "telemetry-aurel", contentVersion: "test-content", maxHp: before.player.maxHp, startedAt: fixedStart }),
      { combatIndex: 0, attempt: 0, combat: before },
    );
    const trace = recordHumanDecision(started, { combatIndex: 0, attempt: 0, before, commands: [], after, events: [] });

    expect(trace.combats[0]?.decisions[0]?.hp).toMatchObject({
      enemyRoyalVaultBefore: [{ sourceEnemyUid: before.enemies[0]!.enemyUid, coins: [Number(first), Number(second)], nominated: [Number(third)], recovered: 1, cancelOn: [{ kind: "vaultCoinsRecovered", count: 2 }, { kind: "skillDamage", threshold: 10 }] }],
      enemyRoyalVaultAfter: [{ sourceEnemyUid: before.enemies[0]!.enemyUid, coins: [Number(first), Number(second), Number(third)], nominated: [], recovered: 2, cancelOn: [], cancelledWindupIntentId: crown.id }],
      enemyLeadBefore: [{ sourceEnemyUid: before.enemies[0]!.enemyUid, initial: 3, remaining: 3, active: true, weakenedThisTurn: 0, weakenedTotal: 0 }],
      enemyLeadAfter: [{ sourceEnemyUid: before.enemies[0]!.enemyUid, initial: 3, remaining: 1, active: false, weakenedThisTurn: 2, weakenedTotal: 2 }],
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
    const forbiddenPatterns = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bsendBeacon\b/,
      /\bnavigator\b/,
      /\buserAgent\b/,
    ];
    for (const pattern of forbiddenPatterns)
      expect(telemetrySource).not.toMatch(pattern);
  });
});
