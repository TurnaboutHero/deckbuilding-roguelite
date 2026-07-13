import { CONTENT_VERSION as CURRENT_CONTENT_VERSION, contentDb } from "@game/content";
import {
  RUN_ENCOUNTERS,
  RUN_SAVE_VERSION,
  chooseCoinReward,
  createRun,
  settleRunCombat,
  startRunCombat,
  type CombatState,
  type RunSave,
} from "@game/core";
import { describe, expect, it } from "vitest";

import {
  RUN_SAVE_KEY,
  clearRun,
  loadRun,
  parseRunSave,
  saveRun,
  serializeRunSave,
  type StorageLike,
} from "./run-storage";

const CONTENT_VERSION = CURRENT_CONTENT_VERSION;
const LEGACY_CONTENT_VERSION = "0.5.0-m5";
const P10_CONTENT_VERSION = "1.4.0-p10";
const STARTING_BAG = [...(contentDb.characters.warrior?.startingBag ?? [])];
const STARTING_SKILLS = [
  ...(contentDb.characters.warrior?.startingSkills ?? []),
];
const GUARDIAN_STARTING_BAG = [
  ...(contentDb.characters.guardian?.startingBag ?? []),
];
const GUARDIAN_STARTING_SKILLS = [
  ...(contentDb.characters.guardian?.startingSkills ?? []),
];

// P7 D2 — 세이브 v7: 장착 슬롯 8 고정 (null = 빈 슬롯), 강화 플래그 8칸
const MAX_SLOTS = 8;
const padSkills = (skills: readonly unknown[]): (string | null)[] => [
  ...skills.map(String),
  ...Array.from({ length: MAX_SLOTS - skills.length }, () => null),
];
const PADDED_STARTING_SKILLS = padSkills(STARTING_SKILLS);
const NO_UPGRADES = Array.from({ length: MAX_SLOTS }, () => false);

const legacyGraph = (): RunSave["graph"] => ({
  layers: RUN_ENCOUNTERS.map((encounter, index) => [
    {
      id: `legacy-combat-${index}`,
      kind: "combat" as const,
      encounter: [...encounter],
    },
  ]),
});

const readySave = (): RunSave => ({
  version: RUN_SAVE_VERSION,
  contentVersion: CONTENT_VERSION,
  runSeed: "STORAGE-BOUNDARY",
  character: "warrior" as never,
  currentHp: 63,
  maxHp: 70,
  bag: [...STARTING_BAG.slice(1), "mana"] as never,
  // 첫 빈 슬롯(4)에 smash 장착 = 변경 슬롯 1 (완료 보상 1회로 커버)
  equippedSkills: padSkills([...STARTING_SKILLS, "smash"]) as never,
  gold: 40,
  graph: legacyGraph(),
  nodeChoices: [0, 0, 0, 0, 0],
  shopRemovals: 0,
  shopPurchasedCoins: 0,
  shopPurchasedSkills: 0,
  eventCombats: 0,
  eventCoinGains: 0,
  eventCoinLosses: 0,
  upgradedSlots: [...NO_UPGRADES] as never,
  acquiredPassives: [] as never,
  shopPurchasedPassives: 0,
  treasureOpened: 0,
  restHeals: 0,
  restUpgrades: 0,
  combatIndex: 2,
  attempt: 1,
  phase: "ready",
});

const rewardsSave = (): RunSave => ({
  ...readySave(),
  equippedSkills: [...PADDED_STARTING_SKILLS] as never,
  attempt: 0,
  phase: "rewards",
  pendingRewards: {
    coinOptions: ["basic", "fire", "mana"] as never,
    coinChoiceResolved: false,
    coinRemovalResolved: false,
    skillOptions: ["fire-infusion", "furnace"] as never,
    skillChoiceResolved: false,
  },
});

const combatOneRewardsSave = (): RunSave => ({
  ...readySave(),
  bag: [...STARTING_BAG] as never,
  equippedSkills: [...PADDED_STARTING_SKILLS] as never,
  combatIndex: 1,
  attempt: 0,
  phase: "rewards",
  pendingRewards: {
    coinOptions: ["basic", "mana", "fire"] as never,
    coinChoiceResolved: false,
    coinRemovalResolved: false,
    skillOptions: [],
    skillChoiceResolved: true,
  },
});

const freshSave = (): RunSave => ({
  ...readySave(),
  currentHp: 70,
  bag: [...STARTING_BAG] as never,
  equippedSkills: [...PADDED_STARTING_SKILLS] as never,
  gold: 0,
  upgradedSlots: [...NO_UPGRADES] as never,
  acquiredPassives: [] as never,
  shopPurchasedPassives: 0,
  treasureOpened: 0,
  restHeals: 0,
  restUpgrades: 0,
  combatIndex: 0,
  attempt: 0,
});

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const rawWith = (overrides: Record<string, unknown>): string =>
  JSON.stringify({ ...readySave(), ...overrides });
