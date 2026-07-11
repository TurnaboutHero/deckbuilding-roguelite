import type { ContentDb } from "../content-types";
import type { CoinDefId, SkillId } from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import { createCombat } from "../combat/reducer";
import type { CombatState } from "../combat/state";
import { RUN_ENCOUNTERS } from "./encounters";
import { RUN_SAVE_VERSION } from "./types";
import type {
  CreateRunConfig,
  EquippedSkills,
  PendingRewards,
  RunState,
} from "./types";

const rewardCoin = (value: string): CoinDefId => value as CoinDefId;
const REWARD_COIN_IDS = [
  rewardCoin("basic"),
  rewardCoin("fire"),
  rewardCoin("mana"),
];

const fallbackCoinOptionsFor = (
  runSeed: string,
  completedCombatIndex: number,
): CoinDefId[] =>
  rngFrom(
    derive(seedFromString(runSeed), "reward-fallback", completedCombatIndex),
  ).shuffle(REWARD_COIN_IDS);

const equippedSkills = (skills: readonly SkillId[]): EquippedSkills => {
  if (skills.length !== 6)
    throw new Error("a run requires exactly six equipped skills");
  return [...skills] as EquippedSkills;
};

const requirePendingRewards = (run: RunState): PendingRewards => {
  if (run.phase !== "rewards" || run.pendingRewards === undefined) {
    throw new Error("run is not resolving rewards");
  }
  return run.pendingRewards;
};

const requireCoinChoiceResolved = (pending: PendingRewards): void => {
  if (!pending.coinChoiceResolved)
    throw new Error("coin reward must be resolved first");
};

const requireCoinRemovalResolved = (pending: PendingRewards): void => {
  requireCoinChoiceResolved(pending);
  if (!pending.coinRemovalResolved)
    throw new Error("coin removal must be resolved first");
};

const finishRewardsIfComplete = (
  run: RunState,
  pendingRewards: PendingRewards,
): RunState => {
  if (
    pendingRewards.coinChoiceResolved &&
    pendingRewards.coinRemovalResolved &&
    pendingRewards.skillChoiceResolved
  ) {
    return { ...run, phase: "ready", pendingRewards: undefined };
  }
  return { ...run, pendingRewards };
};

// 보상 풀 적격 판정의 단일 정본 — exclusiveTo 캐릭터 경계 + 미보유 필터 + 결정론 정렬.
// 코어 보상 생성과 UI 저장 검증(run-storage)이 같은 술어를 공유해 규칙 중복을 막는다.
export const rewardEligibleSkillIds = (
  skills: ContentDb["skills"],
  character: RunState["character"],
  owned: readonly SkillId[],
): SkillId[] => {
  const ownedSet = new Set(owned.map(String));
  return Object.values(skills)
    .filter(
      (skill) =>
        skill.exclusiveTo === undefined ||
        String(skill.exclusiveTo) === String(character),
    )
    .map((skill) => skill.id)
    .filter((skill) => !ownedSet.has(String(skill)))
    .sort((left, right) => String(left).localeCompare(String(right)));
};

const pendingRewardsFor = (
  run: RunState,
  completedCombatIndex: number,
  db: ContentDb,
): PendingRewards => {
  for (const coin of REWARD_COIN_IDS) {
    if (db.coins[String(coin)] === undefined)
      throw new Error(`missing reward coin: ${String(coin)}`);
  }

  const rewardRng = rngFrom(
    derive(seedFromString(run.runSeed), "reward", completedCombatIndex),
  );
  const coinOptions = rewardRng.shuffle(REWARD_COIN_IDS);
  const unowned = rewardEligibleSkillIds(
    db.skills,
    run.character,
    run.equippedSkills,
  );
  const offeredSkills =
    completedCombatIndex >= 1 ? rewardRng.shuffle(unowned).slice(0, 2) : [];
  const skillOptions = offeredSkills.length === 2 ? offeredSkills : [];

  return {
    coinOptions,
    coinChoiceResolved: false,
    coinRemovalResolved: false,
    skillOptions,
    skillChoiceResolved: completedCombatIndex < 1 || skillOptions.length === 0,
  };
};

export const createRun = (config: CreateRunConfig, db: ContentDb): RunState => {
  if (config.contentVersion.length === 0)
    throw new Error("contentVersion is required");
  if (config.runSeed.length === 0) throw new Error("runSeed is required");
  const character = db.characters[String(config.character)];
  if (character === undefined) throw new Error("unknown character");
  for (const coin of character.startingBag) {
    if (db.coins[String(coin)] === undefined)
      throw new Error(`unknown starting coin: ${String(coin)}`);
  }
  for (const skill of character.startingSkills) {
    if (db.skills[String(skill)] === undefined)
      throw new Error(`unknown starting skill: ${String(skill)}`);
  }

  return {
    version: RUN_SAVE_VERSION,
    contentVersion: config.contentVersion,
    runSeed: config.runSeed,
    character: config.character,
    currentHp: character.maxHp,
    maxHp: character.maxHp,
    bag: [...character.startingBag],
    equippedSkills: equippedSkills(character.startingSkills),
    gold: 0,
    combatIndex: 0,
    attempt: 0,
    phase: "ready",
  };
};

