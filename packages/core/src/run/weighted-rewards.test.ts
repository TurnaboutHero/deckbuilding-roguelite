import { describe, expect, it } from "vitest";

import type { ContentDb } from "../content-types";
import type { CharacterId, CoinDefId, EnemyDefId, SkillId } from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import {
  createRun,
  resolveCoinRemoval,
  settleRunCombat,
  signatureElement,
  startRunCombat,
  weightedCoinOptions,
} from "./run";
import type { RunState } from "./types";

const id = <T extends string>(value: string): T => value as T;

const simpleSkill = (value: string) => ({
  id: id<SkillId>(value),
  name: value,
  type: "flip" as const,
  rarity: "common" as const,
  tags: ["attack"] as const,
  targetType: "single-enemy" as const,
  cost: 1,
  base: [{ kind: "damage" as const, amount: 1 }],
});

const baseCoins = {
  basic: { id: id<CoinDefId>("basic"), element: null },
  fire: { id: id<CoinDefId>("fire"), element: "fire" as const },
  mana: { id: id<CoinDefId>("mana"), element: "mana" as const },
};

const wideCoins = {
  ...baseCoins,
  frost: { id: id<CoinDefId>("frost"), element: "frost" as const },
  lightning: { id: id<CoinDefId>("lightning"), element: "lightning" as const },
};

const db = (coins: ContentDb["coins"]): ContentDb => ({
  coins,
  skills: Object.fromEntries(
    ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((skill) => [
      skill,
      simpleSkill(skill),
    ]),
  ) as ContentDb["skills"],
  enemies: Object.fromEntries(
    [
      "raider",
      "shaman",
      "gatekeeper",
      "raider-plus",
      "gatekeeper-plus",
      "goblin",
      "thief",
      "ghoul",
      "slime",
      "ember-archmage",
    ].map(
      (enemy) => [
        enemy,
        {
          id: id(enemy),
          name: enemy,
          maxHp: 10,
          intents: [
            { id: "hit", actions: [{ kind: "attack" as const, damage: 1 }] },
          ],
        },
      ],
    ),
  ),
  characters: {
    warrior: {
      id: id<CharacterId>("warrior"),
      name: "warrior",
      maxHp: 70,
      startingBag: [
        ...Array.from({ length: 8 }, () => id<CoinDefId>("basic")),
        id<CoinDefId>("fire"),
        id<CoinDefId>("fire"),
      ],
      startingSkills: ["s1", "s2", "s3", "s4", "s5", "s6"].map((skill) =>
        id<SkillId>(skill),
      ),
      trait: { id: "none", name: "none", hook: "combatStart", effects: [] },
    },
  },
  validate: () => [],
});

const rewardsAt = (state: RunState, database: ContentDb): RunState => {
  const started = startRunCombat(state, database);
  const finished = {
    ...started.combat,
    phase: "victory" as const,
    enemies: started.combat.enemies.map((enemy) => ({ ...enemy, hp: 0 })),
  };
  return settleRunCombat(started.run, finished, database);
};

const newRun = (database: ContentDb, seed = "WEIGHTED"): RunState =>
  createRun(
    { contentVersion: "test", runSeed: seed, character: id<CharacterId>("warrior") },
    database,
  );

