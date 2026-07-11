import type { ContentDb } from "../content-types";
import type { CharacterId, CoinDefId, Element, SkillId } from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import type { Rng } from "../rng";
import { createCombat } from "../combat/reducer";
import type { CombatState } from "../combat/state";
import { generateRunGraph, nodeGoldReward } from "./graph";
import { RUN_SAVE_VERSION } from "./types";
import type {
  CreateRunConfig,
  EquippedSkills,
  PendingRewards,
  PendingShop,
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

const requirePendingShop = (run: RunState): PendingShop => {
  if (run.phase !== "shop" || run.pendingShop === undefined) {
    throw new Error("run is not in a shop");
  }
  return run.pendingShop;
};

// P4.1 코어 불변식 (통합 감사 2차): 정상 내부 흐름 가정으로 검증을 우회하지 않도록
// 모든 public 진입점(start·settle, 향후 shop/event 포함)이 공유하는 단일 헬퍼.
const assertRunGraphInvariants = (run: RunState): void => {
  if (!Number.isInteger(run.gold) || run.gold < 0)
    throw new Error("gold must be a non-negative integer");
  if (!Number.isInteger(run.shopRemovals) || run.shopRemovals < 0)
    throw new Error("shop removals must be a non-negative integer");
  if (!Number.isInteger(run.shopPurchasedCoins) || run.shopPurchasedCoins < 0)
    throw new Error("shop purchased coins must be a non-negative integer");
  if (!Number.isInteger(run.shopPurchasedSkills) || run.shopPurchasedSkills < 0)
    throw new Error("shop purchased skills must be a non-negative integer");
  if (run.phase === "shop" && run.pendingShop === undefined)
    throw new Error("shop phase requires pending shop");
  if (run.phase !== "shop" && run.pendingShop !== undefined)
    throw new Error("pending shop is only valid in shop phase");
  if (run.graph.layers.length === 0)
    throw new Error("run graph must have at least one layer");
  if (run.nodeChoices.length !== run.graph.layers.length)
    throw new Error("node choices must cover every layer");
  // 전 레이어 검사 (감사 3차): 현재 레이어만 보면 미래 레이어의 빈 층·범위 밖
  // 선택이 저장을 타고 살아남는다.
  for (let layer = 0; layer < run.graph.layers.length; layer += 1) {
    const nodes = run.graph.layers[layer];
    if (nodes === undefined || nodes.length === 0)
      throw new Error(`run graph layer ${layer} is empty`);
    const choice = run.nodeChoices[layer];
    if (
      choice === undefined ||
      !Number.isInteger(choice) ||
      choice < 0 ||
      choice >= nodes.length
    ) {
      throw new Error(`node choice for layer ${layer} is out of range`);
    }
  }
};

const currentRunNode = (run: RunState) => {
  if (
    !Number.isInteger(run.combatIndex) ||
    run.combatIndex < 0 ||
    run.combatIndex >= run.graph.layers.length
  ) {
    throw new Error("combat index is out of range");
  }
  const layer = run.graph.layers[run.combatIndex];
  const choice = run.nodeChoices[run.combatIndex];
  if (
    layer === undefined ||
    choice === undefined ||
    !Number.isInteger(choice) ||
    choice < 0 ||
    choice >= layer.length
  ) {
    throw new Error("run node choice is out of range");
  }
  const node = layer[choice];
  if (node === undefined) throw new Error("run node does not exist");
  return node;
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

const isCombatNodeKind = (kind: ReturnType<typeof currentRunNode>["kind"]): boolean =>
  kind === "combat" || kind === "elite" || kind === "boss";

export const completedCombatCount = (run: RunState): number => {
  let count = 0;
  const upper = Math.min(run.combatIndex, run.graph.layers.length);
  for (let layerIndex = 0; layerIndex < upper; layerIndex += 1) {
    const node = run.graph.layers[layerIndex]?.[run.nodeChoices[layerIndex] ?? 0];
    if (node !== undefined && isCombatNodeKind(node.kind)) count += 1;
  }
  if (run.phase === "victory") {
    const node = run.graph.layers[run.combatIndex]?.[run.nodeChoices[run.combatIndex] ?? 0];
    if (node !== undefined && isCombatNodeKind(node.kind)) count += 1;
  }
  return count;
};

const coinShopPrice = (
  db: ContentDb,
  character: CharacterId,
  coin: CoinDefId,
): number => {
  const element = db.coins[String(coin)]?.element;
  if (element === undefined) throw new Error("unknown shop coin");
  if (element === null) return 25;
  return element === signatureElement(db, character) ? 50 : 70;
};

const skillShopPrice = (db: ContentDb, skill: SkillId): number => {
  const rarity = db.skills[String(skill)]?.rarity;
  if (rarity === undefined) throw new Error("unknown shop skill");
  if (rarity === "common") return 50;
  if (rarity === "advanced") return 80;
  return 120;
};

const takeSkills = (
  pool: readonly SkillId[],
  rarity: "common" | "advanced" | "rare",
  count: number,
  db: ContentDb,
  rng: Rng,
): SkillId[] =>
  rng
    .shuffle(pool.filter((skill) => db.skills[String(skill)]?.rarity === rarity))
    .slice(0, count);

const pendingShopFor = (
  run: RunState,
  layerIndex: number,
  db: ContentDb,
): PendingShop => {
  const rng = rngFrom(
    derive(seedFromString(run.runSeed), `shop-${layerIndex}`),
  );
  const coinOptions = weightedCoinOptions(db, run.character, run.bag, rng);
  const eligible = rewardEligibleSkillIds(
    db.skills,
    run.character,
    run.equippedSkills,
  );
  const fixedSkills = [
    ...takeSkills(eligible, "common", 3, db, rng),
    ...takeSkills(eligible, "advanced", 1, db, rng),
  ];
  const fixedSet = new Set(fixedSkills.map(String));
  const randomSkill = rng
    .shuffle(eligible.filter((skill) => !fixedSet.has(String(skill))))
    .slice(0, 1);
  const skillOptions = [...fixedSkills, ...randomSkill];
  return {
    coinOptions,
    coinPrices: coinOptions.map((coin) =>
      coinShopPrice(db, run.character, coin),
    ),
    skillOptions,
    skillPrices: skillOptions.map((skill) => skillShopPrice(db, skill)),
  };
};

const enterCurrentLayer = (run: RunState, db?: ContentDb): RunState => {
  assertRunGraphInvariants(run);
  const layer = run.graph.layers[run.combatIndex];
  if (layer === undefined) throw new Error("combat index is out of range");
  if (layer.length === 2 && run.phase !== "choose-node") {
    return { ...run, phase: "choose-node", pendingRewards: undefined, pendingShop: undefined };
  }
  const node = currentRunNode(run);
  if (isCombatNodeKind(node.kind)) {
    return { ...run, phase: "ready", pendingRewards: undefined, pendingShop: undefined };
  }
  if (node.kind === "shop") {
    // 상점 오퍼 롤에만 콘텐츠 컨텍스트가 필요하다. db 없이 phase만 'ready'로 두는
    // 조용한 폴백은 "상점 레이어에서 전투 시작" 상태 손상을 만든다 — 소리내어 실패.
    if (db === undefined)
      throw new Error("content db is required to enter a shop node");
    return {
      ...run,
      phase: "shop",
      pendingRewards: undefined,
      pendingShop: pendingShopFor(run, run.combatIndex, db),
    };
  }
  throw new Error("event nodes are not active in this run graph");
};

const finishRewardsIfComplete = (
  run: RunState,
  pendingRewards: PendingRewards,
  db?: ContentDb,
): RunState => {
  if (
    pendingRewards.coinChoiceResolved &&
    pendingRewards.coinRemovalResolved &&
    pendingRewards.skillChoiceResolved
  ) {
    // db 유무와 무관하게 레이어 진입 규칙은 동일하다 — db는 상점 진입에서만 필수.
    return enterCurrentLayer({ ...run, pendingRewards: undefined }, db);
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
    derive(seedFromString(run.runSeed), "reward", completedCombatIndex - 1),
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
    completedCombatIndex >= 2 ? rewardRng.shuffle(unowned).slice(0, 2) : [];
  const skillOptions = offeredSkills.length === 2 ? offeredSkills : [];

  return {
    coinOptions,
    coinChoiceResolved: false,
    coinRemovalResolved: false,
    skillOptions,
    skillChoiceResolved: completedCombatIndex < 2 || skillOptions.length === 0,
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

  const graph = generateRunGraph(config.runSeed, db);
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
    graph,
    nodeChoices: Array.from({ length: graph.layers.length }, () => 0),
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
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
    run.combatIndex >= run.graph.layers.length
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
  assertRunGraphInvariants(run);
  const node = currentRunNode(run);
  if (node.kind !== "combat" && node.kind !== "elite" && node.kind !== "boss")
    throw new Error("current node is not a combat node");
  const enemies = node.encounter;
  if (enemies === undefined || enemies.length === 0)
    throw new Error("encounter does not exist");
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
    run: { ...run, phase: "combat", pendingRewards: undefined, pendingShop: undefined },
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
  assertRunGraphInvariants(run);

  const currentHp = combat.player.hp;
  if (combat.phase === "defeat") {
    return { ...run, currentHp, phase: "defeat", pendingRewards: undefined, pendingShop: undefined };
  }

  const node = currentRunNode(run);
  const gold = run.gold + nodeGoldReward(node.kind);

  if (run.combatIndex === run.graph.layers.length - 1) {
    return {
      ...run,
      currentHp,
      gold,
      phase: "victory",
      pendingRewards: undefined,
      pendingShop: undefined,
    };
  }

  const nextRun = {
    ...run,
    currentHp,
    gold,
    combatIndex: run.combatIndex + 1,
    attempt: 0,
  };
  const pendingRewards = pendingRewardsFor(
    nextRun,
    completedCombatCount(nextRun),
    db,
  );
  return {
    ...nextRun,
    phase: "rewards",
    pendingRewards,
    pendingShop: undefined,
  };
};

export const chooseCoinReward = (
  run: RunState,
  coin: CoinDefId | null,
  db?: ContentDb,
): RunState => {
  const pending = requirePendingRewards(run);
  if (pending.coinChoiceResolved)
    throw new Error("coin reward is already resolved");
  if (coin !== null && !pending.coinOptions.includes(coin))
    throw new Error("coin is not an offered reward");
  const pendingRewards = { ...pending, coinChoiceResolved: true };
  const bag = coin === null ? [...run.bag] : [...run.bag, coin];
  return finishRewardsIfComplete({ ...run, bag }, pendingRewards, db);
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
  const completedCount = completedCombatCount(run);
  if (completedCount >= 2 && pendingRewards.skillOptions.length === 0) {
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
            ? legacyFallbackCoinOptions(run.runSeed, completedCount - 1)
            : fallbackCoinOptionsFor(run, completedCount - 1, db),
        coinChoiceResolved: false,
      },
    };
  }
  return finishRewardsIfComplete({ ...run, bag }, pendingRewards, db);
};

export const chooseSkillReward = (
  run: RunState,
  skill: SkillId,
  replaceSlot?: number,
  db?: ContentDb,
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
    db,
  );
};

export const skipSkillReward = (run: RunState, db?: ContentDb): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinRemovalResolved(pending);
  if (pending.skillChoiceResolved)
    throw new Error("skill reward is already resolved");
  return finishRewardsIfComplete(run, {
    ...pending,
    skillChoiceResolved: true,
  }, db);
};

