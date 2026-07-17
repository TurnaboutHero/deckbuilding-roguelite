import { describe, expect, it } from "vitest";

import type { ContentDb, FlipSkillDef, PassiveDef, SkillDef } from "../content-types";
import type {
  CharacterId,
  CoinDefId,
  CoinUid,
  EnemyDefId,
  PassiveId,
  SkillId,
} from "../ids";
import type { CombatState } from "../combat/state";
import { derive, rngFrom, seedFromString } from "../rng";
import { actOfLayer, generateRunGraph, nodeGoldReward } from "./graph";
import {
  rewardEligibleSkillIds,
  chooseRunNode,
  chooseCoinReward,
  choosePassiveReward,
  chooseSkillReward,
  claimTreasure,
  createRun,
  deriveUpgradedSkill,
  resolveCoinRemoval,
  restHeal,
  restUpgrade,
  resumeAbandonedCombat,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  upgradedContentDb,
  leaveShop,
  declineEvent,
} from "./run";
import { RUN_SAVE_VERSION } from "./types";
import type { RunSave, RunState, UpgradedSlots } from "./types";

const id = <T extends string>(value: string): T => value as T;

const simpleSkill = (value: string): SkillDef => ({
  id: id<SkillId>(value),
  name: value,
  type: "flip",
  rarity: "common",
  tags: ["attack"],
  targetType: "single-enemy",
  cost: 1,
  base: [{ kind: "damage", amount: 1 }],
});

// P6 D2 — 획득 패시브 (보물/보스/상점 출처, 런당 1회 중복 불가)
const passiveDef = (value: string, exclusiveTo?: CharacterId): PassiveDef => ({
  id: id<PassiveId>(value),
  name: value,
  description: value,
  ...(exclusiveTo === undefined ? {} : { exclusiveTo }),
  element: null,
  hook: "combatStart",
  effects: [],
  price: 60,
});

const enemyDef = (value: string) => ({
  id: id<EnemyDefId>(value),
  name: value,
  maxHp: 10,
  intents: [{ id: "hit", actions: [{ kind: "attack" as const, damage: 1 }] }],
});

const testDb = (): ContentDb => {
  const skillIds = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
  const skills = Object.fromEntries(
    skillIds.map((skill) => [skill, simpleSkill(skill)]),
  ) as Record<string, SkillDef>;
  // P6 D3 — s1만 강화 정의를 갖는다 (강화 미정의 슬롯 거부 검증용으로 s2~s9는 비워둔다)
  skills["s1"] = {
    ...skills["s1"]!,
    upgrade: {
      name: "s1+",
      description: "피해 +1",
      patch: { kind: "baseAmount", index: 0, delta: 1 },
    },
  };
  return {
    coins: {
      basic: { id: id<CoinDefId>("basic"), element: null },
      // P7 D4 — 속성 코인은 양면 proc 스키마 (런 계층 테스트에서는 플립되지 않는다)
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
      // 경계 회귀 고정: 기본 testDb의 보상 풀은 3종을 유지한다 — 풀이 3을 넘으면
      // §825 가중 경로가 켜져 레거시 골든이 전부 흔들린다. 임시 코인 sentinel 'ash'는
      // db 멤버십이 필요 없으므로(전투 상태 직접 주입·미제공 보상 거부용) 여기 넣지 않는다.
    },
    skills,
    // 보스 3중1택·보물 부여·풀 소진 검증용 — warrior 전용 3 + 타 캐릭터 전용 1(경계 검증)
    passives: {
      p1: passiveDef("p1", id<CharacterId>("warrior")),
      p2: passiveDef("p2", id<CharacterId>("warrior")),
      p3: passiveDef("p3", id<CharacterId>("warrior")),
      gp1: passiveDef("gp1", id<CharacterId>("guardian")),
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
          id<CoinDefId>("basic"),
          id<CoinDefId>("basic"),
          id<CoinDefId>("fire"),
          id<CoinDefId>("fire"),
        ],
        startingSkills: ["s1", "s2", "s3", "s4", "s5", "s6"].map((skill) =>
          id<SkillId>(skill),
        ),
        trait: {
          id: "ember-pouch",
          name: "ember pouch",
          hook: "combatStart",
          effects: [
            {
              kind: "addCoin",
              coin: id<CoinDefId>("fire"),
              zone: "draw",
              count: 1,
            },
          ],
        },
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
  };
};

const exhaustedSkillDb = (): ContentDb => {
  const db = testDb();
  return {
    ...db,
    skills: Object.fromEntries(
      Object.entries(db.skills).filter(([skill]) =>
        ["s1", "s2", "s3", "s4", "s5", "s6"].includes(skill),
      ),
    ),
  };
};

const newRun = (seed = "M5-RUN-GOLDEN", db = testDb()): RunState =>
  createRun(
    {
      contentVersion: "test-m5",
      runSeed: seed,
      character: id<CharacterId>("warrior"),
    },
    db,
  );

const endedCombat = (
  combat: CombatState,
  phase: "victory" | "defeat",
  hp = combat.player.hp,
): CombatState => ({
  ...combat,
  phase,
  player: { ...combat.player, hp },
  enemies: combat.enemies.map((enemy) => ({
    ...enemy,
    hp: phase === "victory" ? 0 : enemy.hp,
  })),
});

const combatNode = (nodeId: string, enemy: string) => ({
  id: nodeId,
  kind: "combat" as const,
  encounter: [id<EnemyDefId>(enemy)],
});

// P6 신스펙 보상 완주: 동전 3택 → (엘리트) 스킬 스킵 → (보스) 패시브 스킵
const resolveAllRewards = (run: RunState, db = testDb()): RunState => {
  let next = run;
  while (next.phase === "rewards") {
    const pending = next.pendingRewards;
    if (pending === undefined) throw new Error("missing pending rewards");
    if (!pending.coinChoiceResolved) next = chooseCoinReward(next, null, db);
    else if (!pending.skillChoiceResolved) next = skipSkillReward(next, db);
    else next = choosePassiveReward(next, null, db);
  }
  return next;
};

