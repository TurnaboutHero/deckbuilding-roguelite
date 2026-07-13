import { contentDb } from "@game/content";
import type {
  CoinUid,
  CombatEvent,
  CombatState,
  RunState,
  SlotId,
} from "@game/core";
import { createCombat, createRun, step } from "@game/core";
import { describe, expect, it } from "vitest";

import {
  coinFacesAfterEvent,
  dragTargetSlots,
  drawPileComposition,
  dropCommands,
  pileComposition,
  rewardViewStage,
  stepSequence,
} from "./interaction";

const slot = (value: number): SlotId => value as SlotId;

const boot = (): CombatState =>
  createCombat(
    { character: "warrior" as never, enemies: ["raider" as never] },
    contentDb,
    "interaction-test",
  );

const placeFirst = (
  state: CombatState,
  slotIndex: number,
): { state: CombatState; coin: CoinUid } => {
  const coin = state.zones.hand[0];
  if (coin === undefined) throw new Error("missing hand coin");
  const result = step(
    state,
    { type: "placeCoin", coin, slot: slot(slotIndex) },
    contentDb,
  );
  if (!result.ok) throw new Error(result.error);
  return { state: result.state, coin };
};

const rewardRun = (
  flags: Pick<
    NonNullable<RunState["pendingRewards"]>,
    "coinChoiceResolved" | "coinRemovalResolved" | "skillChoiceResolved"
  >,
): RunState => ({
  ...createRun(
    {
      contentVersion: "interaction-test",
      runSeed: "reward-view",
      character: "warrior" as never,
    },
    contentDb,
  ),
  phase: "rewards",
  pendingRewards: { coinOptions: [], skillOptions: [], ...flags },
});

describe("rewardViewStage — 코어 보상 플래그의 UI 단계 투영", () => {
  it("런 보상 순서를 코인 → 제거 → 스킬로 표시한다", () => {
    expect(
      rewardViewStage(
        rewardRun({
          coinChoiceResolved: false,
          coinRemovalResolved: false,
          skillChoiceResolved: false,
        }),
      ),
    ).toBe("coin");
    expect(
      rewardViewStage(
        rewardRun({
          coinChoiceResolved: true,
          coinRemovalResolved: false,
          skillChoiceResolved: false,
        }),
      ),
    ).toBe("removal");
    expect(
      rewardViewStage(
        rewardRun({
          coinChoiceResolved: true,
          coinRemovalResolved: true,
          skillChoiceResolved: false,
        }),
      ),
    ).toBe("skill");
  });

  it("B2 소진 스킬 풀의 두 번째 코인 단계를 명시적으로 표시한다 (레거시 그래프 한정)", () => {
    const run = rewardRun({
      coinChoiceResolved: false,
      coinRemovalResolved: true,
      skillChoiceResolved: true,
    });
    // v5 소진 풀 대체 코인은 레거시(acts 부재) 그래프 전용 — P6 그래프에서 같은
    // 플래그 형상은 일반 코인 단계다 (하네스 감사 오분류 수정 고정)
    const legacy = { ...run, graph: { layers: run.graph.layers } };
    expect(rewardViewStage(legacy)).toBe("fallback-coin");
    expect(rewardViewStage(run)).toBe("coin");
  });

  it("보상 단계가 아니거나 모든 선택이 끝나면 패널이 없다", () => {
    const ready = createRun(
      {
        contentVersion: "interaction-test",
        runSeed: "ready-view",
        character: "warrior" as never,
      },
      contentDb,
    );
    expect(rewardViewStage(ready)).toBeNull();
    expect(
      rewardViewStage(
        rewardRun({
          coinChoiceResolved: true,
          coinRemovalResolved: true,
          skillChoiceResolved: true,
        }),
      ),
    ).toBeNull();
  });
});