describe("weighted coin rewards (§825 gate)", () => {
  it("keeps the legacy full-shuffle byte behavior while the pool is 3 or fewer", () => {
    const legacy = db(baseCoins);
    const rewards = rewardsAt(newRun(legacy), legacy);
    const options = rewards.pendingRewards?.coinOptions.map(String) ?? [];

    // 레거시 계약: 같은 reward 스트림의 exact 셔플 순서와 완전 동일 (순서 회귀 검출)
    const expected = rngFrom(derive(seedFromString("WEIGHTED"), "reward", 0))
      .shuffle(["basic", "fire", "mana"]);
    expect(options).toEqual(expected);
  });

  it("switches to weighted three picks without duplicates when the pool exceeds 3", () => {
    const wide = db(wideCoins);
    const rewards = rewardsAt(newRun(wide), wide);
    const options = rewards.pendingRewards?.coinOptions.map(String) ?? [];

    expect(options).toHaveLength(3);
    expect(new Set(options).size).toBe(3);
    for (const option of options) {
      expect(Object.keys(wideCoins)).toContain(option);
    }
  });

  it("is deterministic for the same seed and diverges across seeds", () => {
    const wide = db(wideCoins);
    const first = rewardsAt(newRun(wide, "DET"), wide).pendingRewards?.coinOptions;
    const second = rewardsAt(newRun(wide, "DET"), wide).pendingRewards?.coinOptions;
    expect(first).toEqual(second);
    // 서로 다른 고정 시드는 결과가 달라야 한다 (시드 미사용 회귀 검출) — 3개 시드 중 최소 1쌍 상이
    const a = rewardsAt(newRun(wide, "DIV-A"), wide).pendingRewards?.coinOptions?.map(String);
    const b = rewardsAt(newRun(wide, "DIV-B"), wide).pendingRewards?.coinOptions?.map(String);
    const c = rewardsAt(newRun(wide, "DIV-C"), wide).pendingRewards?.coinOptions?.map(String);
    expect(
      JSON.stringify(a) !== JSON.stringify(b) ||
        JSON.stringify(b) !== JSON.stringify(c),
    ).toBe(true);
  });

  it("routes the exhausted-pool fallback through the same weighted canon", () => {
    // P6 신스펙 보상은 제거 단계를 만들지 않으므로(coinRemovalResolved:true 고정)
    // fallback은 레거시 v5 저장(acts 없는 그래프 + 미해결 제거 단계)에서만 도달한다.
    // 스킬 풀 소진 db(장착 6종 외 없음) + 코인 5종 수제 상태로 경로를 직접 검증한다.
    const wide = db(wideCoins);
    const exhausted: ContentDb = {
      ...wide,
      skills: Object.fromEntries(
        Object.entries(wide.skills).filter(([skill]) =>
          ["s1", "s2", "s3", "s4", "s5", "s6"].includes(skill),
        ),
      ),
    };
    const combatNode = (nodeId: string, enemy: string) => ({
      id: nodeId,
      kind: "combat" as const,
      encounter: [id<EnemyDefId>(enemy)],
    });
    // 전투 2 완료(completedCombatCount=2) 후 제거 단계 직전의 v5 보상 상태
    const fallbackState = (): RunState => ({
      ...newRun(exhausted, "FALLBACK"),
      graph: {
        layers: [
          [combatNode("l0", "raider")],
          [combatNode("l1", "shaman")],
          [combatNode("l2", "gatekeeper")],
        ],
      },
      nodeChoices: [0, 0, 0],
      combatIndex: 2,
      phase: "rewards",
      pendingRewards: {
        coinOptions: [],
        coinChoiceResolved: true,
        coinRemovalResolved: false,
        skillOptions: [],
        skillChoiceResolved: true,
      },
    });
    const resolved = resolveCoinRemoval(fallbackState(), null, exhausted);
    const fallback = resolved.pendingRewards?.coinOptions.map(String) ?? [];

    expect(resolved.phase).toBe("rewards");
    expect(resolved.pendingRewards?.coinChoiceResolved).toBe(false);
    expect(fallback).toHaveLength(3);
    expect(new Set(fallback).size).toBe(3);
    for (const option of fallback) expect(Object.keys(wideCoins)).toContain(option);
    // 가중 정본 공유: reward-fallback 스트림의 weightedCoinOptions와 완전 동일
    const expected = weightedCoinOptions(
      exhausted,
      id<CharacterId>("warrior"),
      fallbackState().bag,
      rngFrom(derive(seedFromString("FALLBACK"), "reward-fallback", 1)),
    );
    expect(fallback).toEqual(expected.map(String));
    // 결정론: 같은 수제 상태 재구성이 동일한 fallback을 낸다
    expect(
      resolveCoinRemoval(fallbackState(), null, exhausted).pendingRewards?.coinOptions.map(
        String,
      ),
    ).toEqual(fallback);
  });

  it("ranks signature above basic above other elements across many draws", () => {
    const wide = db(wideCoins);
    const counts = new Map<string, number>();
    for (let seedIndex = 0; seedIndex < 400; seedIndex += 1) {
      const rng = rngFrom(derive(seedFromString(`stat-${seedIndex}`), "reward", 0));
      const picks = weightedCoinOptions(
        wide,
        id<CharacterId>("warrior"),
        newRun(wide).bag,
        rng,
      );
      const top = String(picks[0]);
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const fire = counts.get("fire") ?? 0; // 대표 50 + 보유 15
    const basic = counts.get("basic") ?? 0; // 30
    const frost = counts.get("frost") ?? 0; // 20
    const lightning = counts.get("lightning") ?? 0; // 20

    expect(fire).toBeGreaterThan(basic);
    expect(basic).toBeGreaterThan(frost);
    expect(basic).toBeGreaterThan(lightning);
  });

  it("derives the signature element from the starting bag majority", () => {
    const wide = db(wideCoins);
    expect(signatureElement(wide, id<CharacterId>("warrior"))).toBe("fire");
  });

  it("boosts owned elements via the bag bonus", () => {
    const wide = db(wideCoins);
    const manaBag = [
      ...Array.from({ length: 8 }, () => id<CoinDefId>("basic")),
      id<CoinDefId>("mana"),
      id<CoinDefId>("mana"),
    ];
    let manaTop = 0;
    let frostTop = 0;
    for (let seedIndex = 0; seedIndex < 400; seedIndex += 1) {
      const rng = rngFrom(derive(seedFromString(`own-${seedIndex}`), "reward", 0));
      const picks = weightedCoinOptions(wide, id<CharacterId>("warrior"), manaBag, rng);
      if (String(picks[0]) === "mana") manaTop += 1;
      if (String(picks[0]) === "frost") frostTop += 1;
    }
    // mana(기타 20 + 보유 15 = 35) > frost(기타 20)
    expect(manaTop).toBeGreaterThan(frostTop);
  });
});
