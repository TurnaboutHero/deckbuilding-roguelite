// P4.4 페이블 직접 적대 검증 — 저장 v5 계약 (검증 워커 usage-limit 사망 대체)
import { CONTENT_VERSION, contentDb } from "@game/content";
import { RUN_SAVE_VERSION, generateRunGraph, type RunSave } from "@game/core";
import { describe, expect, it } from "vitest";

import { parseRunSave, serializeRunSave } from "./run-storage";

const WARRIOR_BAG = [...(contentDb.characters.warrior?.startingBag ?? [])];
const WARRIOR_SKILLS = [
  ...(contentDb.characters.warrior?.startingSkills ?? []),
];

const graph = () => generateRunGraph("P44-STORAGE", contentDb);

// 그래프 v2에서 첫 이벤트 분기 레이어(2)와 그 이벤트 노드 인덱스를 찾는다
const eventLayerInfo = () => {
  const layers = graph().layers;
  for (let layer = 0; layer < layers.length; layer += 1) {
    const index = (layers[layer] ?? []).findIndex((node) => node.kind === "event");
    if (index >= 0) return { layer, index };
  }
  throw new Error("graph v2 must contain an event node");
};

const eventSave = (): RunSave => {
  const { layer, index } = eventLayerInfo();
  const nodeChoices = graph().layers.map(() => 0);
  nodeChoices[layer] = index;
  return {
    version: RUN_SAVE_VERSION,
    contentVersion: CONTENT_VERSION,
    runSeed: "P44-STORAGE",
    character: "warrior" as never,
    currentHp: 50,
    maxHp: 70,
    bag: [...WARRIOR_BAG] as never,
    equippedSkills: [...WARRIOR_SKILLS] as never,
    gold: 70, // 완료 레이어 0·1(전투 35+35) 총수입 이내 — 경제 보존 법칙 정합
    graph: graph(),
    nodeChoices,
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    combatIndex: layer,
    attempt: 0,
    phase: "event",
    pendingEvent: { eventId: "blood-offering" as never },
  };
};

const parse = (save: unknown) =>
  parseRunSave(JSON.stringify(save), CONTENT_VERSION, contentDb);

describe("P4.4 저장 v5 적대 검증", () => {
  it("정상 이벤트 저장을 라운드트립한다 (수용 측)", () => {
    const save = eventSave();
    expect(parse(save)).toEqual(save);
    expect(
      parseRunSave(serializeRunSave(save, contentDb), CONTENT_VERSION, contentDb),
    ).toEqual(save);
  });

  it("v4 저장을 v5로 승격한다 (카운터 0·pendingEvent 없음)", () => {
    const save = eventSave();
    const v4 = { ...save, phase: "ready", pendingEvent: undefined } as Record<
      string,
      unknown
    >;
    // 이벤트 노드에서 ready는 pendingEventCombat 없이는 비정합일 수 있으므로
    // combat 노드 레이어(1, 단일 전투)로 이동시킨 v4 저장을 쓴다 (레이어 0은
    // 완전 체력 시작 규칙이 있어 currentHp 50 픽스처와 충돌)
    v4.combatIndex = 1;
    v4.gold = 30; // 완료 레이어 0(전투 35) 총수입 이내
    v4.version = 4;
    delete v4.eventCombats;
    delete v4.eventCoinGains;
    delete v4.eventCoinLosses;
    const migrated = parse(v4);
    expect(migrated?.version).toBe(RUN_SAVE_VERSION);
    expect(migrated?.eventCombats).toBe(0);
    expect(migrated?.eventCoinGains).toBe(0);
    expect(migrated?.eventCoinLosses).toBe(0);
  });

  it("미지 버전·계약 위반을 거부한다", () => {
    const save = eventSave();
    expect(parse({ ...save, version: RUN_SAVE_VERSION + 1 })).toBeNull();
    // pendingEvent는 event 페이즈에만 (레이어 1 = 단일 전투 노드 — HP 규칙 간섭 배제)
    expect(
      parse({ ...save, combatIndex: 1, phase: "ready" }),
    ).toBeNull();
    // 미지 eventId 거부
    expect(
      parse({ ...save, pendingEvent: { eventId: "haunted-mirror" } }),
    ).toBeNull();
    // event 페이즈인데 pendingEvent 없음
    expect(parse({ ...save, pendingEvent: undefined })).toBeNull();
    // 카운터 음수/비정수 거부
    expect(parse({ ...save, eventCombats: -1 })).toBeNull();
    expect(parse({ ...save, eventCoinGains: 1.5 })).toBeNull();
    expect(parse({ ...save, eventCoinLosses: -2 })).toBeNull();
  });

  it("카운터 위조로 불가능한 가방을 통과시킬 수 없다 (하한 위조 차단)", () => {
    const save = eventSave();
    // eventCoinLosses를 부풀려 하한을 낮춰도, bag이 실제 시작 구성보다 크게 줄었다는
    // 위조는 상한/하한 산식 안에서만 통과한다 — 시작 10에서 8개를 지웠다고 주장하는
    // 저장은 losses 위조 없이는 거부되어야 한다.
    const shrunk = {
      ...save,
      combatIndex: 1,
      phase: "ready",
      pendingEvent: undefined,
      nodeChoices: graph().layers.map(() => 0),
      bag: save.bag.slice(0, 2),
      eventCoinLosses: 0,
    };
    expect(parse(shrunk)).toBeNull();
  });

  it("pendingEventCombat은 이벤트 노드의 ready/combat에서만 허용된다", () => {
    const save = eventSave();
    const { layer, index } = eventLayerInfo();
    const nodeChoices = graph().layers.map(() => 0);
    nodeChoices[layer] = index;
    const withEventCombat = {
      ...save,
      phase: "ready",
      pendingEvent: undefined,
      pendingEventCombat: { eventId: "ambush-bounty" },
      combatIndex: layer,
      nodeChoices,
    };
    expect(parse(withEventCombat)).not.toBeNull();
    // combat 노드(레이어 0)에서는 금지
    expect(
      parse({
        ...withEventCombat,
        combatIndex: 0,
        nodeChoices: graph().layers.map(() => 0),
      }),
    ).toBeNull();
  });
});