const legacyRawWith = (overrides: Record<string, unknown>): string => {
  const legacy = { ...readySave() } as Record<string, unknown>;
  delete legacy.graph;
  delete legacy.nodeChoices;
  delete legacy.shopRemovals;
  // v1/v2 시대 저장은 null 슬롯·강화 배열이 없다 — 마이그레이션이 8칸으로 패딩해야 한다
  legacy.equippedSkills = [...STARTING_SKILLS, "smash"];
  delete legacy.upgradedSlots;
  return JSON.stringify({ ...legacy, ...overrides });
};
const parse = (raw: string): RunSave | null =>
  parseRunSave(raw, CONTENT_VERSION, contentDb);
const serialize = (save: RunSave): string => serializeRunSave(save, contentDb);

const exhaustedSkillContext = {
  ...contentDb,
  skills: Object.fromEntries(
    [...new Set([...STARTING_SKILLS.map(String), "smash"])].map((skill) => [
      skill,
      contentDb.skills[skill]!,
    ]),
  ),
};

const fallbackRewardsSave = (
  flags: { coinChoiceResolved: boolean; coinRemovalResolved: boolean } = {
    coinChoiceResolved: false,
    coinRemovalResolved: false,
  },
): RunSave => ({
  ...readySave(),
  equippedSkills: [...PADDED_STARTING_SKILLS] as never,
  attempt: 0,
  phase: "rewards",
  pendingRewards: {
    coinOptions: ["mana", "basic", "fire"] as never,
    ...flags,
    skillOptions: [],
    skillChoiceResolved: true,
  },
});

const wonCombat = (combat: CombatState, hp: number): CombatState => ({
  ...combat,
  phase: "victory",
  player: { ...combat.player, hp },
});