describe("coinFacesAfterEvent — 면 기록 수명주기", () => {
  it("coinFlipped가 면을 기록한다", () => {
    const faces = coinFacesAfterEvent(
      {},
      { type: "coinFlipped", coin: 3 as CoinUid, face: "heads" },
    );
    expect(faces[3]).toBe("heads");
  });

  it("같은 코인의 재플립이 면을 덮어쓴다", () => {
    const first = coinFacesAfterEvent(
      {},
      { type: "coinFlipped", coin: 3 as CoinUid, face: "heads" },
    );
    const second = coinFacesAfterEvent(first, {
      type: "coinFlipped",
      coin: 3 as CoinUid,
      face: "tails",
    });
    expect(second[3]).toBe("tails");
  });

  it("플립되지 않은 이벤트는 기록을 바꾸지 않는다 (참조 유지)", () => {
    const faces = { 3: "heads" } as const;
    const next = coinFacesAfterEvent(faces, { type: "turnStarted", turn: 2 });
    expect(next).toBe(faces);
  });

  it("다시 뽑힌 코인의 낡은 면은 지워진다 — 뽑힌 동전은 아직 안 굴린 동전이다", () => {
    const flipped = coinFacesAfterEvent(
      {},
      { type: "coinFlipped", coin: 3 as CoinUid, face: "heads" },
    );
    const drawn: CombatEvent = {
      type: "coinsDrawn",
      coins: [3 as CoinUid, 4 as CoinUid],
    };
    const next = coinFacesAfterEvent(flipped, drawn);
    expect(next[3]).toBeUndefined();
    expect(Object.keys(next)).toHaveLength(0);
  });

  it("무관한 코인 드로우는 기존 면을 보존한다", () => {
    const flipped = coinFacesAfterEvent(
      {},
      { type: "coinFlipped", coin: 3 as CoinUid, face: "tails" },
    );
    const next = coinFacesAfterEvent(flipped, {
      type: "coinsDrawn",
      coins: [7 as CoinUid],
    });
    expect(next[3]).toBe("tails");
  });
});

describe("drawPileComposition — 뽑을 더미 구성 (종류·매수만, 순서 비공개)", () => {
  it("그룹 합계가 뽑을 더미 매수와 일치하고 종류별 매수가 실제와 같다", () => {
    const state = boot(); // 주머니 10 + 불씨 임시 화염 1 - 드로우 5 = 6
    const groups = drawPileComposition(state, contentDb);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(6);
    expect(state.zones.draw.length).toBe(6);
    for (const group of groups) {
      const actual = state.zones.draw.filter((coin) => {
        const instance = state.coins[Number(coin)];
        return (
          String(instance?.defId) === group.defId &&
          instance?.permanent === !group.temporary
        );
      }).length;
      expect(group.count).toBe(actual);
    }
  });

  it("합성 상태: 기본(영구·임시)과 화염을 분리 집계하고 기본→화염, 영구→임시 순으로 정렬한다", () => {
    const base = boot();
    const synthetic: CombatState = {
      ...base,
      coins: {
        1: {
          uid: 1 as CoinUid,
          defId: "basic" as never,
          permanent: true,
          grants: [],
        },
        2: {
          uid: 2 as CoinUid,
          defId: "basic" as never,
          permanent: false,
          grants: [],
        },
        3: {
          uid: 3 as CoinUid,
          defId: "fire" as never,
          permanent: true,
          grants: [],
        },
        4: {
          uid: 4 as CoinUid,
          defId: "basic" as never,
          permanent: true,
          grants: [],
        },
      },
      zones: {
        ...base.zones,
        draw: [3 as CoinUid, 2 as CoinUid, 1 as CoinUid, 4 as CoinUid],
      },
    };
    expect(drawPileComposition(synthetic, contentDb)).toEqual([
      { defId: "basic", element: null, grants: [], temporary: false, count: 2 },
      { defId: "basic", element: null, grants: [], temporary: true, count: 1 },
      {
        defId: "fire",
        element: "fire",
        grants: [],
        temporary: false,
        count: 1,
      },
    ]);
  });

  it("턴 전환 후 구성이 갱신된다 — 2턴 드로우 뒤 더미 1닢", () => {
    const state = boot();
    const ended = step(state, { type: "endTurn" }, contentDb);
    if (!ended.ok) throw new Error(ended.error);
    const groups = drawPileComposition(ended.state, contentDb);
    expect(ended.state.zones.draw.length).toBe(1);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(1);
  });
});

describe("pileComposition — 버림·소모 영역 구성과 수명주기 표식", () => {
  it("버림과 소모를 분리 집계하고 취급 속성·영구/임시를 구분한다", () => {
    const base = boot();
    const synthetic: CombatState = {
      ...base,
      coins: {
        1: {
          uid: 1 as CoinUid,
          defId: "basic" as never,
          permanent: true,
          grants: [],
        },
        2: {
          uid: 2 as CoinUid,
          defId: "basic" as never,
          permanent: true,
          grants: ["fire"],
        },
        3: {
          uid: 3 as CoinUid,
          defId: "fire" as never,
          permanent: true,
          grants: [],
        },
        4: {
          uid: 4 as CoinUid,
          defId: "fire" as never,
          permanent: false,
          grants: [],
        },
      },
      zones: {
        ...base.zones,
        draw: [],
        hand: [],
        discard: [1 as CoinUid, 2 as CoinUid],
        exhausted: [3 as CoinUid, 4 as CoinUid],
      },
    };

    expect(pileComposition(synthetic, "discard", contentDb)).toEqual([
      { defId: "basic", element: null, grants: [], temporary: false, count: 1 },
      {
        defId: "basic",
        element: null,
        grants: ["fire"],
        temporary: false,
        count: 1,
      },
    ]);
    expect(pileComposition(synthetic, "exhausted", contentDb)).toEqual([
      {
        defId: "fire",
        element: "fire",
        grants: [],
        temporary: false,
        count: 1,
      },
      { defId: "fire", element: "fire", grants: [], temporary: true, count: 1 },
    ]);
  });
});

