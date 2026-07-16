import { describe, expect, it } from "vitest";

import type { ContentDb, SkillDef } from "../content-types";
import type { CharacterId, CoinDefId, EnemyDefId, SkillId } from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import { generateRunGraph } from "./graph";
import {
  buyShopCoin,
  buyShopRemoval,
  buyShopSkill,
  chooseCoinReward,
  chooseRunNode,
  chooseSkillReward,
  completedCombatCount,
  createRun,
  leaveShop,
  rewardEligibleSkillIds,
  settleRunCombat,
  signatureElement,
  skipSkillReward,
  startRunCombat,
  weightedCoinOptions,
} from "./run";
import type { RunState } from "./types";

const id = <T extends string>(value: string): T => value as T;

const skillDef = (
  value: string,
  rarity: SkillDef["rarity"] = "common",
  exclusiveTo?: CharacterId,
): SkillDef => ({
  id: id<SkillId>(value),
  name: value,
  type: "flip",
  rarity,
  tags: ["attack"],
  targetType: "single-enemy",
  cost: 1,
  base: [{ kind: "damage", amount: 1 }],
  ...(exclusiveTo === undefined ? {} : { exclusiveTo }),
});

const enemyDef = (value: string) => ({
  id: id<EnemyDefId>(value),
  name: value,
  maxHp: 10,
  intents: [{ id: "hit", actions: [{ kind: "attack" as const, damage: 1 }] }],
});

const testDb = (): ContentDb => ({
  coins: {
    basic: { id: id<CoinDefId>("basic"), element: null },
    // P7 D4 — 속성 코인 양면 proc 스키마 (런 계층 테스트에서는 플립되지 않는다)
    fire: {
      id: id<CoinDefId>("fire"),
      element: "fire",
      procs: {
        heads: [
          { kind: "applyStatus", status: "burn", stacks: 1, to: "target" },
        ],
        tails: [{ kind: "damage", amount: 1 }],
      },
    },
    mana: {
      id: id<CoinDefId>("mana"),
      element: "mana",
      procs: {
        heads: [{ kind: "block", amount: 1 }],
        tails: [{ kind: "block", amount: 2 }],
      },
    },
    frost: {
      id: id<CoinDefId>("frost"),
      element: "frost",
      procs: {
        heads: [
          {
            kind: "applyStatus",
            status: "frostbite",
            stacks: 1,
            to: "target",
          },
        ],
        tails: [{ kind: "block", amount: 1 }],
      },
    },
    lightning: {
      id: id<CoinDefId>("lightning"),
      element: "lightning",
      procs: {
        heads: [
          { kind: "applyStatus", status: "shock", stacks: 1, to: "target" },
        ],
        tails: [{ kind: "damage", amount: 1 }],
      },
    },
  },
  skills: {
    s1: skillDef("s1"),
    s2: skillDef("s2"),
    s3: skillDef("s3"),
    s4: skillDef("s4"),
    s5: skillDef("s5"),
    s6: skillDef("s6"),
    c1: skillDef("c1"),
    c2: skillDef("c2"),
    c3: skillDef("c3"),
    a1: skillDef("a1", "advanced"),
    r1: skillDef("r1", "rare"),
    guardianOnly: skillDef("guardianOnly", "rare", id<CharacterId>("guardian")),
  },
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
    ].map((enemy) => [enemy, enemyDef(enemy)]),
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
  events: {
    "blood-offering": {
      id: id("blood-offering"),
      name: "blood",
      prompt: "blood",
      risk: "hp",
      hpCost: 5,
      requireCurrentHpAbove: 5,
      reward: { kind: "signatureCoin", count: 1 },
    },
  },
  validate: () => [],
});

const newRun = (db: ContentDb, seed = "P43-VERIFY"): RunState =>
  createRun(
    {
      contentVersion: "test-p43",
      runSeed: seed,
      character: id<CharacterId>("warrior"),
    },
    db,
  );

