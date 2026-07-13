import { contentDb } from "@game/content";
import type { CoinUid, CombatState, SlotId } from "@game/core";
import { createCombat, step } from "@game/core";
import { describe, expect, it } from "vitest";

import { REJECTION_TEXT, cooldownReason, rejectionReason } from "./action-feedback";

const slot = (value: number): SlotId => value as SlotId;

// P9 워리어 슬롯: 0 정권 / 1 가드 / 2 불꽃 스트레이트 / 3 잿불 베기 / 4~7 빈 슬롯
const boot = (): CombatState =>
  createCombat(
    { character: "warrior" as never, enemies: ["raider" as never] },
    contentDb,
    "feedback-test",
  );

const firstHandCoin = (state: CombatState): CoinUid => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error("missing hand coin");
  return coin;
};

const placeFirst = (
  state: CombatState,
  slotIndex: number,
): { state: CombatState; coin: CoinUid } => {
  const coin = firstHandCoin(state);
  const result = step(
    state,
    { type: "placeCoin", coin, slot: slot(slotIndex) },
    contentDb,
  );
  if (!result.ok) throw new Error(result.error);
  return { state: result.state, coin };
};

const withSlotState = (
  state: CombatState,
  slotIndex: number,
  patch: Partial<CombatState["slots"][number]>,
): CombatState => ({
  ...state,
  slots: state.slots.map((candidate, index) =>
    index === slotIndex ? { ...candidate, ...patch } : candidate,
  ),
});

describe("rejectionReason", () => {
  it("returns null for legal commands", () => {
    const state = boot();
    expect(
      rejectionReason(
        state,
        { type: "placeCoin", coin: firstHandCoin(state), slot: slot(0) },
        contentDb,
      ),
    ).toBeNull();
  });

  it("classifies non-player phase or resolution state", () => {
    const state = { ...boot(), phase: "enemy" as const };
    expect(rejectionReason(state, { type: "endTurn" }, contentDb)).toBe(
      REJECTION_TEXT.notPlayerPhase,
    );
  });

  // P7 D1 — 턴당 3회 캡 폐지: 봉인 사유는 스킬별 쿨다운 잔여 턴으로 서술한다
  it("classifies a multi-turn cooldown with the remaining turns", () => {
    const { state } = placeFirst(boot(), 2);
    expect(
      rejectionReason(
        withSlotState(state, 2, { cooldownRemaining: 2 }),
        { type: "useFlipSkill", slot: slot(2), target: 0 },
        contentDb,
      ),
    ).toBe(cooldownReason(2));
    expect(cooldownReason(2)).toBe("재사용 대기 2턴");
  });

  // 구 '이번 턴에 이미 썼다' 케이던스 = 쿨다운 1 (다음 턴 시작에 다시 가용)
  it("classifies a skill cooling down until next turn", () => {
    const { state } = placeFirst(boot(), 0);
    expect(
      rejectionReason(
        withSlotState(state, 0, { cooldownRemaining: 1 }),
        { type: "useFlipSkill", slot: slot(0), target: 0 },
        contentDb,
      ),
    ).toBe("재사용 대기 1턴");
  });

  it("classifies a once-per-combat lock", () => {
    // 워리어 시작 셋에는 전투당 1회 스킬이 없다 — 빈 슬롯에 화염 폭주를 합성 장착
    const state = withSlotState(boot(), 4, {
      skillId: "flame-rampage" as never,
      cooldownRemaining: 0,
      usedThisCombat: true,
    });
    expect(
      rejectionReason(
        state,
        { type: "useFlipSkill", slot: slot(4) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.usedThisCombat);
  });

  // P7 D2 — 슬롯 8, 시작 4스킬: 뒷 슬롯은 비어 있고 사용 불가 사유가 구분된다
  it("classifies an empty slot", () => {
    expect(
      rejectionReason(
        boot(),
        { type: "useFlipSkill", slot: slot(5) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.emptySlot);
  });

  it("classifies a full socket when placing another coin", () => {
    const { state } = placeFirst(boot(), 0);
    expect(
      rejectionReason(
        state,
        { type: "placeCoin", coin: firstHandCoin(state), slot: slot(0) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.socketFull);
  });

  it("classifies insufficient placed coins for flip cost", () => {
    const { state } = placeFirst(boot(), 2);
    expect(
      rejectionReason(
        state,
        { type: "useFlipSkill", slot: slot(2), target: 0 },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.coinCost);
  });

  it("classifies missing consume fuel in hand", () => {
    const state = withSlotState({
      ...boot(),
      coins: Object.fromEntries(
        Object.entries(boot().coins).map(([key, coin]) => [
          key,
          { ...coin, defId: "basic" as never, grants: [] },
        ]),
      ),
    }, 4, { skillId: "inner-passion" as never });
    expect(
      rejectionReason(
        state,
        { type: "useConsumeSkill", slot: slot(4), coins: [], target: 0 },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.noFuel);
  });

  it("classifies a coin that cannot be selected", () => {
    expect(
      rejectionReason(
        boot(),
        { type: "placeCoin", coin: 999 as CoinUid, slot: slot(0) },
        contentDb,
      ),
    ).toBe(REJECTION_TEXT.coinNotSelectable);
  });
});
