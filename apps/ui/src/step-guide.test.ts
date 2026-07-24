import { contentDb } from "@game/content";
import type { CombatEvent, CombatState, CoinUid, SlotId } from "@game/core";
import { createCombat, legalCommands } from "@game/core";
import { describe, expect, it } from "vitest";

import { REJECTION_TEXT } from "./action-feedback";
import {
  COMBAT_STEP_LABELS,
  commandRejectionFeedback,
  deriveCombatStep,
  drawNotice,
  loadedStepHelper,
  rejectionStepForReason,
  socketActionLabel,
  socketRejectionFeedback,
} from "./step-guide";

const slot = (value: number): SlotId => value as SlotId;
const boot = (): CombatState =>
  createCombat(
    { character: "warrior" as never, enemies: ["raider" as never] },
    contentDb,
    "step-guide-test",
  );

describe("deriveCombatStep", () => {
  it("highlights selection, placement, and ready steps in priority order", () => {
    expect(
      deriveCombatStep({
        cardSelected: false,
        coinSelected: false,
        loadedCount: 0,
        requiredCount: 1,
      }),
    ).toBe(1);
    expect(
      deriveCombatStep({
        cardSelected: false,
        coinSelected: true,
        loadedCount: 0,
        requiredCount: 1,
      }),
    ).toBe(2);
    expect(
      deriveCombatStep({
        cardSelected: true,
        coinSelected: false,
        loadedCount: 0,
        requiredCount: 1,
      }),
    ).toBe(2);
    expect(
      deriveCombatStep({
        cardSelected: true,
        coinSelected: true,
        loadedCount: 2,
        requiredCount: 2,
      }),
    ).toBe(3);
  });

  it("keeps a partially loaded multi-coin skill on the placement step", () => {
    expect(
      deriveCombatStep({
        cardSelected: true,
        coinSelected: false,
        loadedCount: 1,
        requiredCount: 2,
      }),
    ).toBe(2);
    expect(
      deriveCombatStep({
        cardSelected: false,
        coinSelected: false,
        loadedCount: 0,
        requiredCount: 0,
      }),
    ).toBe(1);
  });

  it("exposes the fixed labels and only shows the loaded helper at step three", () => {
    expect(COMBAT_STEP_LABELS).toEqual([
      "① 동전 선택",
      "② 스킬에 걸기",
      "③ 즉시 사용",
    ]);
    expect(loadedStepHelper(1)).toBeNull();
    expect(loadedStepHelper(2)).toBeNull();
    expect(loadedStepHelper(3)).toBe("소켓을 다시 누르면 해제");
  });
});

describe("drawNotice", () => {
  it("uses the last draw event's actual coin count", () => {
    const events: CombatEvent[] = [
      { type: "coinsDrawn", coins: [1 as CoinUid] },
      {
        type: "coinsDrawn",
        coins: [2 as CoinUid, 3 as CoinUid, 4 as CoinUid],
      },
    ];
    expect(drawNotice(events)).toBe("동전 3개를 뽑았습니다");
  });

  it("names wither when it appears in the same event batch", () => {
    const events: CombatEvent[] = [
      { type: "witherApplied", enemy: 0, amount: 1, nextDrawPenalty: 1 },
      { type: "coinsDrawn", coins: [1 as CoinUid, 2 as CoinUid] },
    ];
    expect(drawNotice(events)).toBe("위축으로 동전 2개를 뽑았습니다");
  });

  it("returns null when the batch has no draw event", () => {
    expect(
      drawNotice([
        { type: "witherApplied", enemy: 0, amount: 1, nextDrawPenalty: 1 },
      ]),
    ).toBeNull();
  });
});

describe("socket guidance", () => {
  it("describes empty and loaded socket actions", () => {
    expect(socketActionLabel({ coinSelected: false, loaded: false })).toBe(
      "손패에서 동전을 먼저 선택",
    );
    expect(socketActionLabel({ coinSelected: true, loaded: false })).toBe(
      "이 스킬에 걸기",
    );
    expect(socketActionLabel({ coinSelected: false, loaded: true })).toBe(
      "누르면 해제",
    );
  });

  it("returns focused feedback only for an empty socket without a selected coin", () => {
    expect(
      socketRejectionFeedback({ coinSelected: false, loaded: false }),
    ).toEqual({ step: 1, text: "손패에서 동전을 먼저 선택" });
    expect(
      socketRejectionFeedback({ coinSelected: true, loaded: false }),
    ).toBeNull();
    expect(
      socketRejectionFeedback({ coinSelected: false, loaded: true }),
    ).toBeNull();
  });
});

describe("commandRejectionFeedback", () => {
  it("maps reusable rejection reasons to their recovery step", () => {
    expect(rejectionStepForReason(REJECTION_TEXT.noFuel)).toBe(1);
    expect(rejectionStepForReason(REJECTION_TEXT.coinNotSelectable)).toBe(1);
    expect(rejectionStepForReason(REJECTION_TEXT.generic)).toBe(3);
  });

  it("reuses action feedback and maps coin failures to the coin-selection step", () => {
    expect(
      commandRejectionFeedback(
        boot(),
        {
          type: "useImmediateFlipSkill",
          slot: slot(0),
          coins: [],
          target: 0,
        },
        contentDb,
      ),
    ).toEqual({ step: 1, text: REJECTION_TEXT.coinCost });
  });

  it("maps other rejected commands to the immediate-use step", () => {
    expect(
      commandRejectionFeedback(
        { ...boot(), phase: "enemy" },
        { type: "endTurn" },
        contentDb,
      ),
    ).toEqual({ step: 3, text: REJECTION_TEXT.notPlayerPhase });
  });

  it("returns no feedback for a legal command", () => {
    const state = boot();
    const command = legalCommands(state, contentDb).find(
      (candidate) => candidate.type === "useImmediateFlipSkill",
    );
    expect(command).toBeDefined();
    expect(commandRejectionFeedback(state, command!, contentDb)).toBeNull();
  });
});