const combatNode = (nodeId: string, enemy: string) => ({
  id: nodeId,
  kind: "combat" as const,
  encounter: [id<EnemyDefId>(enemy)],
});

// P6 3막 그래프는 시드에 따라 상점 위치가 흔들린다 — 상점/분기 검증은 레이어 2에
// [상점|이벤트] 분기를 고정한 수제 그래프로 결정론을 유지한다 (상점 스트림은 여전히
// 레이어 인덱스 기반 `shop-2`라 코어 경로 그대로 검증된다).
const shopGraphRun = (db: ContentDb, seed = "P43-VERIFY"): RunState => ({
  ...newRun(db, seed),
  graph: {
    layers: [
      [combatNode("c0", "raider")],
      [combatNode("c1", "shaman")],
      [
        { id: "shop-2", kind: "shop" as const },
        { id: "event-2", kind: "event" as const },
      ],
      [combatNode("c3", "gatekeeper")],
    ],
    acts: [{ start: 0 }],
  },
  nodeChoices: [0, 0, 0, 0],
});

const winCurrentCombat = (run: RunState, db: ContentDb): RunState => {
  const started = startRunCombat(run, db);
  return settleRunCombat(
    started.run,
    {
      ...started.combat,
      phase: "victory",
      enemies: started.combat.enemies.map((enemy) => ({ ...enemy, hp: 0 })),
    },
    db,
  );
};

// P6 신스펙: 일반 전투 보상은 동전 3중1택뿐 — 제거·스킬 단계 없음
const resolveRewards = (run: RunState, db: ContentDb): RunState => {
  let next = run;
  while (next.phase === "rewards") {
    if (next.pendingRewards?.coinChoiceResolved === false) {
      next = chooseCoinReward(next, null, db);
    } else if (next.pendingRewards?.skillChoiceResolved === false) {
      next = skipSkillReward(next, db);
    } else {
      throw new Error("unexpected pending reward stage");
    }
  }
  return next;
};

const reachLayerThreeChoice = (db: ContentDb): RunState => {
  let run = resolveRewards(winCurrentCombat(shopGraphRun(db), db), db);
  run = resolveRewards(winCurrentCombat(run, db), db);
  expect(run.phase).toBe("choose-node");
  expect(run.combatIndex).toBe(2);
  return run;
};

const reachFirstShop = (db: ContentDb): RunState =>
  chooseRunNode(reachLayerThreeChoice(db), 0, db);

const coinPrice = (db: ContentDb, run: RunState, coin: CoinDefId): number => {
  const element = db.coins[String(coin)]?.element;
  if (element === null) return 25;
  return element === signatureElement(db, run.character) ? 50 : 70;
};

const skillPrice = (db: ContentDb, skill: SkillId): number => {
  const rarity = db.skills[String(skill)]?.rarity;
  if (rarity === "common") return 50;
  if (rarity === "advanced") return 80;
  return 120;
};