describe("dragTargetSlots — 드래그 합법 목적지 (코어 판정 위임)", () => {
  it("손패 코인은 코스트가 남은 flip 슬롯 전부가 목적지다", () => {
    const state = boot();
    const coin = state.zones.hand[0];
    if (coin === undefined) throw new Error("missing hand coin");
    // P7 D2 워리어 슬롯: 0 정권 / 1 가드 / 2 불꽃 스트레이트 / 3 내면의 발화(소비) / 4~7 빈 슬롯
    // 소비 슬롯과 빈 슬롯은 코인을 장전할 수 없다
    expect(
      [...dragTargetSlots(state, coin, { kind: "hand" }, contentDb)].sort(),
    ).toEqual([0, 1, 2, 3]);
  });

  it("가득 찬 슬롯은 목적지에서 빠진다", () => {
    const { state, coin: placedCoin } = placeFirst(boot(), 0); // 베기(cost 1) 만충
    const another = state.zones.hand[0];
    if (another === undefined) throw new Error("missing hand coin");
    const targets = dragTargetSlots(
      state,
      another,
      { kind: "hand" },
      contentDb,
    );
    expect(targets.has(0)).toBe(false);
    expect(placedCoin).not.toBe(another);
  });

  it("소켓 출발은 회수 후 장전이 둘 다 합법인 슬롯만 — 자기 슬롯 제외", () => {
    const { state, coin } = placeFirst(boot(), 0);
    const targets = dragTargetSlots(
      state,
      coin,
      { kind: "socket", slot: slot(0) },
      contentDb,
    );
    expect(targets.has(0)).toBe(false);
    expect([...targets].sort()).toEqual([1, 2, 3]);
  });
});

describe("dropCommands / stepSequence — 드롭의 커맨드 변환과 전량 커밋", () => {
  it("손패 → 합법 소켓 = placeCoin 1건", () => {
    const state = boot();
    const coin = state.zones.hand[0];
    if (coin === undefined) throw new Error("missing hand coin");
    const commands = dropCommands(
      coin,
      { kind: "hand" },
      { kind: "slot", slot: slot(2) },
    );
    expect(commands).toEqual([{ type: "placeCoin", coin, slot: slot(2) }]);
    const run = stepSequence(state, commands ?? [], contentDb);
    expect(run).not.toBeNull();
    expect(run?.state.zones.placed[slot(2)]).toEqual([coin]);
  });

  it("손패 → 트레이/허공 = 무효 (null)", () => {
    const state = boot();
    const coin = state.zones.hand[0];
    if (coin === undefined) throw new Error("missing hand coin");
    expect(dropCommands(coin, { kind: "hand" }, { kind: "tray" })).toBeNull();
    expect(dropCommands(coin, { kind: "hand" }, { kind: "none" })).toBeNull();
  });

  it("소켓 → 트레이 = 회수, 소켓 → 다른 슬롯 = 회수+장전 이동", () => {
    const { state, coin } = placeFirst(boot(), 0);
    const toTray = dropCommands(
      coin,
      { kind: "socket", slot: slot(0) },
      { kind: "tray" },
    );
    expect(toTray).toEqual([{ type: "unplaceCoin", coin }]);

    const move = dropCommands(
      coin,
      { kind: "socket", slot: slot(0) },
      { kind: "slot", slot: slot(1) },
    );
    expect(move).toEqual([
      { type: "unplaceCoin", coin },
      { type: "placeCoin", coin, slot: slot(1) },
    ]);
    const run = stepSequence(state, move ?? [], contentDb);
    expect(run).not.toBeNull();
    expect(run?.state.zones.placed[slot(0)]).toEqual([]);
    expect(run?.state.zones.placed[slot(1)]).toEqual([coin]);
  });

  it("열 중 하나라도 불법이면 전체 취소 (null)", () => {
    const { state, coin } = placeFirst(boot(), 0);
    // 빈 슬롯(4)으로의 이동은 placeCoin이 불법 → 시퀀스 전체가 null
    const bad = dropCommands(
      coin,
      { kind: "socket", slot: slot(0) },
      { kind: "slot", slot: slot(4) },
    );
    expect(bad).not.toBeNull();
    expect(stepSequence(state, bad ?? [], contentDb)).toBeNull();
  });
});