// 전투 우선(fight-first) 내비게이션 한 걸음 — 비전투 노드는 최소 개입으로 통과
// (상점 즉시 이탈·이벤트 거절·휴식 회복·보물 수령)
const advanceStep = (run: RunState, db = testDb()): RunState => {
  switch (run.phase) {
    case "choose-node": {
      const layer = run.graph.layers[run.combatIndex] ?? [];
      const fight = layer.findIndex(
        (node) =>
          node.kind === "combat" ||
          node.kind === "elite" ||
          node.kind === "boss",
      );
      return chooseRunNode(run, fight < 0 ? 0 : fight, db);
    }
    case "ready": {
      const started = startRunCombat(run, db);
      return settleRunCombat(
        started.run,
        endedCombat(started.combat, "victory"),
        db,
      );
    }
    case "rewards":
      return resolveAllRewards(run, db);
    case "shop":
      return leaveShop(run, db);
    case "event":
      return declineEvent(run, db);
    case "rest":
      return restHeal(run, db);
    case "treasure":
      return claimTreasure(run, db);
    default:
      throw new Error(`unexpected phase: ${run.phase}`);
  }
};

const advanceUntilReady = (run: RunState, db = testDb()): RunState => {
  let next = run;
  let guard = 0;
  while (next.phase !== "ready") {
    if (++guard > 100) throw new Error("no combat reached");
    next = advanceStep(next, db);
  }
  return next;
};

// P6 D1 — 엘리트 보상(스킬 1 제안)을 결정론으로 도달하는 수제 2-레이어 그래프
const eliteRewardState = (db = testDb(), seed = "ELITE-REWARD"): RunState => {
  const base = newRun(seed, db);
  const run = {
    ...base,
    graph: {
      layers: [
        [
          {
            id: "e0",
            kind: "elite" as const,
            encounter: [id<EnemyDefId>("raider-plus")],
          },
        ],
        [combatNode("c1", "raider")],
      ],
      acts: [{ start: 0 }],
    },
    nodeChoices: [0, 0],
  };
  const started = startRunCombat(run, db);
  return settleRunCombat(
    started.run,
    endedCombat(started.combat, "victory"),
    db,
  );
};

// 레거시 v5 fallback 경로 (acts 없는 그래프 + coinRemovalResolved:false 저장):
// P6 신스펙 보상은 제거 단계를 만들지 않으므로, v5 저장이 실릴 때만 도달한다.
// coinOptions는 v5 보상이 저장했을 reward 스트림 셔플로 재구성한다.
const REWARD_COIN_IDS = ["basic", "fire", "mana"].map((coin) =>
  id<CoinDefId>(coin),
);
const legacyFallbackState = (seed: string, attempt = 0): RunState => {
  const db = exhaustedSkillDb();
  const base = newRun(seed, db);
  return {
    ...base,
    graph: {
      layers: [
        [combatNode("l0", "raider")],
        [combatNode("l1", "shaman")],
        [combatNode("l2", "gatekeeper")],
      ],
    },
    nodeChoices: [0, 0, 0],
    combatIndex: 2,
    attempt,
    phase: "rewards",
    pendingRewards: {
      coinOptions: rngFrom(derive(seedFromString(seed), "reward", 1)).shuffle(
        REWARD_COIN_IDS,
      ),
      coinChoiceResolved: false,
      coinRemovalResolved: false,
      skillOptions: [],
      skillChoiceResolved: true,
    },
  };
};

const fallbackTrace = (seed: string, attempt = 0) => {
  const db = exhaustedSkillDb();
  let rewards = legacyFallbackState(seed, attempt);
  const primaryOptions = rewards.pendingRewards?.coinOptions.map(String) ?? [];
  rewards = chooseCoinReward(rewards, null, db);
  rewards = resolveCoinRemoval(rewards, null, db);
  return {
    fallback: rewards,
    fallbackOptions: rewards.pendingRewards?.coinOptions.map(String) ?? [],
    primaryOptions,
  };
};

const replayRun = (seed: string) => {
  const db = testDb();
  let run = newRun(seed);
  const encounters: string[][] = [];
  const rewards: { coins: string[]; skills: string[]; passives: string[] }[] =
    [];
  let guard = 0;
  while (run.phase !== "victory" && run.phase !== "defeat") {
    if (++guard > 500) throw new Error("replay did not terminate");
    if (run.phase === "ready") {
      const started = startRunCombat(run, db);
      encounters.push(
        started.combat.enemies.map((enemy) => String(enemy.defId)),
      );
      run = settleRunCombat(
        started.run,
        endedCombat(started.combat, "victory"),
        db,
      );
      if (run.phase === "rewards" && run.pendingRewards !== undefined) {
        rewards.push({
          coins: run.pendingRewards.coinOptions.map(String),
          skills: run.pendingRewards.skillOptions.map(String),
          passives: (run.pendingRewards.passiveOptions ?? []).map(String),
        });
        run = resolveAllRewards(run, db);
      }
      continue;
    }
    run = advanceStep(run, db);
  }
  return { encounters, rewards, run };
};

