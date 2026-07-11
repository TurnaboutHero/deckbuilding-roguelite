import type { ContentDb } from "../content-types";
import type { CharacterId, CoinDefId, Element, SkillId } from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import type { Rng } from "../rng";
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

// ---- 코인 보상 가중 (P3.4, §825 게이트) -------------------------------------
// 풀이 3종을 넘는 순간 "대표 속성 + 보유 속성 가중"이 필수이며 상점 진열도 이 함수를
// 공유한다. 가중치는 기준표 안 임시값 — balance-provisional (사람 데이터 전 확정 금지).
const WEIGHT_BASIC = 30;
const WEIGHT_SIGNATURE = 50;
const WEIGHT_OTHER = 20;
const WEIGHT_OWNED_BONUS = 15;

// 캐릭터 대표 속성은 스키마 확장 없이 시작 가방의 비기본 최빈 속성에서 유도한다
// (모든 캐릭터가 "기본 8 + 대표 2" 규격 — content-design-guide 캐릭터 양식).
export const signatureElement = (
  db: ContentDb,
  character: CharacterId,
): string | null => {
  const def = db.characters[String(character)];
  if (def === undefined) return null;
  const counts = new Map<string, number>();
  for (const coin of def.startingBag) {
    const element = db.coins[String(coin)]?.element;
    if (element == null) continue;
    counts.set(element, (counts.get(element) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [element, count] of counts) {
    if (count > bestCount) {
      best = element;
      bestCount = count;
    }
  }
  return best;
};

// 보상·상점 공유 단일 정본: 결정론 가중 비복원 3택 (reward 스트림 rng만 사용)
export const weightedCoinOptions = (
  db: ContentDb,
  character: CharacterId,
  bag: readonly CoinDefId[],
  rng: Rng,
): CoinDefId[] => {
  const signature = signatureElement(db, character);
  const ownedElements = new Set(
    bag
      .map((coin) => db.coins[String(coin)]?.element)
      .filter((element): element is Element => element != null),
  );
  const candidates = Object.values(db.coins).map((coin) => {
    const element = coin.element;
    let weight =
      element === null
        ? WEIGHT_BASIC
        : element === signature
          ? WEIGHT_SIGNATURE
          : WEIGHT_OTHER;
    if (element !== null && ownedElements.has(element)) {
      weight += WEIGHT_OWNED_BONUS;
    }
    return { id: coin.id, weight };
  });
  const picks: CoinDefId[] = [];
  const pool = [...candidates];
  while (picks.length < 3 && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng.float() * total;
    let index = 0;
    for (; index < pool.length - 1; index += 1) {
      roll -= pool[index]!.weight;
      if (roll < 0) break;
    }
    picks.push(pool[index]!.id);
    pool.splice(index, 1);
  }
  return picks;
};

const legacyFallbackCoinOptions = (
  runSeed: string,
  completedCombatIndex: number,
): CoinDefId[] =>
  rngFrom(
    derive(seedFromString(runSeed), "reward-fallback", completedCombatIndex),
  ).shuffle(REWARD_COIN_IDS);

// fallback 단계도 같은 가중 정본을 공유한다 (§825 — 전환 규칙 동일: ≤3종 레거시 셔플)
const fallbackCoinOptionsFor = (
  run: RunState,
  completedCombatIndex: number,
  db: ContentDb,
): CoinDefId[] => {
  const rng = rngFrom(
    derive(seedFromString(run.runSeed), "reward-fallback", completedCombatIndex),
  );
  return Object.keys(db.coins).length <= 3
    ? rng.shuffle(REWARD_COIN_IDS)
    : weightedCoinOptions(db, run.character, run.bag, rng);
};

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
  // §825 전환 규칙: 풀 ≤3종이면 레거시 전량 셔플(바이트 불변), >3종이면 가중 3택
  const coinPoolSize = Object.keys(db.coins).length;
  const coinOptions =
    coinPoolSize <= 3
      ? rewardRng.shuffle(REWARD_COIN_IDS)
      : weightedCoinOptions(db, run.character, run.bag, rewardRng);
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
  // 가중 fallback(§825)에 콘텐츠 컨텍스트가 필요하다. 미전달 시 레거시 3종 셔플 —
  // 풀 ≤3종 환경(기존 테스트)에서는 두 경로가 동일하다.
  db?: ContentDb,
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
        coinOptions:
          db === undefined
            ? legacyFallbackCoinOptions(run.runSeed, completedCombatIndex)
            : fallbackCoinOptionsFor(run, completedCombatIndex, db),
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