export const startRunCombat = (
  run: RunState,
  db: ContentDb,
): { run: RunState; combat: CombatState } => {
  if (run.phase !== "ready")
    throw new Error("run is not ready to start combat");
  if (
    !Number.isInteger(run.combatIndex) ||
    run.combatIndex < 0 ||
    run.combatIndex >= RUN_ENCOUNTERS.length
  ) {
    throw new Error("combat index is out of range");
  }
  if (!Number.isInteger(run.attempt) || run.attempt < 0)
    throw new Error("attempt must be a non-negative integer");
  if (
    !Number.isInteger(run.currentHp) ||
    run.currentHp <= 0 ||
    run.currentHp > run.maxHp
  ) {
    throw new Error("carried HP is out of range");
  }
  const enemies = RUN_ENCOUNTERS[run.combatIndex];
  if (enemies === undefined) throw new Error("encounter does not exist");
  const combat = createCombat(
    {
      character: run.character,
      enemies: [...enemies],
      bag: run.bag,
      equippedSkills: run.equippedSkills,
      currentHp: run.currentHp,
      maxHp: run.maxHp,
      combatIndex: run.combatIndex,
      attempt: run.attempt,
    },
    db,
    run.runSeed,
  );
  return {
    run: { ...run, phase: "combat", pendingRewards: undefined },
    combat,
  };
};

export const settleRunCombat = (
  run: RunState,
  combat: CombatState,
  db: ContentDb,
): RunState => {
  if (run.phase !== "combat") throw new Error("run is not in combat");
  if (combat.phase !== "victory" && combat.phase !== "defeat")
    throw new Error("combat has not ended");
  if (combat.player.maxHp !== run.maxHp)
    throw new Error("combat max HP does not match the run");

  const currentHp = combat.player.hp;
  if (combat.phase === "defeat") {
    return { ...run, currentHp, phase: "defeat", pendingRewards: undefined };
  }

  if (run.combatIndex === RUN_ENCOUNTERS.length - 1) {
    return { ...run, currentHp, phase: "victory", pendingRewards: undefined };
  }

  const pendingRewards = pendingRewardsFor(run, run.combatIndex, db);
  return {
    ...run,
    currentHp,
    combatIndex: run.combatIndex + 1,
    attempt: 0,
    phase: "rewards",
    pendingRewards,
  };
};

export const chooseCoinReward = (
  run: RunState,
  coin: CoinDefId | null,
): RunState => {
  const pending = requirePendingRewards(run);
  if (pending.coinChoiceResolved)
    throw new Error("coin reward is already resolved");
  if (coin !== null && !pending.coinOptions.includes(coin))
    throw new Error("coin is not an offered reward");
  const pendingRewards = { ...pending, coinChoiceResolved: true };
  const bag = coin === null ? [...run.bag] : [...run.bag, coin];
  return finishRewardsIfComplete({ ...run, bag }, pendingRewards);
};

export const resolveCoinRemoval = (
  run: RunState,
  bagIndex: number | null,
): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinChoiceResolved(pending);
  if (pending.coinRemovalResolved)
    throw new Error("coin removal is already resolved");
  const bag = [...run.bag];
  if (bagIndex !== null) {
    if (!Number.isInteger(bagIndex) || bagIndex < 0 || bagIndex >= bag.length) {
      throw new Error("bag index is out of range");
    }
    bag.splice(bagIndex, 1);
  }
  const pendingRewards = { ...pending, coinRemovalResolved: true };
  const completedCombatIndex = run.combatIndex - 1;
  if (completedCombatIndex >= 1 && pendingRewards.skillOptions.length === 0) {
    // The normal coin choice is already materialized in the bag. Reuse the
    // active coin fields for the distinct fallback stage so existing saves and
    // chooseCoinReward callers remain source compatible.
    return {
      ...run,
      bag,
      pendingRewards: {
        ...pendingRewards,
        coinOptions: fallbackCoinOptionsFor(run.runSeed, completedCombatIndex),
        coinChoiceResolved: false,
      },
    };
  }
  return finishRewardsIfComplete({ ...run, bag }, pendingRewards);
};

export const chooseSkillReward = (
  run: RunState,
  skill: SkillId,
  replaceSlot?: number,
): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinRemovalResolved(pending);
  if (pending.skillChoiceResolved)
    throw new Error("skill reward is already resolved");
  if (!pending.skillOptions.includes(skill))
    throw new Error("skill is not an offered reward");
  if (replaceSlot === undefined)
    throw new Error("replaceSlot is required when six slots are equipped");
  if (
    !Number.isInteger(replaceSlot) ||
    replaceSlot < 0 ||
    replaceSlot >= run.equippedSkills.length
  ) {
    throw new Error("replacement slot is out of range");
  }
  const nextSkills = [...run.equippedSkills];
  nextSkills[replaceSlot] = skill;
  return finishRewardsIfComplete(
    { ...run, equippedSkills: equippedSkills(nextSkills) },
    { ...pending, skillChoiceResolved: true },
  );
};

export const skipSkillReward = (run: RunState): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinRemovalResolved(pending);
  if (pending.skillChoiceResolved)
    throw new Error("skill reward is already resolved");
  return finishRewardsIfComplete(run, {
    ...pending,
    skillChoiceResolved: true,
  });
};

export const resumeAbandonedCombat = (run: RunState): RunState => {
  if (run.phase !== "combat") throw new Error("run has no abandoned combat");
  return {
    ...run,
    attempt: run.attempt + 1,
    phase: "ready",
    pendingRewards: undefined,
  };
};