describe("P4.3 independent verification", () => {
  it("keeps progress SSoT on completed combat nodes across shop entry and exit", () => {
    const db = testDb();
    const shop = reachFirstShop(db);

    expect(shop.phase).toBe("shop");
    expect(completedCombatCount(shop)).toBe(2);
    expect(shop.bag).toHaveLength(10);
    // P7 D2 — 장착 슬롯 8 고정 (시작 6스킬 + null 패딩 2)
    expect(shop.equippedSkills).toHaveLength(8);
    expect(shop.equippedSkills.slice(6)).toEqual([null, null]);

    const next = leaveShop(shop, db);
    expect(next.phase).toBe("ready");
    expect(next.combatIndex).toBe(3);
    expect(completedCombatCount(next)).toBe(2);
    expect(next.bag).toHaveLength(10);
    expect(next.equippedSkills).toEqual(shop.equippedSkills);
  });

  it("allows only current two-node layer choices and rejects skips or non-branch choices", () => {
    const db = testDb();
    const choice = reachLayerThreeChoice(db);

    expect(() => chooseRunNode(choice, -1, db)).toThrow(
      "node choice is out of range",
    );
    expect(() => chooseRunNode(choice, 2, db)).toThrow(
      "node choice is out of range",
    );
    expect(() => chooseRunNode({ ...choice, phase: "ready" }, 0, db)).toThrow(
      "run is not choosing a node",
    );
    expect(() =>
      chooseRunNode({ ...newRun(db), phase: "choose-node" }, 0, db),
    ).toThrow("current layer is not a branch");

    const eventBranch = chooseRunNode(choice, 1, db);
    expect(eventBranch.phase).toBe("event");
    expect(eventBranch.combatIndex).toBe(2);
    expect(eventBranch.nodeChoices[2]).toBe(1);
  });

  it("enforces shop prices, removals, gold checks, option consumption, and bag floor", () => {
    const db = testDb();
    const shop = { ...reachFirstShop(db), gold: 400 };
    const pending = shop.pendingShop;
    if (pending === undefined) throw new Error("missing pending shop");

    expect(pending.coinPrices).toEqual(
      pending.coinOptions.map((coin) => coinPrice(db, shop, coin)),
    );
    expect(pending.skillPrices).toEqual(
      pending.skillOptions.map((skill) => skillPrice(db, skill)),
    );
    expect(pending.coinOptions).toHaveLength(3);
    expect(new Set(pending.coinOptions.map(String)).size).toBe(3);
    expect(
      pending.coinOptions.every((coin) => db.coins[String(coin)] !== undefined),
    ).toBe(true);
    expect(pending.skillOptions).not.toContain(id<SkillId>("guardianOnly"));

    expect(() =>
      buyShopCoin({ ...shop, gold: pending.coinPrices[0]! - 1 }, 0, db),
    ).toThrow("not enough gold");

    const boughtCoin = buyShopCoin(shop, 0, db);
    expect(boughtCoin.gold).toBe(shop.gold - pending.coinPrices[0]!);
    expect(boughtCoin.bag.at(-1)).toBe(pending.coinOptions[0]);
    expect(boughtCoin.shopPurchasedCoins).toBe(1);
    expect(boughtCoin.pendingShop?.coinOptions).not.toContain(
      pending.coinOptions[0],
    );

    const removedOnce = buyShopRemoval(
      { ...shop, bag: ["basic", "fire", "mana"] as never },
      0,
      db,
    );
    expect(removedOnce.gold).toBe(325);
    expect(removedOnce.shopRemovals).toBe(1);
    const removedTwice = buyShopRemoval(removedOnce, 0, db);
    expect(removedTwice.gold).toBe(225);
    expect(removedTwice.shopRemovals).toBe(2);
    expect(() => buyShopRemoval(removedTwice, 0, db)).toThrow(
      "cannot remove the last coin",
    );

    expect(() => buyShopRemoval({ ...shop, gold: 74 }, 0, db)).toThrow(
      "not enough gold",
    );

    const skill = pending.skillOptions[0];
    if (skill === undefined) throw new Error("missing shop skill");
    const boughtSkill = buyShopSkill(shop, 0, db, 0);
    expect(boughtSkill.equippedSkills[0]).toBe(skill);
    expect(boughtSkill.shopPurchasedSkills).toBe(1);
    expect(boughtSkill.pendingShop?.skillOptions).not.toContain(skill);
    expect(() =>
      buyShopSkill(
        {
          ...boughtSkill,
          pendingShop: {
            coinOptions: [],
            coinPrices: [],
            skillOptions: [skill],
            skillPrices: [skillPrice(db, skill)],
          },
        },
        0,
        db,
        1,
      ),
    ).toThrow("shop skill is already owned");
  });

  it("rejects tampered off-pool offers and protects a locked unique skill", () => {
    const db = testDb();
    db.skills["s1"] = {
      ...db.skills["s1"]!,
      bloodOffering: true,
    };
    const shop = { ...reachFirstShop(db), gold: 400 };
    const pending = shop.pendingShop;
    if (pending === undefined) throw new Error("missing pending shop");

    const invalidPriceShop = {
      ...shop,
      pendingShop: {
        ...pending,
        coinOptions: [id<CoinDefId>("mana")],
        coinPrices: [50],
      },
    };
    expect(() => buyShopCoin(invalidPriceShop, 0, db)).toThrow(
      "shop coin price is invalid",
    );

    const foreignSkillShop = {
      ...shop,
      pendingShop: {
        ...pending,
        skillOptions: [id<SkillId>("guardianOnly")],
        skillPrices: [120],
      },
    };
    expect(() => buyShopSkill(foreignSkillShop, 0, db, 1)).toThrow(
      "shop skill is not eligible for this character",
    );

    const offeredSkill = pending.skillOptions[0];
    if (offeredSkill === undefined) throw new Error("missing shop skill");
    expect(() => buyShopSkill(shop, 0, db, 0)).toThrow(
      "locked skill cannot be replaced",
    );

    const rewardState: RunState = {
      ...newRun(db, "LOCKED-REWARD"),
      phase: "rewards",
      pendingRewards: {
        coinOptions: [id<CoinDefId>("basic")],
        coinChoiceResolved: true,
        coinRemovalResolved: true,
        skillOptions: [offeredSkill],
        skillChoiceResolved: false,
      },
    };
    expect(() => chooseSkillReward(rewardState, offeredSkill, 0, db)).toThrow(
      "locked skill cannot be replaced",
    );
    expect(() =>
      chooseSkillReward(
        {
          ...rewardState,
          pendingRewards: {
            ...rewardState.pendingRewards!,
            skillOptions: [id<SkillId>("guardianOnly")],
          },
        },
        id<SkillId>("guardianOnly"),
        1,
        db,
      ),
    ).toThrow("skill reward is not eligible for this character");

    const offSignatureReward = chooseCoinReward(
      {
        ...rewardState,
        pendingRewards: {
          ...rewardState.pendingRewards!,
          coinOptions: [id<CoinDefId>("mana")],
          coinChoiceResolved: false,
          skillChoiceResolved: true,
        },
      },
      id<CoinDefId>("mana"),
      db,
    );
    expect(offSignatureReward.bag.at(-1)).toBe(id<CoinDefId>("mana"));
  });

  it("uses graph and shop streams deterministically and keeps shop coins on the shared weighted canon", () => {
    const db = testDb();
    const graphA = generateRunGraph("P43-DET", db);
    const graphB = generateRunGraph("P43-DET", db);
    const graphC = generateRunGraph("P43-DIVERGE", db);

    expect(graphA).toEqual(graphB);
    expect(JSON.stringify(graphA)).not.toBe(JSON.stringify(graphC));

    const shopA = reachFirstShop(db);
    const shopB = reachFirstShop(db);
    expect(shopA.pendingShop).toEqual(shopB.pendingShop);
    const expectedShopCoins = weightedCoinOptions(
      db,
      shopA.character,
      shopA.bag,
      rngFrom(derive(seedFromString(shopA.runSeed), "shop-2")),
    );
    expect(shopA.pendingShop?.coinOptions).toEqual(expectedShopCoins);

    const rewardStreamCoins = weightedCoinOptions(
      db,
      shopA.character,
      shopA.bag,
      rngFrom(derive(seedFromString(shopA.runSeed), "reward", 0)),
    );
    // 독립 스트림이 우연히 같은 순서를 낼 수 있다.
    // 두 스트림 모두 동일한 전속성 가중 정본을 사용한다는 계약만 고정한다.
    expect(rewardStreamCoins).toHaveLength(3);
    expect(new Set(rewardStreamCoins.map(String)).size).toBe(3);

    const eligible = rewardEligibleSkillIds(
      db.skills,
      shopA.character,
      shopA.equippedSkills,
    );
    expect(eligible).not.toContain(id<SkillId>("guardianOnly"));
    for (const skill of shopA.pendingShop?.skillOptions ?? []) {
      expect(eligible).toContain(skill);
    }
  });
});
