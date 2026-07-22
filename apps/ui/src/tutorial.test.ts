import { contentDb } from "@game/content";
import type { CharacterId, CoinDefId, EnemyDefId } from "@game/core";
import { createCombat } from "@game/core";
import { describe, expect, it } from "vitest";

import { activeTutorialTip, TUTORIAL_TIP_COPY } from "./tutorial";

const id = <T extends string>(value: string): T => value as T;
const freshCombat = () => createCombat({
  character: id<CharacterId>("warrior"),
  enemies: [id<EnemyDefId>("raider")],
  bag: Array.from({ length: 10 }, () => id<CoinDefId>("basic")),
}, contentDb, "tutorial-test-seed");

describe("activeTutorialTip", () => {
  it("teaches draw three and immediate betting without reservation language", () => {
    const copy = `${TUTORIAL_TIP_COPY["basic-loop"]} ${TUTORIAL_TIP_COPY["coin-bet"]} ${TUTORIAL_TIP_COPY["turn-flow"]}`;
    expect(copy).toContain("동전 3개");
    expect(copy).toContain("즉시 사용");
    expect(copy).toContain("행동을 미리 저장하거나 행동 확정 단계를 거칠 필요는 없습니다");
    expect(copy).not.toContain("자동 배치");
  });

  it("shows the fixed onboarding sequence once per tip", () => {
    const state = freshCombat();
    expect(activeTutorialTip(state, contentDb, new Set(), false)).toBe("basic-loop");
    expect(activeTutorialTip(state, contentDb, new Set(["basic-loop"]), false)).toBe("coin-bet");
    expect(activeTutorialTip(state, contentDb, new Set(["basic-loop", "coin-bet"]), false)).toBe("piles");
  });

  it("shows contextual cooldown, preserve, and consume tips after fundamentals", () => {
    const raw = freshCombat();
    const fundamentals = new Set(["basic-loop", "coin-bet", "piles"]);
    const cooled = { ...raw, slots: raw.slots.map((slot, index) => index === 0 ? { ...slot, cooldownRemaining: 1 } : slot) };
    expect(activeTutorialTip(cooled, contentDb, fundamentals, false)).toBe("cooldown");

    const first = raw.zones.hand[0]!;
    const preserved = { ...raw, coins: { ...raw.coins, [Number(first)]: { ...raw.coins[Number(first)]!, preserved: true } } };
    const throughElements = new Set([...fundamentals, "cooldown", "element-coin", "two-sided"]);
    expect(activeTutorialTip(preserved, contentDb, throughElements, false)).toBe("preserve");

    const throughPreserve = new Set([...throughElements, "preserve"]);
    expect(activeTutorialTip(raw, contentDb, throughPreserve, true)).toBe("consume");
  });
});
