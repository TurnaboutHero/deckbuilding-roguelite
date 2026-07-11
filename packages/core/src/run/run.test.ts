import { describe, expect, it } from "vitest";

import type { ContentDb, SkillDef } from "../content-types";
import type {
  CharacterId,
  CoinDefId,
  CoinUid,
  EnemyDefId,
  SkillId,
} from "../ids";
import type { CombatState } from "../combat/state";
import { RUN_ENCOUNTERS } from "./encounters";
import {
  rewardEligibleSkillIds,
  chooseCoinReward,
  chooseSkillReward,
  createRun,
  resolveCoinRemoval,
  resumeAbandonedCombat,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
} from "./run";
import { RUN_SAVE_VERSION } from "./types";
import type { RunSave, RunState } from "./types";

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
  return {
    coins: {
      basic: { id: id<CoinDefId>("basic"), element: null },
      fire: { id: id<CoinDefId>("fire"), element: "fire" },
      mana: { id: id<CoinDefId>("mana"), element: "mana" },
      // 경계 회귀 고정: 기본 testDb의 보상 풀은 3종을 유지한다 — 풀이 3을 넘으면
      // §825 가중 경로가 켜져 레거시 골든이 전부 흔들린다. 임시 코인 sentinel 'ash'는
      // db 멤버십이 필요 없으므로(전투 상태 직접 주입·미제공 보상 거부용) 여기 넣지 않는다.
    },
    skills,
    enemies: Object.fromEntries(
      ["raider", "shaman", "gatekeeper", "raider-plus", "gatekeeper-plus"].map(
        (enemy) => [enemy, enemyDef(enemy)],
      ),
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

const skipAllRewards = (run: RunState): RunState => {
  let next = chooseCoinReward(run, null);
  next = resolveCoinRemoval(next, null);
  if (next.phase === "rewards") {
    if (next.pendingRewards?.coinChoiceResolved === false)
      next = chooseCoinReward(next, null);
    else if (next.pendingRewards?.skillChoiceResolved === false)
      next = skipSkillReward(next);
  }
  return next;
};

const reachSecondSkillReward = (
  db = testDb(),
  seed = "M5-RUN-GOLDEN",
): RunState => {
  const first = startRunCombat(newRun(seed, db), db);
  const afterFirst = skipAllRewards(
    settleRunCombat(first.run, endedCombat(first.combat, "victory"), db),
  );
  const second = startRunCombat(afterFirst, db);
  return settleRunCombat(second.run, endedCombat(second.combat, "victory"), db);
};

const fallbackTrace = (seed: string, abandonSecondCombat = false) => {
  const db = exhaustedSkillDb();
  const first = startRunCombat(newRun(seed, db), db);
  const afterFirst = skipAllRewards(
    settleRunCombat(first.run, endedCombat(first.combat, "victory"), db),
  );
  let second = startRunCombat(afterFirst, db);
  if (abandonSecondCombat)
    second = startRunCombat(resumeAbandonedCombat(second.run), db);
  let rewards = settleRunCombat(
    second.run,
    endedCombat(second.combat, "victory", 65),
    db,
  );
  const primaryOptions = rewards.pendingRewards?.coinOptions.map(String) ?? [];
  rewards = chooseCoinReward(rewards, null);
  rewards = resolveCoinRemoval(rewards, null);
  return {
    combatRng: second.combat.rng,
    fallback: rewards,
    fallbackOptions: rewards.pendingRewards?.coinOptions.map(String) ?? [],
    primaryOptions,
  };
};

const replayRun = (seed: string) => {
  const db = testDb();
  let run = newRun(seed);
  const encounters: string[][] = [];
  const rewards: { coins: string[]; skills: string[] }[] = [];
  while (run.phase !== "victory") {
    const started = startRunCombat(run, db);
    encounters.push(started.combat.enemies.map((enemy) => String(enemy.defId)));
    run = settleRunCombat(
      started.run,
      endedCombat(started.combat, "victory"),
      db,
    );
    if (run.phase === "rewards" && run.pendingRewards !== undefined) {
      rewards.push({
        coins: run.pendingRewards.coinOptions.map(String),
        skills: run.pendingRewards.skillOptions.map(String),
      });
      run = skipAllRewards(run);
    }
  }
  return { encounters, rewards, run };
};

describe("run progression", () => {
  it("replays the fixed five encounters and reward ordering for a seed", () => {
    const first = replayRun("FIXED-FIVE");
    const second = replayRun("FIXED-FIVE");

    expect(first.encounters).toEqual(
      RUN_ENCOUNTERS.map((encounter) => encounter.map(String)),
    );
    expect(first.rewards).toEqual(second.rewards);
    expect(first.rewards).toEqual([
      { coins: ["fire", "basic", "mana"], skills: [] },
      { coins: ["mana", "basic", "fire"], skills: ["s8", "s9"] },
      { coins: ["basic", "mana", "fire"], skills: ["s8", "s7"] },
      { coins: ["mana", "basic", "fire"], skills: ["s7", "s8"] },
    ]);
    for (const reward of first.rewards) {
      expect(new Set(reward.coins)).toEqual(new Set(["basic", "fire", "mana"]));
      expect(reward.coins).toHaveLength(3);
    }
    expect(first.rewards[0]?.skills).toEqual([]);
    expect(
      first.rewards.slice(1).every((reward) => reward.skills.length === 2),
    ).toBe(true);
    expect(first.run.phase).toBe("victory");
    expect(first.run.combatIndex).toBe(4);
  });

  it("carries lost HP into the next combat without healing", () => {
    const db = testDb();
    const first = startRunCombat(newRun(), db);
    const settled = settleRunCombat(
      first.run,
      endedCombat(first.combat, "victory", 61),
      db,
    );
    const next = startRunCombat(skipAllRewards(settled), db);

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
    run = chooseCoinReward(run, id<CoinDefId>("mana"));
    run = resolveCoinRemoval(run, null);
    const next = startRunCombat(run, db);
    const permanent = Object.values(next.combat.coins)
      .filter((coin) => coin.permanent)
      .map((coin) => String(coin.defId))
      .sort();

    expect(run.bag.map(String)).toContain("mana");
    expect(run.bag.map(String)).not.toContain("ash");
    expect(permanent).toEqual(run.bag.map(String).sort());
    expect(
      Object.values(next.combat.coins).some(
        (coin) => String(coin.defId) === "ash",
      ),
    ).toBe(false);
  });

  // P3.2 명시적 풀 경계: exclusiveTo 스킬은 다른 캐릭터의 보상 풀·셔플에 존재 자체가 개입하지 않는다
  it("excludes exclusiveTo skills from other characters' reward pools across seeds", () => {
    const db = testDb();
    db.skills["gx"] = {
      ...simpleSkill("gx"),
      exclusiveTo: id<CharacterId>("guardian"),
    };
    const baseline = testDb();
    for (const seed of ["A", "B", "C", "D", "E"]) {
      const withExclusive = reachSecondSkillReward(db, seed);
      const options = withExclusive.pendingRewards?.skillOptions.map(String);
      expect(options).not.toContain("gx");
      // 전용 스킬이 풀에 없을 때와 셔플 결과까지 완전 동일 — 존재 자체 비개입
      const control = reachSecondSkillReward(baseline, seed);
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
    expect(Object.keys(testDb().coins).sort()).toEqual(["basic", "fire", "mana"]);
  });

  it("removes one permanent coin and requires an explicit skill replacement slot", () => {
    let run = reachSecondSkillReward();
    const originalBag = [...run.bag];
    run = chooseCoinReward(run, null);
    run = resolveCoinRemoval(run, 0);
    const skill = run.pendingRewards?.skillOptions[0];
    if (skill === undefined) throw new Error("missing skill reward");

    expect(run.bag).toEqual(originalBag.slice(1));
    expect(run.pendingRewards).toMatchObject({
      coinChoiceResolved: true,
      coinRemovalResolved: true,
      skillChoiceResolved: false,
    });
    expect(run.pendingRewards?.skillOptions).toHaveLength(2);
    expect(() => chooseSkillReward(run, skill)).toThrow(
      "replaceSlot is required",
    );
    expect(() => chooseSkillReward(run, skill, 6)).toThrow(
      "replacement slot is out of range",
    );

    const replaced = chooseSkillReward(run, skill, 2);
    expect(replaced.phase).toBe("ready");
    expect(replaced.equippedSkills[2]).toBe(skill);
    expect(replaced.equippedSkills).toHaveLength(6);
  });

  it("supports skipping both coin and skill rewards", () => {
    const reward = reachSecondSkillReward();
    const originalBag = [...reward.bag];
    const originalSkills = [...reward.equippedSkills];
    const skippedCoin = chooseCoinReward(reward, null);
    const skippedRemoval = resolveCoinRemoval(skippedCoin, null);
    const skippedSkill = skipSkillReward(skippedRemoval);

    expect(skippedSkill.phase).toBe("ready");
    expect(skippedSkill.bag).toEqual(originalBag);
    expect(skippedSkill.equippedSkills).toEqual(originalSkills);
  });

  it("replaces an exhausted eligible skill pool with a second coin choice", () => {
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
    const ready = chooseCoinReward(fallback, selected);
    expect(ready.phase).toBe("ready");
    expect(ready.bag).toHaveLength(fallback.bag.length + 1);
    expect(ready.bag.at(-1)).toBe(selected);
  });

  it("requires the fallback coin choice to resolve and supports skipping it", () => {
    const fallback = fallbackTrace("B2-FALLBACK-SKIP").fallback;
    const originalBag = [...fallback.bag];

    expect(fallback.phase).toBe("rewards");
    const ready = chooseCoinReward(fallback, null);
    expect(ready.phase).toBe("ready");
    expect(ready.bag).toEqual(originalBag);
  });

  it("replays fallback order independently from the first reward and combat attempt streams", () => {
    const first = fallbackTrace("B2-FALLBACK-DETERMINISM");
    const replay = fallbackTrace("B2-FALLBACK-DETERMINISM");
    const retried = fallbackTrace("B2-FALLBACK-DETERMINISM", true);

    expect(replay.fallbackOptions).toEqual(first.fallbackOptions);
    expect(retried.fallbackOptions).toEqual(first.fallbackOptions);
    expect(first.fallbackOptions).not.toEqual(first.primaryOptions);
    expect(retried.combatRng).not.toEqual(first.combatRng);
  });

  it("rejects reward actions out of order or outside the reward phase", () => {
    const db = testDb();
    const ready = newRun();
    const started = startRunCombat(ready, db);
    const rewards = reachSecondSkillReward();
    const skill = rewards.pendingRewards?.skillOptions[0];
    if (skill === undefined) throw new Error("missing skill reward");

    expect(() => chooseCoinReward(ready, null)).toThrow(
      "run is not resolving rewards",
    );
    expect(() => resolveCoinRemoval(rewards, null)).toThrow(
      "coin reward must be resolved first",
    );
    expect(() => chooseSkillReward(rewards, skill, 0)).toThrow(
      "coin reward must be resolved first",
    );
    const afterCoin = chooseCoinReward(rewards, null);
    expect(() => chooseSkillReward(afterCoin, skill, 0)).toThrow(
      "coin removal must be resolved first",
    );
    expect(() => skipSkillReward(afterCoin)).toThrow(
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
    const rewards = reachSecondSkillReward();
    expect(() => chooseCoinReward(rewards, id<CoinDefId>("ash"))).toThrow(
      "coin is not an offered reward",
    );

    const afterCoin = chooseCoinReward(rewards, null);
    expect(() => chooseCoinReward(afterCoin, null)).toThrow(
      "coin reward is already resolved",
    );
    expect(() => resolveCoinRemoval(afterCoin, -1)).toThrow(
      "bag index is out of range",
    );

    const afterRemoval = resolveCoinRemoval(afterCoin, null);
    expect(() => resolveCoinRemoval(afterRemoval, null)).toThrow(
      "coin removal is already resolved",
    );
    expect(() => chooseSkillReward(afterRemoval, id<SkillId>("s1"), 0)).toThrow(
      "skill is not an offered reward",
    );
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
      gold: 0,
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
