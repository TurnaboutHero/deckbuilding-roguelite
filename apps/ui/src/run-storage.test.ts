import { contentDb } from "@game/content";
import {
  RUN_SAVE_VERSION,
  chooseCoinReward,
  createRun,
  resolveCoinRemoval,
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

const CONTENT_VERSION = "0.5.0-m5";
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

const readySave = (): RunSave => ({
  version: RUN_SAVE_VERSION,
  contentVersion: CONTENT_VERSION,
  runSeed: "STORAGE-BOUNDARY",
  character: "warrior" as never,
  currentHp: 63,
  maxHp: 70,
  bag: [...STARTING_BAG.slice(1), "mana"] as never,
  equippedSkills: [...STARTING_SKILLS.slice(0, 5), "smash"] as never,
  gold: 40,
  combatIndex: 2,
  attempt: 1,
  phase: "ready",
});

const rewardsSave = (): RunSave => ({
  ...readySave(),
  equippedSkills: [...STARTING_SKILLS] as never,
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
  equippedSkills: [...STARTING_SKILLS] as never,
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
  equippedSkills: [...STARTING_SKILLS] as never,
  gold: 0,
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
  equippedSkills: [...STARTING_SKILLS] as never,
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
      equippedSkills: [...GUARDIAN_STARTING_SKILLS] as never,
      gold: 0,
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

  it("migrates v1 saves explicitly and rejects unknown versions", () => {
    // v1 → v2: 형태 동일, warrior 시대 저장 보존 (증거 계약 §2 — 명시 마이그레이션)
    const migrated = parse(rawWith({ version: 1 }));
    expect(migrated).toEqual(readySave());
    expect(migrated?.version).toBe(RUN_SAVE_VERSION);
    expect(parse(rawWith({ version: 0 }))).toBeNull();
    expect(parse(rawWith({ version: RUN_SAVE_VERSION + 1 }))).toBeNull();
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
      { equippedSkills: [...readySave().equippedSkills.slice(0, 5), "meteor"] },
    ],
    [
      "unknown coin offer",
      {
        phase: "rewards",
        attempt: 0,
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
    ["one skill offer", ["basic", "fire", "mana"], ["furnace"]],
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
    ["wrong equipped skill count", { equippedSkills: ["slash"] }],
    [
      "duplicate equipped skills",
      {
        equippedSkills: [
          "slash",
          "guard",
          "burning-strike",
          "ignite",
          "smash",
          "smash",
        ],
      },
    ],
    [
      "too many early skill replacements",
      {
        equippedSkills: [
          "slash",
          "guard",
          "burning-strike",
          "ignite",
          "smash",
          "furnace",
        ],
      },
    ],
    ["negative gold", { gold: -1 }],
    ["unsafe gold", { gold: Number.MAX_SAFE_INTEGER + 1 }],
    ["fractional combat index", { combatIndex: 1.5 }],
    ["out-of-range combat index", { combatIndex: 5 }],
    [
      "reward at encounter zero",
      {
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
          combatIndex: 1,
          equippedSkills: [...STARTING_SKILLS.slice(0, 5), "smash"],
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
      equippedSkills: [...STARTING_SKILLS] as never,
    };
    const skippedFallback: RunSave = {
      ...selectedFallback,
      bag: [...STARTING_BAG, "basic", "fire"] as never,
    };
    for (const save of [
      initial,
      afterNormalCoin,
      fallbackCoin,
      selectedFallback,
      skippedFallback,
    ]) {
      const serialized = serializeRunSave(save, exhaustedSkillContext);
      expect(
        parseRunSave(serialized, CONTENT_VERSION, exhaustedSkillContext),
      ).toEqual(save);
    }
  });

  it("accepts the exact core-produced B2 fallback select and skip lifecycle", () => {
    const created = createRun(
      {
        contentVersion: CONTENT_VERSION,
        runSeed: "STORAGE-B2-CORE",
        character: "warrior" as never,
      },
      exhaustedSkillContext,
    );
    const first = startRunCombat(created, exhaustedSkillContext);
    const firstRewards = settleRunCombat(
      first.run,
      wonCombat(first.combat, 64),
      exhaustedSkillContext,
    );
    const secondReady = resolveCoinRemoval(
      chooseCoinReward(firstRewards, null),
      null,
    );
    const second = startRunCombat(secondReady, exhaustedSkillContext);
    const normalCoinStage = settleRunCombat(
      second.run,
      wonCombat(second.combat, 59),
      exhaustedSkillContext,
    );
    const afterNormalCoin = chooseCoinReward(normalCoinStage, null);
    const fallbackCoinStage = resolveCoinRemoval(afterNormalCoin, null);

    for (const save of [normalCoinStage, afterNormalCoin, fallbackCoinStage]) {
      expect(
        parseRunSave(
          serializeRunSave(save, exhaustedSkillContext),
          CONTENT_VERSION,
          exhaustedSkillContext,
        ),
      ).toEqual(save);
    }

    const selected = fallbackCoinStage.pendingRewards?.coinOptions[0];
    if (selected === undefined) throw new Error("missing fallback option");
    const selectedReady = chooseCoinReward(fallbackCoinStage, selected);
    const skippedReady = chooseCoinReward(fallbackCoinStage, null);
    expect(
      parseRunSave(
        serializeRunSave(selectedReady, exhaustedSkillContext),
        CONTENT_VERSION,
        exhaustedSkillContext,
      ),
    ).toEqual(selectedReady);
    expect(
      parseRunSave(
        serializeRunSave(skippedReady, exhaustedSkillContext),
        CONTENT_VERSION,
        exhaustedSkillContext,
      ),
    ).toEqual(skippedReady);
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