export const resumeAbandonedCombat = (run: RunState): RunState => {
  if (run.phase !== "combat") throw new Error("run has no abandoned combat");
  return {
    ...run,
    attempt: run.attempt + 1,
    phase: "ready",
    pendingRewards: undefined,
    pendingShop: undefined,
  };
};

export const chooseRunNode = (
  run: RunState,
  choice: number,
  db: ContentDb,
): RunState => {
  if (run.phase !== "choose-node") throw new Error("run is not choosing a node");
  assertRunGraphInvariants(run);
  const layer = run.graph.layers[run.combatIndex];
  if (layer === undefined || layer.length !== 2) {
    throw new Error("current layer is not a branch");
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= layer.length) {
    throw new Error("node choice is out of range");
  }
  const nodeChoices = [...run.nodeChoices];
  nodeChoices[run.combatIndex] = choice;
  return enterCurrentLayer({ ...run, nodeChoices }, db);
};

export const buyShopCoin = (
  run: RunState,
  optionIndex: number,
  db: ContentDb,
): RunState => {
  const pending = requirePendingShop(run);
  assertRunGraphInvariants(run);
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= pending.coinOptions.length
  ) {
    throw new Error("shop coin option is out of range");
  }
  const coin = pending.coinOptions[optionIndex]!;
  const price = pending.coinPrices[optionIndex]!;
  if (price !== coinShopPrice(db, run.character, coin))
    throw new Error("shop coin price is invalid");
  if (run.gold < price) throw new Error("not enough gold");
  return {
    ...run,
    gold: run.gold - price,
    bag: [...run.bag, coin],
    shopPurchasedCoins: run.shopPurchasedCoins + 1,
    pendingShop: {
      ...pending,
      coinOptions: pending.coinOptions.filter((_, index) => index !== optionIndex),
      coinPrices: pending.coinPrices.filter((_, index) => index !== optionIndex),
    },
  };
};

