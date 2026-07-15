// P7 D6 — 점진 튜토리얼 트리거 판정 (순수 함수 계약)
import { describe, expect, it } from "vitest";

import { contentDb } from "@game/content";
import type { CharacterId, CoinDefId, EnemyDefId } from "@game/core";
import { createCombat } from "@game/core";

import { activeTutorialTip, TUTORIAL_TIP_COPY } from "./tutorial";

const id = <T extends string>(value: string): T => value as T;

const freshCombat = () =>
  createCombat(
    {
      character: id<CharacterId>("warrior"),
      enemies: [id<EnemyDefId>("raider")],
      bag: Array.from({ length: 10 }, () => id<CoinDefId>("basic")),
    },
    contentDb,
    "tutorial-test-seed",
  );

describe("activeTutorialTip", () => {
  it("기본 안내는 장전 → 수동 사용·실행 순서 → 선택적 자동 실행을 가르친다", () => {
    const copy = `${TUTORIAL_TIP_COPY["basic-loop"]} ${TUTORIAL_TIP_COPY["turn-flow"]}`;
    expect(copy).toContain("장전");
    expect(copy).toContain("실행 순서");
    expect(copy).toContain("턴 종료");
    expect(copy).toContain("자동 실행");
    expect(copy).toContain("스킬 사용");
    expect(copy).toContain("실행할지 묻고");
  });

  it("첫 전투에서는 기본 루프 팁이 최우선이다", () => {
    const state = freshCombat();
    expect(activeTutorialTip(state, contentDb, new Set(), false)).toBe("basic-loop");
  });

  it("기본 루프를 본 뒤에는 상황이 등장할 때만 다음 팁이 뜬다", () => {
    const raw = freshCombat();
    // 결정론: 손을 기본 코인만 남긴다 (warrior trait가 화염 코인을 섞을 수 있음)
    const basicsOnly = raw.zones.hand.filter(
      (coin) => contentDb.coins[String(raw.coins[Number(coin)]?.defId)]?.element === null,
    );
    const state = { ...raw, zones: { ...raw.zones, hand: basicsOnly } };
    const seen = new Set(["basic-loop"]);
    expect(activeTutorialTip(state, contentDb, seen, false)).toBe("turn-flow");
    const fundamentalsSeen = new Set(["basic-loop", "turn-flow"]);
    expect(activeTutorialTip(state, contentDb, fundamentalsSeen, false)).toBe("piles");
    const basicsSeen = new Set(["basic-loop", "turn-flow", "piles"]);
    // 기본 코인만 든 손 + 쿨다운 없음 → 아무 팁도 없다
    expect(activeTutorialTip(state, contentDb, basicsSeen, false)).toBeNull();
    // 쿨다운 진입 관찰 → cooldown 팁
    const cooled = {
      ...state,
      slots: state.slots.map((slot, index) => (index === 0 ? { ...slot, cooldownRemaining: 1 } : slot)),
    };
    expect(activeTutorialTip(cooled, contentDb, basicsSeen, false)).toBe("cooldown");
  });

  it("보존된 동전이 손에 들어오면 보존 팁을 보여준다", () => {
    const raw = freshCombat();
    const first = raw.zones.hand[0];
    expect(first).toBeDefined();
    const state = {
      ...raw,
      coins: {
        ...raw.coins,
        [Number(first)]: { ...raw.coins[Number(first)]!, preserved: true },
      },
    };
    const seen = new Set(["basic-loop", "turn-flow", "piles", "cooldown", "element-coin", "two-sided"]);
    expect(activeTutorialTip(state, contentDb, seen, false)).toBe("preserve");
  });

  it("소비 연료 선택이 열리면 consume 팁이 뜬다", () => {
    const state = freshCombat();
    const seen = new Set(["basic-loop", "turn-flow", "piles", "cooldown", "element-coin", "two-sided", "preserve"]);
    expect(activeTutorialTip(state, contentDb, seen, true)).toBe("consume");
    expect(activeTutorialTip(state, contentDb, seen, false)).toBeNull();
  });

  it("모든 팁을 보면 아무것도 뜨지 않는다", () => {
    const state = freshCombat();
    const seen = new Set([
      "basic-loop",
      "turn-flow",
      "piles",
      "cooldown",
      "element-coin",
      "two-sided",
      "preserve",
      "consume",
    ]);
    expect(activeTutorialTip(state, contentDb, seen, true)).toBeNull();
  });
});