describe("run progression", () => {
  it("replays the generated three-act fight-first encounters and reward ordering for a seed", () => {
    const first = replayRun("FIXED-FIVE");
    const second = replayRun("FIXED-FIVE");

    expect(first.encounters).toEqual(second.encounters);
    expect(first.encounters).toEqual([
      ["shaman"],
      ["shaman"],
      ["raider"],
      ["goblin", "ghoul"],
      ["thief", "goblin"],
      ["goblin", "ghoul"],
      ["ghoul", "goblin", "slime"],
      ["ghoul", "goblin", "slime"],
      ["gatekeeper-plus"],
      ["raider"],
      ["shaman"],
      ["gatekeeper"],
      ["goblin", "ghoul"],
      ["thief", "goblin"],
      ["thief", "goblin"],
      ["goblin", "ghoul"],
      ["ghoul", "goblin", "slime"],
      ["raider-plus", "gatekeeper-plus"],
      ["gatekeeper-plus"],
      ["gatekeeper-plus"],
      ["raider"],
      ["thief", "goblin"],
      ["thief", "goblin"],
      ["gatekeeper-plus"],
      ["ghoul", "goblin", "slime"],
      ["ember-archmage"],
    ]);
    expect(first.rewards).toEqual(second.rewards);
    // 최종(3막) 보스는 보상 없이 victory — 전투 26회 중 25회만 보상을 만든다
    expect(first.rewards).toHaveLength(25);
    for (const reward of first.rewards) {
      expect(new Set(reward.coins)).toEqual(new Set(["basic", "fire", "mana"]));
      expect(reward.coins).toHaveLength(3);
      // P6 신스펙: 스킬은 엘리트 1 제안, 패시브는 보스 3중1택 — 그 외 0
      expect([0, 1]).toContain(reward.skills.length);
      expect([0, 3]).toContain(reward.passives.length);
    }
    // 1·2막 보스 보상만 패시브 3중1택을 낸다 (passive-<layer> 스트림 골든)
    expect(
      first.rewards
        .filter((reward) => reward.passives.length === 3)
        .map((r) => r.passives),
    ).toEqual([
      ["p3", "p2", "p1"],
      ["p2", "p3", "p1"],
    ]);
    // 엘리트 3회(전투 우선 경로) — 각 스킬 1 제안
    expect(
      first.rewards.filter((reward) => reward.skills.length === 1),
    ).toHaveLength(3);
    expect(first.run.phase).toBe("victory");
    expect(first.run.combatIndex).toBe(29);
    expect(first.run.gold).toBe(1210);
  });

  it("creates the active three-act graph and starts combat from the selected node", () => {
    const db = testDb();
    const run = newRun();

    expect(run.graph).toEqual(generateRunGraph(run.runSeed, db));
    expect(run.nodeChoices).toEqual(Array.from({ length: 30 }, () => 0));
    expect(run.shopRemovals).toBe(0);
    expect(run.shopPurchasedCoins).toBe(0);
    expect(run.shopPurchasedSkills).toBe(0);
    expect(run.graph.acts).toEqual([
      { start: 0 },
      { start: 10 },
      { start: 20 },
    ]);
    // 시드 골든: 30레이어 kind 배열 전체 (그래프 스트림 회귀 검출)
    expect(
      run.graph.layers.map((layer) => layer.map((node) => node.kind)),
    ).toEqual([
      ["combat"],
      ["shop", "combat", "event"],
      ["elite", "combat"],
      ["combat", "combat"],
      ["event", "combat", "combat"],
      ["combat", "combat"],
      ["combat", "combat", "event"],
      ["combat", "elite"],
      ["rest"],
      ["boss"],
      ["shop", "event"],
      ["shop", "combat"],
      ["combat", "elite"],
      ["elite", "shop"],
      ["event", "shop"],
      ["event", "elite"],
      ["combat", "combat"],
      ["shop", "combat"],
      ["rest"],
      ["boss"],
      ["combat", "combat"],
      ["shop", "rest"],
      ["elite", "combat", "elite"],
      ["treasure", "treasure", "combat"],
      ["combat", "combat"],
      ["shop", "event", "combat"],
      ["combat", "combat", "rest"],
      ["combat", "combat", "combat"],
      ["rest"],
      ["boss"],
    ]);
    // 고정 규칙: 방문9=rest 단일 / 방문10=막 보스 단일 / 1막 방문1=combat 단일 강제
    for (const restIndex of [8, 18, 28]) {
      expect(run.graph.layers[restIndex]).toHaveLength(1);
      expect(run.graph.layers[restIndex]![0]!.kind).toBe("rest");
    }
    expect(run.graph.layers[9]![0]!.encounter?.map(String)).toEqual([
      "gatekeeper-plus",
    ]);
    expect(run.graph.layers[19]![0]!.encounter?.map(String)).toEqual([
      "raider-plus",
      "gatekeeper-plus",
    ]);
    expect(run.graph.layers[29]![0]!.encounter?.map(String)).toEqual([
      "ember-archmage",
    ]);
    // 분기 방문 후보 2~3개, 1막 방문1~2 후보에서 elite 제외 (가드레일)
    for (const [index, layer] of run.graph.layers.entries()) {
      if (![0, 8, 9, 18, 19, 28, 29].includes(index)) {
        expect(layer.length).toBeGreaterThanOrEqual(2);
        expect(layer.length).toBeLessThanOrEqual(3);
      }
    }
    expect(run.graph.layers[1]!.some((node) => node.kind === "elite")).toBe(
      false,
    );

    const started = startRunCombat(
      {
        ...run,
        graph: {
          layers: [
            [
              {
                id: "custom",
                kind: "combat",
                encounter: [id<EnemyDefId>("gatekeeper")],
              },
            ],
          ],
        },
        nodeChoices: [0],
      },
      db,
    );
    expect(started.combat.enemies.map((enemy) => String(enemy.defId))).toEqual([
      "gatekeeper",
    ]);
  });

  it("guards graph invariants at every public entry point (P4.1 통합 감사)", () => {
    const db = testDb();
    const run = newRun();

    // 비전투 노드·빈 encounter에서 전투 시작 거부 — kind/payload 계약
    expect(() =>
      startRunCombat(
        {
          ...run,
          graph: { layers: [[{ id: "shop-0", kind: "shop" }]] },
          nodeChoices: [0],
        },
        db,
      ),
    ).toThrow("current node is not a combat node");
    expect(() =>
      startRunCombat(
        {
          ...run,
          graph: {
            layers: [[{ id: "empty-0", kind: "combat", encounter: [] }]],
          },
          nodeChoices: [0],
        },
        db,
      ),
    ).toThrow("encounter does not exist");
    expect(() => startRunCombat({ ...run, shopRemovals: -1 }, db)).toThrow(
      "shop removals must be a non-negative integer",
    );

    // settle을 잘못된 run으로 직접 호출해도 동일 불변식이 막는다 —
    // 정상 내부 흐름(start를 거친 run) 가정으로 검증을 우회하지 않는다.
    const started = startRunCombat(run, db);
    const ended = endedCombat(started.combat, "victory");
    expect(() =>
      settleRunCombat({ ...started.run, gold: -1 }, ended, db),
    ).toThrow("gold must be a non-negative integer");
    expect(() =>
      settleRunCombat({ ...started.run, nodeChoices: [0] }, ended, db),
    ).toThrow("node choices must cover every layer");

    // 미래 레이어 손상도 거부 (감사 3차) — 빈 미래 층 / 범위 밖 미래 선택
    const futureEmpty = {
      ...run,
      graph: {
        layers: [
          [
            {
              id: "c-0",
              kind: "combat" as const,
              encounter: run.graph.layers[0]![0]!.encounter,
            },
          ],
          [],
        ],
      },
      nodeChoices: [0, 0],
    };
    expect(() => startRunCombat(futureEmpty, db)).toThrow(
      "run graph layer 1 is empty",
    );
    const futureOutOfRange = {
      ...started.run,
      nodeChoices: started.run.nodeChoices.map((choice, index) =>
        index === started.run.graph.layers.length - 1 ? 5 : choice,
      ),
    };
    expect(() => settleRunCombat(futureOutOfRange, ended, db)).toThrow(
      `node choice for layer ${started.run.graph.layers.length - 1} is out of range`,
    );
  });

  it("uses fixed node gold rewards and matches the visited-node gold sum on a full run", () => {
    const replay = replayRun("P4-GOLD");

    expect(nodeGoldReward("combat")).toBe(35);
    expect(nodeGoldReward("elite")).toBe(70);
    expect(nodeGoldReward("boss")).toBe(100);
    expect(nodeGoldReward("treasure")).toBe(100);
    expect(nodeGoldReward("shop")).toBe(0);
    expect(nodeGoldReward("event")).toBe(0);
    expect(nodeGoldReward("rest")).toBe(0);
    // 불변식: 최종 골드 = 방문한 노드 kind별 고정 보상의 합 (경로 무관 검산)
    const visitedGold = replay.run.graph.layers.reduce(
      (sum, layer, index) =>
        sum + nodeGoldReward(layer[replay.run.nodeChoices[index] ?? 0]!.kind),
      0,
    );
    expect(replay.run.gold).toBe(visitedGold);
    expect(replay.run.gold).toBe(1350);
  });

  it("carries lost HP into the next combat without healing", () => {
    const db = testDb();
    const first = startRunCombat(newRun(), db);
    const settled = settleRunCombat(
      first.run,
      endedCombat(first.combat, "victory", 61),
      db,
    );
    const next = startRunCombat(
      advanceUntilReady(resolveAllRewards(settled, db), db),
      db,
    );

    expect(next.run.currentHp).toBe(61);
    expect(next.combat.player).toMatchObject({ hp: 61, maxHp: 70 });
  });

  it("carries a chosen permanent coin but drops temporary combat coins", () => {
    const db = testDb();
    const first = startRunCombat(newRun(), db);
    const temporaryUid = 999 as CoinUid;
    const withTemporary: CombatState = {
      ...first.combat,
      coins: {
        ...first.combat.coins,
        [Number(temporaryUid)]: {
          uid: temporaryUid,
          defId: id<CoinDefId>("ash"),
          permanent: false,
          grants: [],
        },
      },
      zones: {
        ...first.combat.zones,
        discard: [...first.combat.zones.discard, temporaryUid],
      },
    };
    let run = settleRunCombat(
      first.run,
      endedCombat(withTemporary, "victory"),
      db,
    );
    run = chooseCoinReward(run, id<CoinDefId>("fire"), db);
    const next = startRunCombat(advanceUntilReady(run, db), db);
    const permanent = Object.values(next.combat.coins)
      .filter((coin) => coin.permanent)
      .map((coin) => String(coin.defId))
      .sort();

    expect(run.bag.map(String)).toContain("fire");
    expect(run.bag.map(String)).not.toContain("ash");
    expect(permanent).toEqual(run.bag.map(String).sort());
    expect(
      Object.values(next.combat.coins).some(
        (coin) => String(coin.defId) === "ash",
      ),
    ).toBe(false);
  });

  // P3.2 명시적 풀 경계: exclusiveTo 스킬은 다른 캐릭터의 보상 풀·셔플에 존재 자체가 개입하지 않는다
  // (P6 신스펙에서 스킬 제안은 엘리트 보상 1개 — 수제 엘리트 그래프로 도달)
  it("excludes exclusiveTo skills from other characters' reward pools across seeds", () => {
    for (const seed of ["A", "B", "C", "D", "E"]) {
      const db = testDb();
      db.skills["gx"] = {
        ...simpleSkill("gx"),
        exclusiveTo: id<CharacterId>("guardian"),
      };
      const withExclusive = eliteRewardState(db, seed);
      const options = withExclusive.pendingRewards?.skillOptions.map(String);
      expect(options).toHaveLength(1);
      expect(options).not.toContain("gx");
      // 전용 스킬이 풀에 없을 때와 셔플 결과까지 완전 동일 — 존재 자체 비개입
      const control = eliteRewardState(testDb(), seed);
      expect(options).toEqual(control.pendingRewards?.skillOptions.map(String));
    }
  });

  it("keeps shared skills in every pool and exclusive skills only in their owner's", () => {
    const db = testDb();
    db.characters["guardian"] = {
      ...db.characters["warrior"]!,
      id: id<CharacterId>("guardian"),
      name: "guardian",
    };
    db.skills["gx"] = {
      ...simpleSkill("gx"),
      exclusiveTo: id<CharacterId>("guardian"),
    };
    const owned = db.characters["warrior"]!.startingSkills;
    const guardianPool = rewardEligibleSkillIds(
      db.skills,
      id<CharacterId>("guardian"),
      owned,
    ).map(String);
    const warriorPool = rewardEligibleSkillIds(
      db.skills,
      id<CharacterId>("warrior"),
      owned,
    ).map(String);

    expect(guardianPool).toContain("gx");
    expect(warriorPool).not.toContain("gx");
    // 공용 스킬은 양쪽 풀에 유지된다
    for (const shared of ["s7", "s8", "s9"]) {
      expect(guardianPool).toContain(shared);
      expect(warriorPool).toContain(shared);
    }
  });

  it("keeps the default test pool at 3 coins so legacy goldens stay on the legacy path", () => {
    // ash가 다시 db에 들어오면 이 테스트가 §825 경계 침범을 즉시 알린다
    expect(Object.keys(testDb().coins).sort()).toEqual([
      "basic",
      "fire",
      "mana",
    ]);
  });

  it("resolves a normal combat reward as a single coin pick without removal or skill stages", () => {
    // P6 D1 신스펙: 일반 전투 보상 = 동전 3중1택뿐, 제거 단계는 상점 전용으로 회귀
    const db = testDb();
    const started = startRunCombat(newRun(), db);
    const rewards = settleRunCombat(
      started.run,
      endedCombat(started.combat, "victory"),
      db,
    );

    expect(rewards.pendingRewards).toMatchObject({
      coinChoiceResolved: false,
      coinRemovalResolved: true,
      skillOptions: [],
      skillChoiceResolved: true,
      passiveOptions: [],
      passiveChoiceResolved: true,
    });
    expect(rewards.pendingRewards?.coinOptions).toHaveLength(3);
    expect(rewards.gold).toBe(35);

    const chosen = chooseCoinReward(rewards, id<CoinDefId>("fire"), db);
    // 동전 하나로 보상이 완주된다 — 곧바로 다음 레이어(분기) 진입
    expect(chosen.phase).toBe("choose-node");
    expect(chosen.bag.map(String)).toContain("fire");
    expect(chosen.bag).toHaveLength(rewards.bag.length + 1);
  });

  // P7 D2: 빈 슬롯이 있으면 replaceSlot 생략 시 첫 빈 슬롯에 자동 장착, 만석일 때만 필수
  it("offers one elite skill, auto-fills the first empty slot, and requires replaceSlot only when full", () => {
    const db = testDb();
    const rewards = eliteRewardState(db);
    expect(rewards.gold).toBe(70);
    expect(rewards.pendingRewards).toMatchObject({
      coinChoiceResolved: false,
      coinRemovalResolved: true,
      skillChoiceResolved: false,
    });
    expect(rewards.pendingRewards?.skillOptions).toHaveLength(1);
    // 시작 6스킬 → 8칸 패딩: 슬롯 6·7이 빈 슬롯(null)
    expect(rewards.equippedSkills).toHaveLength(8);
    expect(rewards.equippedSkills.slice(6)).toEqual([null, null]);

    const afterCoin = chooseCoinReward(rewards, null, db);
    // 신스펙 보상에 제거 단계는 존재하지 않는다 (저장 호환 필드만 true 고정)
    expect(() => resolveCoinRemoval(afterCoin, 0, db)).toThrow(
      "coin removal is already resolved",
    );

    const skill = afterCoin.pendingRewards?.skillOptions[0];
    if (skill === undefined) throw new Error("missing skill reward");
    expect(() => chooseSkillReward(afterCoin, skill, 8, db)).toThrow(
      "replacement slot is out of range",
    );
    expect(() => chooseSkillReward(afterCoin, skill, -1, db)).toThrow(
      "replacement slot is out of range",
    );

    // replaceSlot 생략 → 첫 빈 슬롯(6)에 자동 장착
    const autoFilled = chooseSkillReward(afterCoin, skill, undefined, db);
    expect(autoFilled.phase).toBe("ready");
    expect(autoFilled.equippedSkills[6]).toBe(skill);
    expect(autoFilled.equippedSkills).toHaveLength(8);

    // 명시 교체도 여전히 동작하고, 교체 슬롯의 강화 플래그는 리셋된다 (버그 수정 계약)
    const upgradedAtTwo = {
      ...afterCoin,
      upgradedSlots: afterCoin.upgradedSlots.map((_, index) => index === 2),
    };
    const replaced = chooseSkillReward(upgradedAtTwo, skill, 2, db);
    expect(replaced.phase).toBe("ready");
    expect(replaced.equippedSkills[2]).toBe(skill);
    expect(replaced.upgradedSlots[2]).toBe(false);

    // 만석이면 replaceSlot 필수
    const full = {
      ...afterCoin,
      equippedSkills: afterCoin.equippedSkills.map(
        (slotSkill, index) => slotSkill ?? id<SkillId>(`filler-${index}`),
      ),
    };
    expect(() => chooseSkillReward(full, skill, undefined, db)).toThrow(
      "replaceSlot is required when all slots are filled",
    );
  });

  it("supports skipping both coin and skill rewards", () => {
    const db = testDb();
    const reward = eliteRewardState(db);
    const originalBag = [...reward.bag];
    const originalSkills = [...reward.equippedSkills];
    const skippedCoin = chooseCoinReward(reward, null, db);
    const skippedSkill = skipSkillReward(skippedCoin);

    expect(skippedSkill.phase).toBe("ready");
    expect(skippedSkill.bag).toEqual(originalBag);
    expect(skippedSkill.equippedSkills).toEqual(originalSkills);
  });

  // ── 레거시 v5 fallback (소진 풀 → 2차 동전 제안) — acts 없는 그래프 + 미해결
  // 제거 단계 저장으로만 도달하는 경로를 수제 상태로 보존 검증한다 ──
  it("replaces an exhausted eligible skill pool with a second coin choice (legacy v5 saves)", () => {
    const trace = fallbackTrace("B2-FALLBACK-SELECT");
    const fallback = trace.fallback;
    const options = fallback.pendingRewards?.coinOptions;

    expect(fallback).toMatchObject({
      phase: "rewards",
      pendingRewards: {
        coinChoiceResolved: false,
        coinRemovalResolved: true,
        skillOptions: [],
        skillChoiceResolved: true,
      },
    });
    expect(options).toHaveLength(3);
    expect(new Set(options?.map(String))).toEqual(
      new Set(["basic", "fire", "mana"]),
    );

    const selected = options?.[0];
    if (selected === undefined) throw new Error("missing fallback coin option");
    const ready = chooseCoinReward(fallback, selected, exhaustedSkillDb());
    expect(ready.phase).toBe("ready");
    expect(ready.bag).toHaveLength(fallback.bag.length + 1);
    expect(ready.bag.at(-1)).toBe(selected);
  });

  it("requires the fallback coin choice to resolve and supports skipping it", () => {
    const fallback = fallbackTrace("B2-FALLBACK-SKIP").fallback;
    const originalBag = [...fallback.bag];

    expect(fallback.phase).toBe("rewards");
    const ready = chooseCoinReward(fallback, null, exhaustedSkillDb());
    expect(ready.phase).toBe("ready");
    expect(ready.bag).toEqual(originalBag);
  });

  it("replays fallback order independently from the first reward and combat attempt streams", () => {
    const first = fallbackTrace("B2-FALLBACK-DETERMINISM");
    const replay = fallbackTrace("B2-FALLBACK-DETERMINISM");
    // attempt(전투 재도전) 카운터는 reward-fallback 스트림에 개입하지 않는다
    const retried = fallbackTrace("B2-FALLBACK-DETERMINISM", 1);

    expect(replay.fallbackOptions).toEqual(first.fallbackOptions);
    expect(retried.fallbackOptions).toEqual(first.fallbackOptions);
    expect(first.fallbackOptions).not.toEqual(first.primaryOptions);
  });

  it("rejects reward actions out of order or outside the reward phase", () => {
    const db = testDb();
    const ready = newRun();
    const started = startRunCombat(ready, db);
    const rewards = eliteRewardState();
    const skill = rewards.pendingRewards?.skillOptions[0];
    if (skill === undefined) throw new Error("missing skill reward");

    expect(() => chooseCoinReward(ready, null, db)).toThrow(
      "run is not resolving rewards",
    );
    expect(() => resolveCoinRemoval(rewards, null, db)).toThrow(
      "coin reward must be resolved first",
    );
    expect(() => chooseSkillReward(rewards, skill, 0, db)).toThrow(
      "coin reward must be resolved first",
    );
    expect(() => skipSkillReward(rewards)).toThrow(
      "coin reward must be resolved first",
    );
    expect(() => choosePassiveReward(rewards, null)).toThrow(
      "coin reward must be resolved first",
    );
    const afterCoin = chooseCoinReward(rewards, null, db);
    // 엘리트 보상에 패시브 단계는 없다 — 해결 상태로 생성되어 재해결이 거부된다
    expect(() => choosePassiveReward(afterCoin, null)).toThrow(
      "passive reward is already resolved",
    );
    // 레거시 v5 저장의 제거 단계 순서 가드도 유지된다
    const legacy = chooseCoinReward(
      legacyFallbackState("B2-ORDER"),
      null,
      exhaustedSkillDb(),
    );
    const legacySkillPending = {
      ...legacy,
      pendingRewards: {
        ...legacy.pendingRewards!,
        skillOptions: [id<SkillId>("s7")],
        skillChoiceResolved: false,
      },
    };
    expect(() =>
      chooseSkillReward(legacySkillPending, id<SkillId>("s7"), 0, db),
    ).toThrow("coin removal must be resolved first");
    expect(() => skipSkillReward(legacySkillPending)).toThrow(
      "coin removal must be resolved first",
    );
    expect(() => resumeAbandonedCombat(ready)).toThrow(
      "run has no abandoned combat",
    );
    expect(() => startRunCombat(started.run, db)).toThrow(
      "run is not ready to start combat",
    );
    expect(() => settleRunCombat(ready, started.combat, db)).toThrow(
      "run is not in combat",
    );
    expect(() => settleRunCombat(started.run, started.combat, db)).toThrow(
      "combat has not ended",
    );
  });

  it("rejects unoffered rewards, invalid removals, and repeated resolutions", () => {
    const db = testDb();
    const rewards = eliteRewardState(db);
    expect(() => chooseCoinReward(rewards, id<CoinDefId>("ash"), db)).toThrow(
      "coin is not an offered reward",
    );

    const afterCoin = chooseCoinReward(rewards, null, db);
    expect(() => chooseCoinReward(afterCoin, null, db)).toThrow(
      "coin reward is already resolved",
    );
    expect(() =>
      chooseSkillReward(afterCoin, id<SkillId>("s1"), 0, db),
    ).toThrow("skill is not an offered reward");

    // 레거시 v5 제거 단계의 인덱스·중복 해결 가드
    const legacyAfterCoin = chooseCoinReward(
      legacyFallbackState("B2-INVALID"),
      null,
      exhaustedSkillDb(),
    );
    expect(() =>
      resolveCoinRemoval(legacyAfterCoin, -1, exhaustedSkillDb()),
    ).toThrow("bag index is out of range");
  });

  // ── P6 D1 — 휴식: 최대HP 30% 회복(내림·상한) 또는 강화 정의 스킬 1회 강화 택1 ──
  it("heals 30% of max HP at rest nodes with floor rounding and a max-HP cap", () => {
    const db = testDb();
    const restState = (currentHp: number): RunState => ({
      ...newRun("REST-NODE"),
      graph: {
        layers: [
          [{ id: "r0", kind: "rest" as const }],
          [combatNode("c1", "raider")],
        ],
        acts: [{ start: 0 }],
      },
      nodeChoices: [0, 0],
      phase: "rest",
      currentHp,
    });

    // floor(70×0.3)=21 회복, 상한 maxHp=70
    const healed = restHeal(restState(40), db);
    expect(healed.currentHp).toBe(61);
    expect(healed.restHeals).toBe(1);
    expect(healed.phase).toBe("ready");
    expect(healed.combatIndex).toBe(1);
    expect(restHeal(restState(55), db).currentHp).toBe(70);
    expect(() => restHeal(newRun("REST-NODE"), db)).toThrow(
      "run is not resting",
    );
  });

  it("upgrades only skills with a defined upgrade, once per slot, at rest nodes", () => {
    const db = testDb();
    const restState = (upgraded = false): RunState => ({
      ...newRun("REST-UPGRADE"),
      graph: {
        layers: [
          [{ id: "r0", kind: "rest" as const }],
          [combatNode("c1", "raider")],
        ],
        acts: [{ start: 0 }],
      },
      nodeChoices: [0, 0],
      phase: "rest",
      // P7 D2 — 슬롯 8 고정 (equippedSkills와 길이 일치 불변식)
      upgradedSlots: [
        upgraded,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ] as UpgradedSlots,
    });

    const upgraded = restUpgrade(restState(), 0, db);
    expect(upgraded.upgradedSlots).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(upgraded.restUpgrades).toBe(1);
    expect(upgraded.phase).toBe("ready");
    // 강화 미정의(s2)·이미 강화된 슬롯·범위 밖 슬롯 거부
    expect(() => restUpgrade(restState(), 1, db)).toThrow(
      "skill has no upgrade",
    );
    expect(() => restUpgrade(restState(true), 0, db)).toThrow(
      "slot is already upgraded",
    );
    expect(() => restUpgrade(restState(), 9, db)).toThrow(
      "upgrade slot is out of range",
    );

    // D3 — 순수 강화 적용: patch(baseAmount +1)가 파생 def에만 반영, 원본 불변
    const derived = deriveUpgradedSkill(db.skills["s1"]!);
    expect(derived.type === "flip" && derived.base?.[0]).toEqual({
      kind: "damage",
      amount: 2,
    });
    const original = db.skills["s1"]!;
    expect(original.type === "flip" && original.base?.[0]).toEqual({
      kind: "damage",
      amount: 1,
    });
    // 강화 오버레이 db — 강화 슬롯 스킬만 같은 ID로 치환, 나머지는 그대로
    const overlay = upgradedContentDb(upgraded, db);
    const overlayS1 = overlay.skills["s1"]!;
    expect(overlayS1.type === "flip" && overlayS1.base?.[0]).toEqual({
      kind: "damage",
      amount: 2,
    });
    expect(overlay.skills["s2"]).toBe(db.skills["s2"]);
    expect(upgradedContentDb(restState(), db)).toBe(db);
  });

  it("replaces remise repeat finish effects in upgraded overlays without mutating the base skill", () => {
    const db = testDb();
    db.skills["s1"] = {
      ...(simpleSkill("s1") as FlipSkillDef),
      remise: {
        onRepeatFinish: [
          { kind: "applyStatus", status: "shock", stacks: 1, to: "target" },
        ],
      },
      upgrade: {
        name: "s1+",
        description: "반복 종료 감전 1 → 2",
        patch: {
          kind: "replaceEffect",
          section: "onRepeatFinish",
          index: 0,
          effect: {
            kind: "applyStatus",
            status: "shock",
            stacks: 2,
            to: "target",
          },
        },
      },
    };
    const run = {
      ...newRun("REMISE-UPGRADE"),
      upgradedSlots: [true, false, false, false, false, false, false, false],
    } as RunState;

    const derived = deriveUpgradedSkill(db.skills["s1"]!);
    expect(derived.type === "flip" && derived.remise?.onRepeatFinish).toEqual([
      { kind: "applyStatus", status: "shock", stacks: 2, to: "target" },
    ]);
    expect(
      db.skills["s1"]!.type === "flip" &&
        db.skills["s1"]!.remise?.onRepeatFinish,
    ).toEqual([
      { kind: "applyStatus", status: "shock", stacks: 1, to: "target" },
    ]);
    const overlayS1 = upgradedContentDb(run, db).skills["s1"]!;
    expect(overlayS1.type === "flip" && overlayS1.remise?.onRepeatFinish).toEqual([
      { kind: "applyStatus", status: "shock", stacks: 2, to: "target" },
    ]);
  });

  // ── P6 D1 — 보물: 금화 100 + 결정론 패시브 1 부여, 풀 소진 시 금화만 ──
  it("grants 100 gold plus a rolled passive at treasure nodes, or gold only when exhausted", () => {
    const db = testDb();
    const treasureChoiceState = (acquired: string[] = []): RunState => ({
      ...newRun("TREASURE-NODE"),
      graph: {
        layers: [
          [{ id: "t0", kind: "treasure" as const }, combatNode("c0", "raider")],
          [combatNode("c1", "raider")],
        ],
        acts: [{ start: 0 }],
      },
      nodeChoices: [0, 0],
      phase: "choose-node",
      acquiredPassives: acquired.map((passive) => id<PassiveId>(passive)),
    });

    const entered = chooseRunNode(treasureChoiceState(), 0, db);
    expect(entered.phase).toBe("treasure");
    // passive-<layer> 스트림 결정론 롤 — warrior 적격 풀(p1~p3)에서만 나온다
    const rolled = entered.pendingTreasure?.passiveOption;
    expect(["p1", "p2", "p3"]).toContain(String(rolled));
    expect(chooseRunNode(treasureChoiceState(), 0, db).pendingTreasure).toEqual(
      entered.pendingTreasure,
    );

    const claimed = claimTreasure(entered, db);
    expect(claimed.gold).toBe(entered.gold + 100);
    expect(claimed.acquiredPassives).toEqual([rolled]);
    expect(claimed.treasureOpened).toBe(1);
    expect(claimed.phase).toBe("ready");
    expect(claimed.pendingTreasure).toBeUndefined();

    // 풀 소진(전 패시브 보유): 패시브 없이 금화만
    const exhausted = chooseRunNode(
      treasureChoiceState(["p1", "p2", "p3"]),
      0,
      db,
    );
    expect(exhausted.pendingTreasure).toEqual({ passiveOption: null });
    const claimedExhausted = claimTreasure(exhausted, db);
    expect(claimedExhausted.gold).toBe(exhausted.gold + 100);
    expect(claimedExhausted.acquiredPassives.map(String)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  // ── P6 D1/D2 — 막 전환·보스 패시브 3중1택·막별 적 스케일 ──
  it("offers three boss passives, supports skipping, and scales act-2 enemies by 1.15", () => {
    const db = testDb();
    let run = newRun("ACT-TRANSITION");
    let guard = 0;
    // 1막 보스(방문10, 레이어 9)까지 전투 우선 진행
    while (!(run.phase === "ready" && run.combatIndex === 9)) {
      if (++guard > 100) throw new Error("did not reach the act-1 boss");
      run = advanceStep(run, db);
    }
    const boss = startRunCombat(run, db);
    // 1막 스케일 ×1.0 — 정의 수치 그대로
    expect(boss.combat.enemies.map((enemy) => String(enemy.defId))).toEqual([
      "gatekeeper-plus",
    ]);
    expect(boss.combat.enemies[0]!.maxHp).toBe(10);

    const settled = settleRunCombat(
      boss.run,
      endedCombat(boss.combat, "victory"),
      db,
    );
    // 보스 보상: 금화 100 + 동전 3택 + 패시브 3중1택 (제거 단계 없음)
    expect(settled.gold).toBe(run.gold + 100);
    expect(settled.pendingRewards).toMatchObject({
      coinRemovalResolved: true,
      skillOptions: [],
      skillChoiceResolved: true,
      passiveChoiceResolved: false,
    });
    expect(settled.pendingRewards?.passiveOptions).toHaveLength(3);
    expect(
      new Set(settled.pendingRewards?.passiveOptions?.map(String)),
    ).toEqual(new Set(["p1", "p2", "p3"]));

    const afterCoin = chooseCoinReward(settled, null, db);
    expect(afterCoin.phase).toBe("rewards");
    expect(() =>
      choosePassiveReward(afterCoin, id<PassiveId>("p9"), db),
    ).toThrow("passive is not an offered reward");

    // 스킵: 획득 없이 막 전환
    const skipped = choosePassiveReward(afterCoin, null, db);
    expect(skipped.acquiredPassives).toEqual([]);
    expect(skipped.phase).toBe("choose-node");

    // 선택: 획득 후 2막(레이어 10, act 1) choose-node 진입
    const option = afterCoin.pendingRewards?.passiveOptions?.[0];
    if (option === undefined) throw new Error("missing boss passive option");
    const chosen = choosePassiveReward(afterCoin, option, db);
    expect(chosen.acquiredPassives).toEqual([option]);
    expect(chosen.phase).toBe("choose-node");
    expect(chosen.combatIndex).toBe(10);
    expect(actOfLayer(chosen.graph, chosen.combatIndex)).toBe(1);

    // 2막 전투의 적 maxHp = 정의 × 1.15 반올림 (10 → 14)
    const nextCombat = startRunCombat(advanceUntilReady(chosen, db), db);
    for (const enemy of nextCombat.combat.enemies) {
      expect(enemy.maxHp).toBe(Math.round(10 * 1.15));
    }
  });

  it("replays one attempt and changes an abandoned attempt without changing rewards", () => {
    const db = testDb();
    const ready = newRun("ATTEMPT-SALT");
    const first = startRunCombat(ready, db);
    const replay = startRunCombat(ready, db);
    const resumed = resumeAbandonedCombat(first.run);
    const retried = startRunCombat(resumed, db);

    expect(replay.combat).toEqual(first.combat);
    expect(retried.run.attempt).toBe(1);
    expect(retried.combat.rng).not.toEqual(first.combat.rng);

    const firstRewards = settleRunCombat(
      first.run,
      endedCombat(first.combat, "victory", 64),
      db,
    );
    const retryRewards = settleRunCombat(
      retried.run,
      endedCombat(retried.combat, "victory", 64),
      db,
    );
    expect(retryRewards.pendingRewards).toEqual(firstRewards.pendingRewards);
    expect(retryRewards.attempt).toBe(0);
  });

  it("preserves every run-boundary field through a JSON save round trip", () => {
    const db = testDb();
    const started = startRunCombat(newRun("SAVE-ROUND-TRIP"), db);
    const rewards = settleRunCombat(
      started.run,
      endedCombat(started.combat, "victory", 63),
      db,
    );
    const save: RunSave = rewards;
    const parsed = JSON.parse(JSON.stringify(save)) as RunSave;

    expect(parsed).toEqual(save);
    expect(parsed).toMatchObject({
      version: RUN_SAVE_VERSION,
      contentVersion: "test-m5",
      runSeed: "SAVE-ROUND-TRIP",
      currentHp: 63,
      maxHp: 70,
      gold: 35,
      graph: generateRunGraph("SAVE-ROUND-TRIP", db),
      nodeChoices: Array.from({ length: 30 }, () => 0),
      upgradedSlots: [false, false, false, false, false, false, false, false],
      acquiredPassives: [],
      shopRemovals: 0,
      shopPurchasedCoins: 0,
      shopPurchasedSkills: 0,
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      combatIndex: 1,
      attempt: 0,
      phase: "rewards",
    });
    expect(JSON.stringify(parsed)).not.toMatch(/rngImpl|zones|events/);
  });

  it("preserves the encounter and attempt on deterministic defeat", () => {
    const db = testDb();
    const first = startRunCombat(newRun("DEFEAT"), db);
    const retried = startRunCombat(resumeAbandonedCombat(first.run), db);
    const defeated = settleRunCombat(
      retried.run,
      endedCombat(retried.combat, "defeat", 0),
      db,
    );

    expect(defeated).toMatchObject({
      phase: "defeat",
      currentHp: 0,
      combatIndex: 0,
      attempt: 1,
    });
    expect(defeated.pendingRewards).toBeUndefined();
  });
});