export const buyShopSkill = (
  run: RunState,
  optionIndex: number,
  db: ContentDb,
  replaceSlot?: number,
): RunState => {
  const pending = requirePendingShop(run);
  assertRunGraphInvariants(run);
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= pending.skillOptions.length
  ) {
    throw new Error("shop skill option is out of range");
  }
  if (replaceSlot === undefined)
    throw new Error("replaceSlot is required when six slots are equipped");
  if (
    !Number.isInteger(replaceSlot) ||
    replaceSlot < 0 ||
    replaceSlot >= run.equippedSkills.length
  ) {
    throw new Error("replacement slot is out of range");
  }
  const skill = pending.skillOptions[optionIndex]!;
  const price = pending.skillPrices[optionIndex]!;
  if (price !== skillShopPrice(db, skill))
    throw new Error("shop skill price is invalid");
  if (run.gold < price) throw new Error("not enough gold");
  if (run.equippedSkills.map(String).includes(String(skill))) {
    throw new Error("shop skill is already owned");
  }
  const equipped = [...run.equippedSkills];
  equipped[replaceSlot] = skill;
  return {
    ...run,
    gold: run.gold - price,
    equippedSkills: equippedSkills(equipped),
    shopPurchasedSkills: run.shopPurchasedSkills + 1,
    pendingShop: {
      ...pending,
      skillOptions: pending.skillOptions.filter((_, index) => index !== optionIndex),
      skillPrices: pending.skillPrices.filter((_, index) => index !== optionIndex),
    },
  };
};