describe("run save serialization boundary", () => {
  it("imports in Node without requiring window and round-trips normal boundary phases", () => {
    expect("window" in globalThis).toBe(false);
    const saves: RunSave[] = [
      readySave(),
      { ...readySave(), phase: "combat" },
      rewardsSave(),
      combatOneRewardsSave(),
      { ...readySave(), combatIndex: 4, phase: "victory" },
      { ...readySave(), currentHp: 0, phase: "defeat" },
    ];
    for (const save of saves) expect(parse(serialize(save))).toEqual(save);
  });

  it("round-trips a resumed combat attempt and terminal victory/defeat states", () => {
    const resumed = { ...readySave(), attempt: 7, phase: "combat" as const };
    const victory = {
      ...readySave(),
      upgradedSlots: [...NO_UPGRADES] as never,
      acquiredPassives: [] as never,
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      combatIndex: 4,
      attempt: 3,
      phase: "victory" as const,
    };
    const defeat = {
      ...readySave(),
      currentHp: 0,
      attempt: 4,
      phase: "defeat" as const,
    };
    expect(parse(serialize(resumed))).toEqual(resumed);
    expect(parse(serialize(victory))).toEqual(victory);
    expect(parse(serialize(defeat))).toEqual(defeat);
  });

  it("emits stable normalized JSON and strips non-run data", () => {
    const save = Object.assign(readySave(), {
      rngImpl: { flip: () => "heads" },
      events: [{ type: "turnStarted", turn: 1 }],
      zones: { hand: [1, 2, 3] },
      extraFunction: () => undefined,
    }) as RunSave;
    const reordered = Object.fromEntries(
      Object.entries(save).reverse(),
    ) as unknown as RunSave;
    const serialized = serialize(save);

    expect(serialize(reordered)).toBe(serialized);
    expect(serialized).not.toMatch(/rngImpl|events|zones|extraFunction/);
    expect(parse(serialized)).toEqual(readySave());
  });

  it("saves, loads, and clears through caller-supplied storage", () => {
    const storage = new MemoryStorage();
    const save = rewardsSave();

    expect(loadRun(storage, CONTENT_VERSION, contentDb)).toBeNull();
    saveRun(storage, save, contentDb);
    expect(storage.values.has(RUN_SAVE_KEY)).toBe(true);
    expect(loadRun(storage, CONTENT_VERSION, contentDb)).toEqual(save);
    clearRun(storage);
    expect(storage.values.has(RUN_SAVE_KEY)).toBe(false);
    expect(loadRun(storage, CONTENT_VERSION, contentDb)).toBeNull();
  });

  it("round-trips a Guardian run through caller-supplied storage", () => {
    const storage = new MemoryStorage();
    const save: RunSave = {
      version: RUN_SAVE_VERSION,
      contentVersion: CONTENT_VERSION,
      runSeed: "BRAVE-EMBER-42",
      character: "guardian" as never,
      currentHp: 70,
      maxHp: 70,
      bag: [...GUARDIAN_STARTING_BAG] as never,
      equippedSkills: padSkills(GUARDIAN_STARTING_SKILLS) as never,
      gold: 0,
      graph: legacyGraph(),
      nodeChoices: [0, 0, 0, 0, 0],
      shopRemovals: 0,
      shopPurchasedCoins: 0,
      shopPurchasedSkills: 0,
      eventCombats: 0,
      eventCoinGains: 0,
      eventCoinLosses: 0,
      upgradedSlots: [...NO_UPGRADES] as never,
      acquiredPassives: [] as never,
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      combatIndex: 0,
      attempt: 0,
      phase: "combat",
    };

    saveRun(storage, save, contentDb);
    expect(loadRun(storage, CONTENT_VERSION, contentDb)).toEqual(save);
  });

  it("returns null without throwing for corrupt, old-version, wrong-content, or inaccessible saves", () => {
    expect(parse("{broken")).toBeNull();
    expect(parse(rawWith({ version: RUN_SAVE_VERSION + 1 }))).toBeNull();
    expect(parse(rawWith({ contentVersion: "old-content" }))).toBeNull();
    expect(
      parseRunSave(serialize(readySave()), "future-content", contentDb),
    ).toBeNull();

    const unavailable: StorageLike = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(() =>
      loadRun(unavailable, CONTENT_VERSION, contentDb),
    ).not.toThrow();
    expect(loadRun(unavailable, CONTENT_VERSION, contentDb)).toBeNull();
  });

  it("migrates legacy m5 content-version saves and normalizes to current", () => {
    // m5 콘텐츠는 현 버전의 부분집합·수치 불변 — 레거시 저장은 안전 로드 + 현 버전으로 정규화
    const legacy = parse(rawWith({ contentVersion: LEGACY_CONTENT_VERSION }));
    expect(legacy).toEqual(readySave());
    expect(legacy?.contentVersion).toBe(CURRENT_CONTENT_VERSION);
    expect(parse(rawWith({ contentVersion: "9.9.9-unknown" }))).toBeNull();
  });

  it("migrates retired P10 cold skill IDs without accepting them in current saves", () => {
    const frost = contentDb.characters["frost-knight"]!;
    const p10 = {
      ...freshSave(),
      contentVersion: P10_CONTENT_VERSION,
      character: "frost-knight",
      maxHp: frost.maxHp,
      currentHp: frost.maxHp,
      bag: frost.startingBag.map(String),
      equippedSkills: padSkills(["slash", "guard", "frost-slash", "glacial-wall"]),
    };
    const migrated = parse(JSON.stringify(p10));
    expect(migrated).toMatchObject({
      contentVersion: CONTENT_VERSION,
      character: "frost-knight",
      equippedSkills: padSkills(["slash", "guard", "ice-claw", "ice-sleight"]),
    });
    expect(parse(JSON.stringify({ ...p10, contentVersion: CONTENT_VERSION }))).toBeNull();
  });

  it("migrates v3, v2, and v1 saves explicitly to v7 and rejects unknown versions", () => {
    // v1 → v2 → v3 → … → v7: 선형 5전투 저장을 레거시 그래프로 감싸고 슬롯 8칸으로 패딩한다
    // (증거 계약 §2 — 명시 마이그레이션). 구세대 저장은 null 슬롯·강화 8칸이 없다.
    // 0.6.0-p3.2 레거시 콘텐츠 버전도 안전 로드 + 현 버전 정규화 (p3.3 가산 확장 — 공허 엣지 근거는 content index 주석)
    const v3Raw = JSON.stringify({
      ...readySave(),
      version: 3,
      equippedSkills: [...STARTING_SKILLS, "smash"],
      upgradedSlots: undefined,
      shopPurchasedCoins: undefined,
      shopPurchasedSkills: undefined,
    });
    expect(parse(v3Raw)).toEqual(readySave());
    const p32 = parse(legacyRawWith({ version: 2, contentVersion: "0.6.0-p3.2" }));
    expect(p32).toEqual(readySave());
    expect(p32?.contentVersion).toBe(CURRENT_CONTENT_VERSION);
    const migratedV2 = parse(legacyRawWith({ version: 2, gold: 77 }));
    expect(migratedV2).toEqual({ ...readySave(), gold: 77 });
    expect(migratedV2?.shopRemovals).toBe(0);
    expect(migratedV2?.shopPurchasedCoins).toBe(0);
    expect(migratedV2?.shopPurchasedSkills).toBe(0);
    expect(migratedV2?.nodeChoices).toEqual([0, 0, 0, 0, 0]);
    expect(migratedV2?.graph).toEqual(legacyGraph());
    const migrated = parse(legacyRawWith({ version: 1 }));
    expect(migrated).toEqual(readySave());
    expect(migrated?.version).toBe(RUN_SAVE_VERSION);
    expect(parse(legacyRawWith({ version: 0 }))).toBeNull();
    expect(parse(rawWith({ version: RUN_SAVE_VERSION + 1 }))).toBeNull();
  });

  it("keeps non-combat layers from inflating bag and skill bounds", () => {
    const graph = {
      layers: [
        legacyGraph().layers[0]!,
        [{ id: "shop-1", kind: "shop" as const }],
        legacyGraph().layers[1]!,
      ],
    };
    const save: RunSave = {
      ...readySave(),
      graph,
      nodeChoices: [0, 0, 0],
      upgradedSlots: [...NO_UPGRADES] as never,
      acquiredPassives: [] as never,
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      combatIndex: 2,
      bag: [...STARTING_BAG, "fire", "mana"] as never,
      equippedSkills: padSkills([
        ...STARTING_SKILLS,
        "smash",
        "furnace",
      ]) as never,
    };
    expect(parse(JSON.stringify(save))).toBeNull();
    expect(
      parse(
        JSON.stringify({
          ...save,
          bag: [...STARTING_BAG, "fire"],
          equippedSkills: [...PADDED_STARTING_SKILLS] as never,
        }),
      ),
    ).not.toBeNull();
  });

  it("accepts and rejects shop save contracts", () => {
    const graph = {
      layers: [legacyGraph().layers[0]!, [{ id: "shop-1", kind: "shop" as const }]],
    };
    const shopSave: RunSave = {
      ...readySave(),
      graph,
      nodeChoices: [0, 0],
      upgradedSlots: [...NO_UPGRADES] as never,
      acquiredPassives: [] as never,
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      combatIndex: 1,
      attempt: 0,
      phase: "shop",
      equippedSkills: [...PADDED_STARTING_SKILLS] as never,
      pendingShop: {
        coinOptions: ["basic", "fire", "mana"] as never,
        coinPrices: [25, 50, 70],
        skillOptions: ["smash", "furnace", "conflagration"] as never,
        skillPrices: [50, 80, 120],
      },
    };
    expect(parse(JSON.stringify(shopSave))).toEqual(shopSave);
    expect(
      parse(
        JSON.stringify({
          ...shopSave,
          pendingShop: { ...shopSave.pendingShop!, coinPrices: [25, 25, 70] },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        JSON.stringify({
          ...shopSave,
          pendingShop: { ...shopSave.pendingShop!, coinOptions: ["basic", "basic"] },
        }),
      ),
    ).toBeNull();
    expect(parse(JSON.stringify({ ...shopSave, phase: "ready" }))).toBeNull();
    expect(parse(JSON.stringify({ ...shopSave, pendingShop: undefined }))).toBeNull();
  });

  it("accepts an exhausted shared-pool save even when exclusive skills exist", () => {
    // 감시자 발견 회귀: 검증기가 exclusiveTo를 무시하면 전용 스킬을 가용으로 오판해
    // 공용 풀 소진(B2 fallback) 저장을 거부한다 — 코어와 같은 술어를 공유해야 한다
    const shared = [
      ...(contentDb.characters.warrior?.startingSkills ?? []).map(String),
      "smash",
    ];
    const exclusiveIds = [
      "warding-strike",
      "mana-bulwark",
      "shield-reprisal",
      "mana-well",
    ];
    const context = {
      coins: contentDb.coins,
      characters: contentDb.characters,
      enemies: contentDb.enemies,
      skills: Object.fromEntries(
        [...shared, ...exclusiveIds].map((id) => [id, contentDb.skills[id]]),
      ),
    } as typeof contentDb;
    const save = fallbackRewardsSave({
      coinChoiceResolved: false,
      coinRemovalResolved: true,
    });
    // 공용 미보유 = smash 1종뿐 (<2) → fallback 단계가 정상 수용돼야 한다.
    // 전용 4종이 섞여도 판정이 달라지면(가용 5종 오판 → 정상 스킬 단계 요구) 회귀다.
    expect(
      parseRunSave(serializeRunSave(save, context), CONTENT_VERSION, context),
    ).toEqual(save);
  });

  it.each([
    ["unknown character", { character: "mage" }],
    ["unknown bag coin", { bag: [...readySave().bag, "ash"] }],
    [
      "unknown equipped skill",
      { equippedSkills: padSkills([...STARTING_SKILLS, "meteor"]) },
    ],
    [
      "unknown coin offer",
      {
        phase: "rewards",
        attempt: 0,
        equippedSkills: [...PADDED_STARTING_SKILLS],
        pendingRewards: {
          ...rewardsSave().pendingRewards,
          coinOptions: ["basic", "fire", "ash"],
        },
      },
    ],
    [
      "unknown skill offer",
      {
        phase: "rewards",
        attempt: 0,
        equippedSkills: [...PADDED_STARTING_SKILLS],
        pendingRewards: {
          ...rewardsSave().pendingRewards,
          skillOptions: ["fire-infusion", "meteor"],
        },
      },
    ],
  ])("rejects %s IDs", (_label, overrides) => {
    expect(parse(rawWith(overrides))).toBeNull();
  });

  it.each([
    [
      "duplicate coin offers",
      ["basic", "fire", "fire"],
      ["fire-infusion", "furnace"],
    ],
    ["two coin offers", ["basic", "fire"], ["fire-infusion", "furnace"]],
    [
      "four coin offers",
      ["basic", "fire", "mana", "basic"],
      ["fire-infusion", "furnace"],
    ],
    [
      "duplicate skill offers",
      ["basic", "fire", "mana"],
      ["furnace", "furnace"],
    ],
    [
      "three skill offers",
      ["basic", "fire", "mana"],
      ["fire-infusion", "furnace", "ignite"],
    ],
  ])("rejects %s", (_label, coinOptions, skillOptions) => {
    expect(
      parse(
        rawWith({
          phase: "rewards",
          attempt: 0,
          equippedSkills: [...PADDED_STARTING_SKILLS],
          pendingRewards: {
            ...rewardsSave().pendingRewards,
            coinOptions,
            skillOptions,
          },
        }),
      ),
    ).toBeNull();
  });

  it.each([
    ["missing run seed", { runSeed: undefined }],
    ["blank run seed", { runSeed: "   " }],
    ["non-finite HP", { currentHp: Number.POSITIVE_INFINITY }],
    ["HP above max", { currentHp: 71 }],
    ["zero HP outside defeat", { currentHp: 0 }],
    ["nonzero HP on defeat", { phase: "defeat", currentHp: 1 }],
    ["wrong character max HP", { maxHp: 71 }],
    ["zero max HP", { maxHp: 0 }],
    ["empty bag", { bag: [] }],
    ["implausibly small bag", { bag: ["basic"] }],
    [
      "implausibly large bag",
      { bag: Array.from({ length: 20 }, () => "basic") },
    ],
    ["invalid bag entry", { bag: ["basic", ""] }],
    // P7 D2 — 장착 배열은 8칸 고정 (짧은 배열은 v7 저장으로 무효)
    ["wrong equipped skill count", { equippedSkills: ["jab"] }],
    [
      "upgraded empty skill slot",
      {
        equippedSkills: [...PADDED_STARTING_SKILLS],
        upgradedSlots: [false, false, false, false, true, false, false, false],
      },
    ],
    [
      "duplicate equipped skills",
      {
        equippedSkills: padSkills([...STARTING_SKILLS, "smash", "smash"]),
      },
    ],
    [
      "too many early skill replacements",
      {
        equippedSkills: padSkills([...STARTING_SKILLS, "smash", "furnace"]),
      },
    ],
    ["negative gold", { gold: -1 }],
    ["unsafe gold", { gold: Number.MAX_SAFE_INTEGER + 1 }],
    ["missing graph", { graph: undefined }],
    ["empty graph", { graph: { layers: [] } }],
    ["empty graph layer", { graph: { layers: [[], [], [], [], []] } }],
    ["duplicate graph node id", {
      graph: {
        layers: legacyGraph().layers.map((layer, index) => [
          { ...layer[0]!, id: index < 2 ? "duplicate" : layer[0]!.id },
        ]),
      },
    }],
    ["missing node choices", { nodeChoices: undefined }],
    ["short node choices", { nodeChoices: [0, 0, 0, 0] }],
    ["out-of-range node choice", { nodeChoices: [0, 1, 0, 0, 0] }],
    ["negative shop removals", { shopRemovals: -1 }],
    // 노드 종류별 payload 계약 (통합 감사): kind와 payload 불일치는 전부 거부
    [
      "unknown encounter enemy",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 0 ? [{ ...layer[0]!, encounter: ["dragon"] }] : layer,
          ),
        },
      },
    ],
    [
      "combat node without encounter",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 0 ? [{ id: "bare-combat", kind: "combat" }] : layer,
          ),
        },
      },
    ],
    [
      "combat node with empty encounter",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 0 ? [{ ...layer[0]!, encounter: [] }] : layer,
          ),
        },
      },
    ],
    [
      "combat node with eventId",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 0 ? [{ ...layer[0]!, eventId: "ambush" }] : layer,
          ),
        },
      },
    ],
    [
      "event node without eventId",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 1 ? [{ id: "evt-1", kind: "event" }] : layer,
          ),
        },
      },
    ],
    [
      "event node with encounter",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 1
              ? [
                  {
                    id: "evt-1",
                    kind: "event",
                    eventId: "ambush",
                    encounter: ["raider"],
                  },
                ]
              : layer,
          ),
        },
      },
    ],
    [
      "shop node with encounter",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 1
              ? [{ id: "shop-1", kind: "shop", encounter: ["raider"] }]
              : layer,
          ),
        },
      },
    ],
    [
      "shop node with eventId",
      {
        graph: {
          layers: legacyGraph().layers.map((layer, index) =>
            index === 1 ? [{ id: "shop-1", kind: "shop", eventId: "ambush" }] : layer,
          ),
        },
      },
    ],
    ["fractional combat index", { combatIndex: 1.5 }],
    ["out-of-range combat index", { combatIndex: 5 }],
    [
      "reward at encounter zero",
      {
        upgradedSlots: [...NO_UPGRADES] as never,
        acquiredPassives: [] as never,
        shopPurchasedPassives: 0,
        treasureOpened: 0,
        restHeals: 0,
        restUpgrades: 0,
        combatIndex: 0,
        phase: "rewards",
        attempt: 0,
        pendingRewards: rewardsSave().pendingRewards,
      },
    ],
    ["victory before final encounter", { combatIndex: 3, phase: "victory" }],
    ["negative attempt", { attempt: -1 }],
    ["unsafe attempt", { attempt: Number.MAX_SAFE_INTEGER + 1 }],
    [
      "nonzero reward attempt",
      { phase: "rewards", pendingRewards: rewardsSave().pendingRewards },
    ],
    ["unknown phase", { phase: "paused" }],
    [
      "pending rewards outside reward phase",
      { pendingRewards: rewardsSave().pendingRewards },
    ],
  ])("rejects %s", (_label, overrides) => {
    expect(parse(rawWith(overrides))).toBeNull();
  });

  it("accepts kind-consistent shop/event nodes (payload 계약 수용 측)", () => {
    const graph = {
      layers: legacyGraph().layers.map((layer, index) =>
        index === 1
          ? [{ id: "evt-1", kind: "event" as const }]
          : index === 3
            ? [{ id: "shop-3", kind: "shop" as const }]
            : layer,
      ),
    };
    // 경제 보존 법칙(P4.4): 이벤트 그래프에서 골드는 완료 전투 총수입(레이어 0 = 35) 이내
    const save = {
      ...readySave(),
      graph,
      gold: 35,
      equippedSkills: [...PADDED_STARTING_SKILLS] as never,
    };
    expect(parse(JSON.stringify(save))).toEqual(save);
  });

  it("enforces the untouched character start boundary", () => {
    expect(parse(JSON.stringify(freshSave()))).toEqual(freshSave());
    expect(
      parse(
        JSON.stringify({
          ...freshSave(),
          bag: ["mana", ...STARTING_BAG.slice(1)],
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        JSON.stringify({
          ...freshSave(),
          currentHp: 69,
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        JSON.stringify({
          ...freshSave(),
          upgradedSlots: [...NO_UPGRADES] as never,
          acquiredPassives: [] as never,
          shopPurchasedPassives: 0,
          treasureOpened: 0,
          restHeals: 0,
          restUpgrades: 0,
          combatIndex: 1,
          // 빈 슬롯 장착도 변경 슬롯 1로 센다 — 완료 보상 0회면 거부
          equippedSkills: padSkills([...STARTING_SKILLS, "smash"]),
        }),
      ),
    ).toBeNull();
  });

  it("requires the reward payload and rejects contradictory progression flags", () => {
    expect(parse(rawWith({ phase: "rewards", attempt: 0 }))).toBeNull();
    expect(
      parse(
        rawWith({
          phase: "rewards",
          attempt: 0,
          pendingRewards: {
            ...rewardsSave().pendingRewards,
            coinChoiceResolved: "yes",
          },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        rawWith({
          phase: "rewards",
          attempt: 0,
          pendingRewards: {
            ...rewardsSave().pendingRewards,
            coinChoiceResolved: false,
            coinRemovalResolved: true,
          },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        rawWith({
          phase: "rewards",
          attempt: 0,
          pendingRewards: {
            ...rewardsSave().pendingRewards,
            skillChoiceResolved: true,
          },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        JSON.stringify({
          ...combatOneRewardsSave(),
          pendingRewards: {
            ...combatOneRewardsSave().pendingRewards,
            coinChoiceResolved: true,
            coinRemovalResolved: true,
          },
        }),
      ),
    ).toBeNull();
  });

  // P6 신스펙: 엘리트 정산은 스킬 1택을 제안한다 — 단일 스킬 제안은 유효한 저장이다
  it("accepts a single elite skill offer", () => {
    const save: RunSave = {
      ...rewardsSave(),
      pendingRewards: {
        ...rewardsSave().pendingRewards!,
        skillOptions: ["furnace"] as never,
      },
    };
    expect(parse(JSON.stringify(save))).toEqual(save);
  });

  it("accepts every reachable normal reward progression and combat-1 pre-resolved skill stage", () => {
    const initial = rewardsSave();
    const afterCoin: RunSave = {
      ...initial,
      pendingRewards: { ...initial.pendingRewards!, coinChoiceResolved: true },
    };
    const afterRemoval: RunSave = {
      ...afterCoin,
      pendingRewards: {
        ...afterCoin.pendingRewards!,
        coinRemovalResolved: true,
      },
    };
    for (const save of [
      initial,
      afterCoin,
      afterRemoval,
      combatOneRewardsSave(),
    ]) {
      expect(parse(JSON.stringify(save))).toEqual(save);
    }
  });

  it("round-trips every reachable B2 exhausted-skill fallback coin stage", () => {
    const initial = fallbackRewardsSave();
    const afterNormalCoin = fallbackRewardsSave({
      coinChoiceResolved: true,
      coinRemovalResolved: false,
    });
    const fallbackCoin = fallbackRewardsSave({
      coinChoiceResolved: false,
      coinRemovalResolved: true,
    });
    const selectedFallback: RunSave = {
      ...readySave(),
      bag: [...STARTING_BAG, "basic", "fire", "mana"] as never,
      equippedSkills: [...PADDED_STARTING_SKILLS] as never,
    };
    const skippedFallback: RunSave = {
      ...selectedFallback,
      bag: [...STARTING_BAG, "basic", "fire"] as never,
    };
    for (const save of [
      initial,
      afterNormalCoin,
      fallbackCoin,
      skippedFallback,
    ]) {
      const serialized = serializeRunSave(save, exhaustedSkillContext);
      expect(
        parseRunSave(serialized, CONTENT_VERSION, exhaustedSkillContext),
      ).toEqual(save);
    }
    expect(() =>
      serializeRunSave(selectedFallback, exhaustedSkillContext),
    ).toThrow("cannot serialize an invalid run save");
  });

  // P6 보상 신스펙: 제거/폴백 단계는 코어가 새 런에서 더 이상 만들지 않는다
  // (coinRemovalResolved 고정 true — 코인 선택만으로 보상 완결). 핸드크래프트 B2
  // 폴백 저장 검증은 위 라운드트립 테스트가 레거시 계약으로 계속 커버한다.
  it("accepts the exact core-produced P6 reward lifecycle (coin-only completion)", () => {
    const created = createRun(
      {
        contentVersion: CONTENT_VERSION,
        runSeed: "STORAGE-B2-CORE",
        character: "warrior" as never,
      },
      exhaustedSkillContext,
    );
    const first = startRunCombat(created, exhaustedSkillContext);
    const rewardsStage = settleRunCombat(
      first.run,
      wonCombat(first.combat, 64),
      exhaustedSkillContext,
    );
    expect(rewardsStage.phase).toBe("rewards");
    expect(rewardsStage.pendingRewards?.coinRemovalResolved).toBe(true);
    expect(
      parseRunSave(
        serializeRunSave(rewardsStage, exhaustedSkillContext),
        CONTENT_VERSION,
        exhaustedSkillContext,
      ),
    ).toEqual(rewardsStage);

    const offered = rewardsStage.pendingRewards?.coinOptions[0];
    if (offered === undefined) throw new Error("missing coin option");
    // 선택과 스킵 모두 코인 한 번으로 보상이 완결되고 다음 레이어로 진입한다
    const selectedNext = chooseCoinReward(rewardsStage, offered, exhaustedSkillContext);
    const skippedNext = chooseCoinReward(rewardsStage, null, exhaustedSkillContext);
    for (const save of [selectedNext, skippedNext]) {
      expect(save.phase).not.toBe("rewards");
      expect(save.pendingRewards).toBeUndefined();
      expect(
        parseRunSave(
          serializeRunSave(save, exhaustedSkillContext),
          CONTENT_VERSION,
          exhaustedSkillContext,
        ),
      ).toEqual(save);
    }
  });

  it("migrates v5 saves to v7 with P6 defaults + 8-slot padding and round-trips (레거시 단일 막 래핑)", () => {
    // P6 D1: v5 그래프는 acts 부재 = 단일 레거시 막으로 감싸 진행 중 런을 보존하고,
    // 신규 필드(강화 슬롯·패시브·카운터)는 기본값으로 승격한다.
    // P7 D2: 구세대 장착 배열(null 슬롯 없음)은 v7에서 8칸으로 패딩된다.
    const v5 = {
      ...readySave(),
      version: 5,
      equippedSkills: [...STARTING_SKILLS, "smash"],
    } as Record<string, unknown>;
    delete v5.upgradedSlots;
    delete v5.acquiredPassives;
    delete v5.shopPurchasedPassives;
    delete v5.treasureOpened;
    delete v5.restHeals;
    delete v5.restUpgrades;
    const migrated = parse(JSON.stringify(v5));
    expect(migrated).toEqual(readySave());
    expect(migrated?.version).toBe(RUN_SAVE_VERSION);
    expect(migrated?.graph.acts).toBeUndefined();
    expect(migrated?.equippedSkills).toEqual(padSkills([...STARTING_SKILLS, "smash"]));
    expect(migrated?.upgradedSlots).toEqual(NO_UPGRADES);
    expect(migrated?.acquiredPassives).toEqual([]);
    expect(migrated?.treasureOpened).toBe(0);
    expect(migrated?.restHeals).toBe(0);
    expect(migrated?.restUpgrades).toBe(0);
    // 마이그레이션 결과는 v7 저장으로 라운드트립한다
    if (migrated === null) throw new Error("v5 migration failed");
    expect(parse(serialize(migrated))).toEqual(migrated);
  });

  // P7 D2 — v6 → v7: 필드 의미 불변, 장착/강화 배열만 8칸 패딩
  it("migrates v6 saves to v7 by padding slot arrays only", () => {
    const v6 = {
      ...readySave(),
      version: 6,
      equippedSkills: [...STARTING_SKILLS, "smash"],
      upgradedSlots: [false, false, false, false, false, false],
    } as Record<string, unknown>;
    const migrated = parse(JSON.stringify(v6));
    expect(migrated).toEqual(readySave());
    expect(migrated?.version).toBe(RUN_SAVE_VERSION);
    expect(migrated?.equippedSkills).toHaveLength(8);
    expect(migrated?.upgradedSlots).toHaveLength(8);
  });

  it("rejects malformed or contradictory B2 fallback coin stages", () => {
    const invalidFlags = fallbackRewardsSave({
      coinChoiceResolved: true,
      coinRemovalResolved: true,
    });
    expect(
      parseRunSave(
        JSON.stringify(invalidFlags),
        CONTENT_VERSION,
        exhaustedSkillContext,
      ),
    ).toBeNull();
    const duplicateOffers = {
      ...fallbackRewardsSave({
        coinChoiceResolved: false,
        coinRemovalResolved: true,
      }),
      pendingRewards: {
        ...fallbackRewardsSave().pendingRewards!,
        coinOptions: ["basic", "basic", "fire"],
        coinRemovalResolved: true,
      },
    } as RunSave;
    expect(
      parseRunSave(
        JSON.stringify(duplicateOffers),
        CONTENT_VERSION,
        exhaustedSkillContext,
      ),
    ).toBeNull();
  });

  it("rejects a semantically invalid character context", () => {
    const invalidContext = {
      ...contentDb,
      characters: {
        ...contentDb.characters,
        warrior: { ...contentDb.characters.warrior!, maxHp: 0 },
      },
    };
    expect(
      parseRunSave(
        JSON.stringify(readySave()),
        CONTENT_VERSION,
        invalidContext,
      ),
    ).toBeNull();

    const unknownStartCoin = {
      ...contentDb,
      characters: {
        ...contentDb.characters,
        warrior: {
          ...contentDb.characters.warrior!,
          startingBag: ["ash" as never],
        },
      },
    };
    expect(
      parseRunSave(
        JSON.stringify(readySave()),
        CONTENT_VERSION,
        unknownStartCoin,
      ),
    ).toBeNull();

    const duplicateStartSkill = {
      ...contentDb,
      characters: {
        ...contentDb.characters,
        warrior: {
          ...contentDb.characters.warrior!,
          startingSkills: Array.from({ length: 6 }, () => "slash" as never),
        },
      },
    };
    expect(
      parseRunSave(
        JSON.stringify(readySave()),
        CONTENT_VERSION,
        duplicateStartSkill,
      ),
    ).toBeNull();
  });

  it("refuses to serialize semantic-invalid runtime data", () => {
    expect(() =>
      serializeRunSave({ ...readySave(), currentHp: Number.NaN }, contentDb),
    ).toThrow("cannot serialize an invalid run save");
    expect(() =>
      serializeRunSave(
        { ...readySave(), character: "mage" as never },
        contentDb,
      ),
    ).toThrow("cannot serialize an invalid run save");
  });
});
