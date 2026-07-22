import { contentDb } from "@game/content";
import { describe, expect, it } from "vitest";

import { coinNameFor, coinRewardDetailFor } from "./coin-info";

describe("coinRewardDetailFor v4.5", () => {
  it("describes every authoritative coin face without generic placeholders", () => {
    expect(coinRewardDetailFor(contentDb, "basic")).toBe("앞면 피해 4 · 뒷면 방어 +4");
    expect(coinRewardDetailFor(contentDb, "fire")).toBe("앞면 피해 3 + 화상 +2 · 뒷면 방어 +3 + 대상이 화상이면 피해 2");
    expect(coinRewardDetailFor(contentDb, "mana")).toBe("앞면 버림 더미에 임시 기본 코인 +1 · 뒷면 다음 턴 뽑기 +1");
    expect(coinRewardDetailFor(contentDb, "frost")).toBe("앞면 동상 +2 · 뒷면 방어 +3 + 다음 턴 방어 +2");
    expect(coinRewardDetailFor(contentDb, "lightning")).toBe("앞면 고정 피해 3 · 뒷면 감전 +2");
    expect(coinRewardDetailFor(contentDb, "blood")).toBe("앞면 체력 2 상실 + 피해 7 · 뒷면 출혈 +2");
  });
});

describe("coinNameFor", () => {
  it("uses the player-facing element names", () => {
    expect(coinNameFor(contentDb, "frost")).toBe("냉기 코인");
    expect(coinNameFor(contentDb, "lightning")).toBe("전기 코인");
    expect(coinNameFor(contentDb, "blood")).toBe("혈액 코인");
    expect(coinNameFor(contentDb, "basic")).toBe("기본 코인");
  });
});