export const buyShopRemoval = (
  run: RunState,
  bagIndex: number,
  db: ContentDb,
): RunState => {
  requirePendingShop(run);
  assertRunGraphInvariants(run);
  if (run.bag.some((coin) => db.coins[String(coin)] === undefined))
    throw new Error("run bag contains an unknown coin");
  if (run.bag.length <= 1) throw new Error("cannot remove the last coin");
  if (!Number.isInteger(bagIndex) || bagIndex < 0 || bagIndex >= run.bag.length) {
    throw new Error("bag index is out of range");
  }
  const price = 75 + 25 * run.shopRemovals;
  if (run.gold < price) throw new Error("not enough gold");
  const bag = [...run.bag];
  bag.splice(bagIndex, 1);
  return {
    ...run,
    gold: run.gold - price,
    bag,
    shopRemovals: run.shopRemovals + 1,
  };
};

export const leaveShop = (run: RunState, db: ContentDb): RunState => {
  requirePendingShop(run);
  assertRunGraphInvariants(run);
  if (run.combatIndex >= run.graph.layers.length - 1) {
    throw new Error("cannot leave shop after the final layer");
  }
  return enterCurrentLayer(
    {
      ...run,
      combatIndex: run.combatIndex + 1,
      attempt: 0,
      phase: "ready",
      pendingShop: undefined,
    },
    db,
  );
};
