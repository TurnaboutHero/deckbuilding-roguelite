import { COIN_ENCHANT_IDS, isSuccessLadderFlipSkill } from "../content-types";
import type { ContentDb, EventDef, SkillDef } from "../content-types";
import type {
  CharacterId,
  CoinDefId,
  CoinEnchantId,
  EventDefId,
  PassiveId,
  PermanentCoinUid,
  SkillId,
} from "../ids";
import { derive, rngFrom, seedFromString } from "../rng";
import type { Rng } from "../rng";
import { createCombat } from "../combat/reducer";
import type { CombatState } from "../combat/state";
import {
  actOfLayer,
  enemyScaleForAct,
  generateRunGraph,
  nodeGoldReward,
} from "./graph";
import { MAX_EQUIPPED_SKILLS, RUN_SAVE_VERSION } from "./types";
import type {
  CreateRunConfig,
  EquippedSkills,
  PendingRewards,
  PendingShop,
  PermanentCoinLedger,
  PendingTreasure,
  RunState,
  UpgradedSlots,
} from "./types";

const eventId = (value: string): EventDefId => value as EventDefId;
// Persisted ledgers reserve Number.MAX_SAFE_INTEGER as invalid so every saved
// `nextUid` remains safe to increment. Keep one successor in range when
// issuing a new coin; otherwise the returned run could not be saved.
const MAX_ISSUABLE_PERMANENT_COIN_UID = Number.MAX_SAFE_INTEGER - 1;

const permanentCoinLedgerForBag = (
  bag: readonly CoinDefId[],
): PermanentCoinLedger => ({
  nextUid: bag.length + 1,
  coins: bag.map((defId, index) => ({
    uid: (index + 1) as PermanentCoinUid,
    defId,
  })),
});

const ledgerMatchesBag = (
  ledger: PermanentCoinLedger | undefined,
  bag: readonly CoinDefId[],
): boolean =>
  ledger !== undefined &&
  ledger.coins.length === bag.length &&
  ledger.coins.every(
    (coin, index) => coin.defId === bag[index],
  );

const compatiblePermanentCoins = (run: RunState): PermanentCoinLedger => {
  if (ledgerMatchesBag(run.permanentCoins, run.bag)) return run.permanentCoins;
  if (run.permanentCoins.coins.some((coin) => coin.enchant !== undefined)) {
    throw new Error('permanent coin ledger does not match bag');
  }
  // Source compatibility for direct test/tool states created before v10. The
  // persistence boundary rejects mismatches; only an unenchanted ledger may be
  // reconstructed here.
  return permanentCoinLedgerForBag(run.bag);
};

const appendPermanentCoin = (
  run: RunState,
  defId: CoinDefId,
  enchant?: CoinEnchantId,
): Pick<RunState, 'bag' | 'permanentCoins'> => {
  const ledger = compatiblePermanentCoins(run);
  if (ledger.nextUid >= MAX_ISSUABLE_PERMANENT_COIN_UID) {
    throw new Error('coin UID exhausted');
  }
  return {
    bag: [...run.bag, defId],
    permanentCoins: {
      nextUid: ledger.nextUid + 1,
      coins: [
        ...ledger.coins,
        {
          uid: ledger.nextUid as PermanentCoinUid,
          defId,
          ...(enchant === undefined ? {} : { enchant }),
        },
      ],
    },
  };
};

const removePermanentCoin = (
  run: RunState,
  index: number,
): Pick<RunState, 'bag' | 'permanentCoins'> => {
  const ledger = compatiblePermanentCoins(run);
  return {
    bag: run.bag.filter((_coin, coinIndex) => coinIndex !== index),
    permanentCoins: {
      ...ledger,
      coins: ledger.coins.filter((_coin, coinIndex) => coinIndex !== index),
    },
  };
};

const replacePermanentCoin = (
  run: RunState,
  index: number,
  defId: CoinDefId,
): Pick<RunState, 'bag' | 'permanentCoins'> => {
  const ledger = compatiblePermanentCoins(run);
  return {
    bag: run.bag.map((coin, coinIndex) =>
      coinIndex === index ? defId : coin,
    ),
    permanentCoins: {
      ...ledger,
      coins: ledger.coins.map((coin, coinIndex) =>
        coinIndex === index ? { ...coin, defId } : coin,
      ),
    },
  };
};

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
/** @deprecated Coin rewards/shops now delegate eligibility to the P13 all-element coin policy. */
export const isCoinEligibleForCharacter = (
  db: ContentDb,
  _character: CharacterId,
  coin: CoinDefId,
): boolean => db.coins[String(coin)] !== undefined;

export const isSkillEligibleForCharacter = (
  db: ContentDb,
  character: CharacterId,
  skill: SkillId,
): boolean => {
  const definition = db.skills[String(skill)];
  return (
    definition !== undefined &&
    (definition.exclusiveTo === undefined ||
      String(definition.exclusiveTo) === String(character))
  );
};

export const isLockedSkill = (db: ContentDb, skill: SkillId | null): boolean =>
  skill !== null && db.skills[String(skill)]?.bloodOffering === true;

export const isRewardSkillEligibleForCharacter = (
  db: ContentDb,
  character: CharacterId,
  skill: SkillId,
): boolean =>
  isSkillEligibleForCharacter(db, character, skill) &&
  !isLockedSkill(db, skill) &&
  db.skills[String(skill)]?.retiredFromRewards !== true;

export function weightedCoinOptions(
  db: ContentDb,
  character: CharacterId,
  rng: Rng,
): CoinDefId[];
export function weightedCoinOptions(
  db: ContentDb,
  character: CharacterId,
  bag: readonly CoinDefId[],
  rng: Rng,
): CoinDefId[];
export function weightedCoinOptions(
  db: ContentDb,
  character: CharacterId,
  bagOrRng: readonly CoinDefId[] | Rng,
  maybeRng?: Rng,
): CoinDefId[] {
  const bag =
    maybeRng === undefined ? undefined : (bagOrRng as readonly CoinDefId[]);
  const rng = maybeRng ?? (bagOrRng as Rng);
  const signature = signatureElement(db, character);
  const ownedElements = new Set(
    (bag ?? [])
      .map((coin) => db.coins[String(coin)]?.element)
      .filter((element) => element !== undefined && element !== null),
  );
  const remaining = Object.values(db.coins)
    .filter((coin) => coin.counterfeit !== true)
    .map((coin) => coin.id)
    .sort((left, right) => String(left).localeCompare(String(right)));
  const picks: CoinDefId[] = [];
  const drawCount = Math.min(3, remaining.length);
  for (let draw = 0; draw < drawCount; draw += 1) {
    const weights = remaining.map((coin) => {
      const element = db.coins[String(coin)]!.element;
      if (element === null) return 3;
      if (element === signature) return 4;
      return ownedElements.has(element) ? 2 : 1;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = rng.float() * total;
    let selectedIndex = remaining.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      cursor -= weights[index]!;
      if (cursor < 0) {
        selectedIndex = index;
        break;
      }
    }
    picks.push(remaining[selectedIndex]!);
    remaining.splice(selectedIndex, 1);
  }
  return picks;
}

// fallback 단계도 같은 가중 정본을 공유한다 (§825 — 전환 규칙 동일: ≤3종 레거시 셔플)
const fallbackCoinOptionsFor = (
  run: RunState,
  completedCombatIndex: number,
  db: ContentDb,
): CoinDefId[] => {
  const rng = rngFrom(
    derive(
      seedFromString(run.runSeed),
      "reward-fallback",
      completedCombatIndex,
    ),
  );
  return weightedCoinOptions(db, run.character, run.bag, rng);
};

// P7 D2 — 슬롯 8 일반화: 1~8개 입력을 null 패딩으로 8칸 고정, 빈 슬롯 = null
const equippedSkills = (
  skills: readonly (SkillId | null)[],
): EquippedSkills => {
  if (skills.length < 1 || skills.length > MAX_EQUIPPED_SKILLS)
    throw new Error(
      `a run requires between 1 and ${MAX_EQUIPPED_SKILLS} skill slots`,
    );
  const padded: (SkillId | null)[] = [...skills];
  while (padded.length < MAX_EQUIPPED_SKILLS) padded.push(null);
  if (!padded.some((skill) => skill !== null))
    throw new Error("a run requires at least one equipped skill");
  return padded;
};

// 빈 슬롯이 있으면 빈 슬롯 장착이 기본, 만석이면 replaceSlot 필수 (P7 D2)
const resolveEquipSlot = (
  run: RunState,
  replaceSlot: number | undefined,
): number => {
  if (replaceSlot === undefined) {
    const empty = run.equippedSkills.findIndex((skill) => skill === null);
    if (empty === -1)
      throw new Error("replaceSlot is required when all slots are filled");
    return empty;
  }
  if (
    !Number.isInteger(replaceSlot) ||
    replaceSlot < 0 ||
    replaceSlot >= run.equippedSkills.length
  ) {
    throw new Error("replacement slot is out of range");
  }
  return replaceSlot;
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

const requirePendingEvent = (run: RunState) => {
  if (run.phase !== "event" || run.pendingEvent === undefined) {
    throw new Error("run is not resolving an event");
  }
  return run.pendingEvent;
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
  if (!Number.isInteger(run.eventCombats) || run.eventCombats < 0)
    throw new Error("event combats must be a non-negative integer");
  if (!Number.isInteger(run.eventCoinGains) || run.eventCoinGains < 0)
    throw new Error("event coin gains must be a non-negative integer");
  if (!Number.isInteger(run.eventCoinLosses) || run.eventCoinLosses < 0)
    throw new Error("event coin losses must be a non-negative integer");
  if (
    !Number.isInteger(run.shopPurchasedPassives) ||
    run.shopPurchasedPassives < 0
  )
    throw new Error("shop purchased passives must be a non-negative integer");
  if (!Number.isInteger(run.treasureOpened) || run.treasureOpened < 0)
    throw new Error("treasure opened must be a non-negative integer");
  if (!Number.isInteger(run.restHeals) || run.restHeals < 0)
    throw new Error("rest heals must be a non-negative integer");
  if (!Number.isInteger(run.restUpgrades) || run.restUpgrades < 0)
    throw new Error("rest upgrades must be a non-negative integer");
  if (run.equippedSkills.length !== MAX_EQUIPPED_SKILLS)
    throw new Error("equipped skills must span the fixed slot count");
  if (run.upgradedSlots.length !== run.equippedSkills.length)
    throw new Error("upgraded slots must cover every skill slot");
  if (
    run.equippedSkills.some(
      (skillId, index) => skillId === null && run.upgradedSlots[index],
    )
  )
    throw new Error("empty skill slots cannot be upgraded");
  if (
    new Set(run.acquiredPassives.map(String)).size !==
    run.acquiredPassives.length
  )
    throw new Error("acquired passives must be unique");
  if (run.phase === "shop" && run.pendingShop === undefined)
    throw new Error("shop phase requires pending shop");
  if (run.phase !== "shop" && run.pendingShop !== undefined)
    throw new Error("pending shop is only valid in shop phase");
  if (run.phase === "event" && run.pendingEvent === undefined)
    throw new Error("event phase requires pending event");
  if (run.phase !== "event" && run.pendingEvent !== undefined)
    throw new Error("pending event is only valid in event phase");
  if (run.phase === "treasure" && run.pendingTreasure === undefined)
    throw new Error("treasure phase requires pending treasure");
  if (run.phase !== "treasure" && run.pendingTreasure !== undefined)
    throw new Error("pending treasure is only valid in treasure phase");
  const node =
    run.graph.layers[run.combatIndex]?.[run.nodeChoices[run.combatIndex] ?? 0];
  if (
    run.pendingEventCombat !== undefined &&
    (node?.kind !== "event" ||
      (run.phase !== "ready" && run.phase !== "combat"))
  ) {
    throw new Error(
      "pending event combat is only valid for ready/combat event nodes",
    );
  }
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

const isCombatNodeKind = (
  kind: ReturnType<typeof currentRunNode>["kind"],
): boolean => kind === "combat" || kind === "elite" || kind === "boss";

// ── P6 D2 — 획득 패시브 풀 술어 (스킬 보상과 동형: 전용 경계+미보유+결정론 정렬) ──
export const eligiblePassiveIds = (
  passives: ContentDb["passives"],
  character: CharacterId,
  acquired: readonly PassiveId[],
): PassiveId[] => {
  const owned = new Set(acquired.map(String));
  return Object.values(passives ?? {})
    .filter(
      (passive) =>
        passive.retiredFromRewards !== true &&
        (passive.exclusiveTo === undefined ||
          String(passive.exclusiveTo) === String(character)),
    )
    .map((passive) => passive.id)
    .filter((passive) => !owned.has(String(passive)))
    .sort((left, right) => String(left).localeCompare(String(right)));
};

// 보물/보스 패시브 롤 — passive-<layer> 신규 스트림 (결정론, 완료 상태 재구성 가능)
const rolledPassivesFor = (
  run: RunState,
  layerIndex: number,
  count: number,
  db: ContentDb,
): PassiveId[] => {
  const rng = rngFrom(
    derive(seedFromString(run.runSeed), `passive-${layerIndex}`),
  );
  return rng
    .shuffle(
      eligiblePassiveIds(db.passives, run.character, run.acquiredPassives),
    )
    .slice(0, count);
};

// ── P6 D3 — 스킬 강화 순수 적용 ──
export const deriveUpgradedSkill = (def: SkillDef): SkillDef => {
  const upgrade = def.upgrade;
  if (upgrade === undefined) return def;
  const patch = upgrade.patch;
  if (patch.kind === "multi") {
    return patch.patches.reduce<SkillDef>(
      (current, child) =>
        deriveUpgradedSkill({
          ...current,
          upgrade: { ...upgrade, patch: child },
        }),
      { ...def, upgrade: undefined },
    );
  }
  if (patch.kind === "removeOncePerCombat") {
    const costDelta = patch.costDelta ?? 0;
    if (def.type === "flip")
      return {
        ...def,
        oncePerCombat: undefined,
        cooldown: patch.cooldown,
        cost: def.cost + costDelta,
      };
    return {
      ...def,
      oncePerCombat: undefined,
      cooldown: patch.cooldown,
      consume: { ...def.consume, count: def.consume.count + costDelta },
    };
  }
  if (patch.kind === "costDelta") {
    if (def.type === "flip") return { ...def, cost: def.cost + patch.delta };
    return {
      ...def,
      consume: { ...def.consume, count: def.consume.count + patch.delta },
    };
  }
  if (patch.kind === "ladderAmount") {
    if (def.type !== "flip" || !isSuccessLadderFlipSkill(def)) {
      throw new Error(
        `upgrade ladderAmount requires a success-ladder flip skill: ${String(def.id)}`,
      );
    }
    const ladder = def.successLadder.map((tier) => [...tier]);
    const tier = ladder[patch.tier];
    const atom = tier?.[patch.index];
    const field = patch.field ?? "amount";
    const current = atom?.[field as keyof typeof atom];
    if (
      tier === undefined ||
      atom === undefined ||
      !(field in atom) ||
      typeof current !== "number"
    ) {
      throw new Error(
        `upgrade ladderAmount target is invalid: ${String(def.id)}`,
      );
    }
    tier[patch.index] = {
      ...atom,
      [field]: current + patch.delta,
    } as typeof atom;
    return { ...def, successLadder: ladder };
  }
  if (patch.kind === "addCoinOnUse") {
    const atom = {
      kind: "addCoin" as const,
      coin: patch.coin,
      zone: patch.zone,
      count: patch.count,
    };
    if (def.type === "flip") return { ...def, base: [...(def.base ?? []), atom] };
    return { ...def, effects: [...def.effects, atom] };
  }
  if (patch.kind === "addFaceEffect") {
    if (def.type !== "flip")
      throw new Error(
        `upgrade addFaceEffect requires a flip skill: ${String(def.id)}`,
      );
    const face = def[patch.face];
    return {
      ...def,
      [patch.face]:
        face === undefined
          ? { mode: "any" as const, effects: [patch.effect] }
          : { ...face, effects: [...face.effects, patch.effect] },
    };
  }
  if (patch.kind === "addMixedFaceEffect") {
    if (def.type !== "flip")
      throw new Error(
        `upgrade addMixedFaceEffect requires a flip skill: ${String(def.id)}`,
      );
    return {
      ...def,
      mixed: { effects: [...(def.mixed?.effects ?? []), patch.effect] },
    };
  }
  if (patch.kind === "setFaceMode") {
    if (def.type !== "flip" || def[patch.face] === undefined)
      throw new Error(
        `upgrade setFaceMode requires an existing face: ${String(def.id)}`,
      );
    return { ...def, [patch.face]: { ...def[patch.face]!, mode: patch.mode } };
  }
  if (patch.kind === "replaceEffect") {
    if (patch.section === "base") {
      const atoms = def.type === "flip" ? [...(def.base ?? [])] : [...def.effects];
      if (atoms[patch.index] === undefined)
        throw new Error(
          `upgrade replaceEffect target is invalid: ${String(def.id)}`,
        );
      atoms[patch.index] = patch.effect;
      return def.type === "flip"
        ? { ...def, base: atoms }
        : { ...def, effects: atoms };
    }
    if (patch.section === "overheat") {
      const effects = [...(def.overheatBonus ?? [])];
      if (effects[patch.index] === undefined)
        throw new Error(
          `upgrade replaceEffect overheat target is invalid: ${String(def.id)}`,
        );
      effects[patch.index] = patch.effect;
      return { ...def, overheatBonus: effects };
    }
    if (patch.section === "onRepeatFinish") {
      if (def.type !== "flip" || def.remise?.onRepeatFinish === undefined)
        throw new Error(
          `upgrade replaceEffect onRepeatFinish target is invalid: ${String(def.id)}`,
        );
      const effects = [...def.remise.onRepeatFinish];
      if (effects[patch.index] === undefined)
        throw new Error(
          `upgrade replaceEffect onRepeatFinish target is invalid: ${String(def.id)}`,
        );
      effects[patch.index] = patch.effect;
      return { ...def, remise: { ...def.remise, onRepeatFinish: effects } };
    }
    if (def.type !== "flip" || def[patch.section] === undefined)
      throw new Error(
        `upgrade replaceEffect face is invalid: ${String(def.id)}`,
      );
    const effects = [...def[patch.section]!.effects];
    if (effects[patch.index] === undefined)
      throw new Error(
        `upgrade replaceEffect target is invalid: ${String(def.id)}`,
      );
    effects[patch.index] = patch.effect;
    return { ...def, [patch.section]: { ...def[patch.section]!, effects } };
  }
  if (patch.kind === "setRemiseLightningCount") {
    if (def.type !== "flip" || def.remise === undefined)
      throw new Error(
        `upgrade setRemiseLightningCount requires remise: ${String(def.id)}`,
      );
    return {
      ...def,
      remise: { ...def.remise, addLightningToHandAfterReuse: patch.count },
    };
  }
  // baseAmount — 지정 인덱스 원자의 수치 가산 (콘텐츠 검증이 인덱스/원자 종류를 보증)
  const atoms = def.type === "flip" ? [...(def.base ?? [])] : [...def.effects];
  const atom = atoms[patch.index];
  if (
    atom === undefined ||
    !("amount" in atom) ||
    typeof atom.amount !== "number"
  )
    throw new Error(`upgrade baseAmount target is invalid: ${String(def.id)}`);
  atoms[patch.index] = {
    ...atom,
    amount: atom.amount + patch.delta,
  } as typeof atom;
  return def.type === "flip"
    ? { ...def, base: atoms }
    : { ...def, effects: atoms };
};

// 강화 오버레이 db — 강화된 슬롯의 스킬만 같은 ID로 파생 def 치환 (전투/리플레이 무변경)
export const upgradedContentDb = (run: RunState, db: ContentDb): ContentDb => {
  if (!run.upgradedSlots.some(Boolean)) return db;
  const skills = { ...db.skills };
  run.equippedSkills.forEach((skillId, slotIndex) => {
    if (!run.upgradedSlots[slotIndex]) return;
    const def = db.skills[String(skillId)];
    if (def !== undefined) skills[String(skillId)] = deriveUpgradedSkill(def);
  });
  return { ...db, skills };
};

const signatureCoin = (db: ContentDb, character: CharacterId): CoinDefId => {
  const signature = signatureElement(db, character);
  const coin = Object.values(db.coins).find(
    (candidate) => candidate.element === signature,
  );
  if (coin === undefined) throw new Error("signature coin does not exist");
  return coin.id;
};

export const completedCombatCount = (run: RunState): number => {
  let count = 0;
  const upper = Math.min(run.combatIndex, run.graph.layers.length);
  for (let layerIndex = 0; layerIndex < upper; layerIndex += 1) {
    const node =
      run.graph.layers[layerIndex]?.[run.nodeChoices[layerIndex] ?? 0];
    if (node !== undefined && isCombatNodeKind(node.kind)) count += 1;
  }
  if (run.phase === "victory") {
    const node =
      run.graph.layers[run.combatIndex]?.[
        run.nodeChoices[run.combatIndex] ?? 0
      ];
    if (node !== undefined && isCombatNodeKind(node.kind)) count += 1;
  }
  return count;
};

export const coinEnchantOptionsFor = (
  runSeed: string,
  completedCombatIndex: number,
  count: number,
): CoinEnchantId[] =>
  rngFrom(
    derive(seedFromString(runSeed), "reward-enchant", completedCombatIndex - 1),
  )
    .shuffle(COIN_ENCHANT_IDS)
    .slice(0, count) as CoinEnchantId[];

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
  const exclusive = rng.shuffle(
    eligible.filter(
      (skill) =>
        String(db.skills[String(skill)]?.exclusiveTo) === String(run.character),
    ),
  );
  const shared = rng.shuffle(
    eligible.filter(
      (skill) => db.skills[String(skill)]?.exclusiveTo === undefined,
    ),
  );
  const preferred = [...exclusive.slice(0, 3), ...shared.slice(0, 2)];
  const preferredSet = new Set(preferred.map(String));
  const fill = rng
    .shuffle(eligible.filter((skill) => !preferredSet.has(String(skill))))
    .slice(0, Math.max(0, 5 - preferred.length));
  const skillOptions = [...preferred, ...fill];
  const passiveOptions = rng
    .shuffle(
      eligiblePassiveIds(db.passives, run.character, run.acquiredPassives),
    )
    .slice(0, 1);
  return {
    coinOptions,
    coinPrices: coinOptions.map((coin) =>
      coinShopPrice(db, run.character, coin),
    ),
    skillOptions,
    skillPrices: skillOptions.map((skill) => skillShopPrice(db, skill)),
    passiveOptions,
    passivePrices: passiveOptions.map(
      (passive) => (db.passives ?? {})[String(passive)]!.price,
    ),
  };
};

// 이벤트 롤의 단일 정본 — 저장 검증(run-storage)이 완료 이벤트 prefix를 재구성할 때
// 같은 함수를 공유한다 (중복 RNG 규칙 금지 — P4.4 verifier HIGH 수정).
export const rolledEventIdFor = (
  runSeed: string,
  layerIndex: number,
  db: ContentDb,
): EventDefId => {
  const events = db.events ?? {};
  const eventIds = Object.keys(events).sort();
  if (eventIds.length === 0) throw new Error("content db has no events");
  const rng = rngFrom(derive(seedFromString(runSeed), `event-${layerIndex}`));
  return eventId(eventIds[rng.int(eventIds.length)]!);
};

const pendingEventFor = (run: RunState, layerIndex: number, db: ContentDb) => ({
  eventId: rolledEventIdFor(run.runSeed, layerIndex, db),
});

const eventCombatEncounterFor = (
  run: RunState,
  db: ContentDb,
  event: Extract<EventDef, { risk: "combat" }>,
) => {
  const eventIds = Object.keys(db.events ?? {}).sort();
  const rng = rngFrom(
    derive(seedFromString(run.runSeed), `event-${run.combatIndex}`),
  );
  rng.int(eventIds.length);
  return event.elitePool[rng.int(event.elitePool.length)];
};

const enterCurrentLayer = (run: RunState, db?: ContentDb): RunState => {
  assertRunGraphInvariants(run);
  const layer = run.graph.layers[run.combatIndex];
  if (layer === undefined) throw new Error("combat index is out of range");
  if (layer.length >= 2 && run.phase !== "choose-node") {
    return {
      ...run,
      phase: "choose-node",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
      pendingTreasure: undefined,
    };
  }
  const node = currentRunNode(run);
  if (isCombatNodeKind(node.kind)) {
    return {
      ...run,
      phase: "ready",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
    };
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
      pendingEvent: undefined,
      pendingEventCombat: undefined,
    };
  }
  if (node.kind === "event") {
    if (db === undefined)
      throw new Error("content db is required to enter an event node");
    return {
      ...run,
      phase: "event",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: pendingEventFor(run, run.combatIndex, db),
      pendingEventCombat: undefined,
      pendingTreasure: undefined,
    };
  }
  if (node.kind === "rest") {
    return {
      ...run,
      phase: "rest",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
      pendingTreasure: undefined,
    };
  }
  if (node.kind === "treasure") {
    if (db === undefined)
      throw new Error("content db is required to enter a treasure node");
    const rolled = rolledPassivesFor(run, run.combatIndex, 1, db);
    const pendingTreasure: PendingTreasure = {
      passiveOption: rolled[0] ?? null,
    };
    return {
      ...run,
      phase: "treasure",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
      pendingTreasure,
    };
  }
  throw new Error("unknown run node kind");
};

const finishRewardsIfComplete = (
  run: RunState,
  pendingRewards: PendingRewards,
  db?: ContentDb,
): RunState => {
  if (
    pendingRewards.coinChoiceResolved &&
    pendingRewards.coinRemovalResolved &&
    pendingRewards.skillChoiceResolved &&
    (pendingRewards.passiveChoiceResolved ?? true)
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
  owned: readonly (SkillId | null)[],
): SkillId[] => {
  const ownedSet = new Set(owned.filter((skill) => skill !== null).map(String));
  return Object.values(skills)
    .filter(
      (skill) =>
        skill.bloodOffering !== true &&
        skill.retiredFromRewards !== true &&
        (skill.exclusiveTo === undefined ||
          String(skill.exclusiveTo) === String(character)),
    )
    .map((skill) => skill.id)
    .filter((skill) => !ownedSet.has(String(skill)))
    .sort((left, right) => String(left).localeCompare(String(right)));
};

// P6 D1 보상 신스펙: 일반=동전 3중1택 / 엘리트=+스킬 1 제안 / 보스(비최종)=+패시브 3중1택.
// 제거 단계는 상점 전용으로 회귀 — coinRemovalResolved는 저장 호환용으로 true 고정.
const pendingRewardsFor = (
  run: RunState,
  completedCombatIndex: number,
  db: ContentDb,
  nodeKind: "combat" | "elite" | "boss",
  settledLayerIndex: number,
): PendingRewards => {
  const rewardRng = rngFrom(
    derive(seedFromString(run.runSeed), "reward", completedCombatIndex - 1),
  );
  const coinOptions = weightedCoinOptions(
    db,
    run.character,
    run.bag,
    rewardRng,
  );
  const skillOptions =
    nodeKind === "elite"
      ? rewardRng
          .shuffle(
            rewardEligibleSkillIds(
              db.skills,
              run.character,
              run.equippedSkills,
            ),
          )
          .slice(0, 1)
      : [];
  const passiveOptions =
    nodeKind === "boss" ? rolledPassivesFor(run, settledLayerIndex, 3, db) : [];
  const coinEnchantOptions =
    nodeKind === "elite" || nodeKind === "boss"
      ? coinEnchantOptionsFor(
          run.runSeed,
          completedCombatIndex,
          coinOptions.length,
        )
      : undefined;

  return {
    coinOptions,
    ...(coinEnchantOptions === undefined ? {} : { coinEnchantOptions }),
    coinChoiceResolved: false,
    coinRemovalResolved: true,
    skillOptions,
    skillChoiceResolved: skillOptions.length === 0,
    passiveOptions,
    passiveChoiceResolved: passiveOptions.length === 0,
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
  const bloodSwordInvestment =
    character.trait.mechanic === "bloodSword" ? 0 : undefined;
  return {
    version: RUN_SAVE_VERSION,
    contentVersion: config.contentVersion,
    runSeed: config.runSeed,
    character: config.character,
    currentHp: character.maxHp,
    maxHp: character.maxHp,
    bag: [...character.startingBag],
    permanentCoins: permanentCoinLedgerForBag(character.startingBag),
    equippedSkills: equippedSkills(character.startingSkills),
    upgradedSlots: Array.from(
      { length: MAX_EQUIPPED_SKILLS },
      () => false,
    ) as UpgradedSlots,
    acquiredPassives: [],
    ...(bloodSwordInvestment === undefined ? {} : { bloodSwordInvestment }),
    gold: 0,
    graph,
    nodeChoices: Array.from({ length: graph.layers.length }, () => 0),
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    shopPurchasedPassives: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
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
  if (
    node.kind !== "combat" &&
    node.kind !== "elite" &&
    node.kind !== "boss" &&
    !(node.kind === "event" && run.pendingEventCombat !== undefined)
  )
    throw new Error("current node is not a combat node");
  const event =
    run.pendingEventCombat === undefined
      ? undefined
      : (db.events ?? {})[String(run.pendingEventCombat.eventId)];
  const enemies =
    event?.risk === "combat"
      ? eventCombatEncounterFor(run, db, event)
      : node.encounter;
  if (enemies === undefined || enemies.length === 0)
    throw new Error("encounter does not exist");
  const permanentCoins = compatiblePermanentCoins(run);
  const combat = createCombat(
    {
      character: run.character,
      enemies: [...enemies],
      bag: run.bag,
      permanentCoins: permanentCoins.coins,
      equippedSkills: run.equippedSkills,
      currentHp: run.currentHp,
      maxHp: run.maxHp,
      combatIndex: run.combatIndex,
      attempt: run.attempt,
      passives: run.acquiredPassives,
      bloodSwordInvestment: run.bloodSwordInvestment ?? 0,
      enemyScale: enemyScaleForAct(actOfLayer(run.graph, run.combatIndex)),
    },
    upgradedContentDb(run, db),
    run.runSeed,
  );
  return {
    run: {
      ...run,
      permanentCoins,
      phase: "combat",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
    },
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
  const bloodSwordInvestment =
    db.characters[String(run.character)]?.trait.mechanic === "bloodSword"
      ? combat.player.bloodSwordInvestment
      : undefined;
  if (combat.phase === "defeat") {
    return {
      ...run,
      currentHp,
      ...(bloodSwordInvestment === undefined ? {} : { bloodSwordInvestment }),
      phase: "defeat",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
    };
  }

  const node = currentRunNode(run);
  const resolvedEventCombat =
    node.kind === "event" && run.pendingEventCombat !== undefined;
  const event = resolvedEventCombat
    ? (db.events ?? {})[String(run.pendingEventCombat!.eventId)]
    : undefined;
  if (resolvedEventCombat && event?.risk !== "combat")
    throw new Error("pending event combat is invalid");
  const combatEvent = event?.risk === "combat" ? event : undefined;
  const gold =
    run.gold +
    (combatEvent === undefined
      ? nodeGoldReward(node.kind)
      : combatEvent.goldReward);
  const eventCombats = run.eventCombats + (resolvedEventCombat ? 1 : 0);

  if (run.combatIndex === run.graph.layers.length - 1) {
    return {
      ...run,
      currentHp,
      gold,
      eventCombats,
      ...(bloodSwordInvestment === undefined ? {} : { bloodSwordInvestment }),
      phase: "victory",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
    };
  }

  // P6 D1 보충 — 막 보스 클리어 시 전체 회복: 30방문 런의 누적 소모 산술이
  // 회복 예산(휴식 30%×3)을 결정론적으로 초과해(스모크 0/500, 사람도 불가) 막당
  // HP 예산을 P4 검증 대역(70+휴식)으로 회귀시키는 최소 구조 결정. balance-provisional.
  const actHealedHp = node.kind === "boss" ? run.maxHp : currentHp;
  const nextRun = {
    ...run,
    currentHp: actHealedHp,
    gold,
    eventCombats,
    ...(bloodSwordInvestment === undefined ? {} : { bloodSwordInvestment }),
    combatIndex: run.combatIndex + 1,
    attempt: 0,
    pendingEventCombat: undefined,
  };
  const pendingRewards = pendingRewardsFor(
    nextRun,
    completedCombatCount(nextRun),
    db,
    node.kind === "event"
      ? "combat"
      : (node.kind as "combat" | "elite" | "boss"),
    run.combatIndex,
  );
  const rareSkillOptions =
    combatEvent !== undefined
      ? rngFrom(
          derive(
            seedFromString(run.runSeed),
            "reward",
            completedCombatCount(nextRun) - 1,
          ),
        )
          .shuffle(
            rewardEligibleSkillIds(
              db.skills,
              run.character,
              run.equippedSkills,
            ).filter((skill) => db.skills[String(skill)]?.rarity === "rare"),
          )
          .slice(0, combatEvent.rareSkillOptions)
      : undefined;
  return {
    ...nextRun,
    phase: "rewards",
    pendingRewards:
      rareSkillOptions === undefined
        ? pendingRewards
        : {
            ...pendingRewards,
            skillOptions:
              rareSkillOptions.length === combatEvent!.rareSkillOptions
                ? rareSkillOptions
                : [],
            skillChoiceResolved:
              rareSkillOptions.length !== combatEvent!.rareSkillOptions,
          },
    pendingShop: undefined,
    pendingTreasure: undefined,
  };
};

const advanceAfterEvent = (run: RunState, db: ContentDb): RunState => {
  if (run.combatIndex >= run.graph.layers.length - 1) {
    throw new Error("cannot resolve event after the final layer");
  }
  return enterCurrentLayer(
    {
      ...run,
      combatIndex: run.combatIndex + 1,
      attempt: 0,
      phase: "ready",
      pendingEvent: undefined,
    },
    db,
  );
};

export const acceptEvent = (
  run: RunState,
  db: ContentDb,
  bagIndex?: number,
): RunState => {
  const pending = requirePendingEvent(run);
  assertRunGraphInvariants(run);
  const node = currentRunNode(run);
  if (node.kind !== "event")
    throw new Error("current node is not an event node");
  const event = (db.events ?? {})[String(pending.eventId)];
  if (event === undefined) throw new Error("unknown event");
  if (event.risk === "combat") {
    return {
      ...run,
      phase: "ready",
      pendingEvent: undefined,
      pendingEventCombat: { eventId: pending.eventId },
    };
  }
  const signature = signatureCoin(db, run.character);
  if (event.risk === "hp") {
    if (run.currentHp <= event.requireCurrentHpAbove)
      throw new Error("not enough HP to accept event");
    let rewardedRun = run;
    for (let count = 0; count < event.reward.count; count += 1) {
      rewardedRun = {
        ...rewardedRun,
        ...appendPermanentCoin(rewardedRun, signature),
      };
    }
    return advanceAfterEvent(
      {
        ...rewardedRun,
        currentHp: run.currentHp - event.hpCost,
        eventCoinGains: run.eventCoinGains + event.reward.count,
      },
      db,
    );
  }
  if (bagIndex === undefined)
    throw new Error("bagIndex is required for this event");
  if (!Number.isInteger(bagIndex) || bagIndex < 0 || bagIndex >= run.bag.length)
    throw new Error("bag index is out of range");
  if (String(run.bag[bagIndex]) !== "basic")
    throw new Error("event requires a basic coin");
  if (event.risk === "gold") {
    if (run.gold < event.goldCost) throw new Error("not enough gold");
    return advanceAfterEvent(
      {
        ...run,
        ...replacePermanentCoin(run, bagIndex, signature),
        gold: run.gold - event.goldCost,
        eventCoinGains: run.eventCoinGains + 1,
        eventCoinLosses: run.eventCoinLosses + 1,
      },
      db,
    );
  }
  if (run.bag.length <= event.sacrifice.minimumBagSize)
    throw new Error("cannot sacrifice the last coin");
  const removed = removePermanentCoin(run, bagIndex);
  const replaced = appendPermanentCoin({ ...run, ...removed }, signature);
  return advanceAfterEvent(
    {
      ...run,
      ...replaced,
      eventCoinGains: run.eventCoinGains + 1,
      eventCoinLosses: run.eventCoinLosses + 1,
    },
    db,
  );
};

export const declineEvent = (run: RunState, db: ContentDb): RunState => {
  requirePendingEvent(run);
  assertRunGraphInvariants(run);
  if (currentRunNode(run).kind !== "event")
    throw new Error("current node is not an event node");
  return advanceAfterEvent(run, db);
};

export const chooseCoinReward = (
  run: RunState,
  coin: CoinDefId | null,
  db: ContentDb,
): RunState => {
  const pending = requirePendingRewards(run);
  if (pending.coinChoiceResolved)
    throw new Error("coin reward is already resolved");
  if (coin !== null && !pending.coinOptions.includes(coin))
    throw new Error("coin is not an offered reward");
  if (coin !== null && !isCoinEligibleForCharacter(db, run.character, coin))
    throw new Error("coin reward is not eligible for this character");
  const pendingRewards = { ...pending, coinChoiceResolved: true };
  if (coin === null) {
    return finishRewardsIfComplete({ ...run }, pendingRewards, db);
  }
  const optionIndex = pending.coinOptions.findIndex(
    (option) => option === coin,
  );
  const added = appendPermanentCoin(
    run,
    coin,
    pending.coinEnchantOptions?.[optionIndex],
  );
  return finishRewardsIfComplete({ ...run, ...added }, pendingRewards, db);
};

export const resolveCoinRemoval = (
  run: RunState,
  bagIndex: number | null,
  db: ContentDb,
): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinChoiceResolved(pending);
  if (pending.coinRemovalResolved)
    throw new Error("coin removal is already resolved");
  let coinState: Pick<RunState, 'bag' | 'permanentCoins'> = {
    bag: [...run.bag],
    permanentCoins: compatiblePermanentCoins(run),
  };
  if (bagIndex !== null) {
    if (!Number.isInteger(bagIndex) || bagIndex < 0 || bagIndex >= run.bag.length) {
      throw new Error("bag index is out of range");
    }
    coinState = removePermanentCoin(run, bagIndex);
  }
  const pendingRewards = { ...pending, coinRemovalResolved: true };
  const completedCount = completedCombatCount(run);
  if (completedCount >= 2 && pendingRewards.skillOptions.length === 0) {
    // The normal coin choice is already materialized in the bag. Reuse the
    // active coin fields for the distinct fallback stage so existing saves and
    // chooseCoinReward callers remain source compatible.
    return {
      ...run,
      ...coinState,
      pendingRewards: {
        ...(() => {
          const plainReward = { ...pendingRewards };
          delete plainReward.coinEnchantOptions;
          return plainReward;
        })(),
        coinOptions: fallbackCoinOptionsFor(run, completedCount - 1, db),
        coinChoiceResolved: false,
      },
    };
  }
  return finishRewardsIfComplete({ ...run, ...coinState }, pendingRewards, db);
};

export const chooseSkillReward = (
  run: RunState,
  skill: SkillId,
  replaceSlot: number | undefined,
  db: ContentDb,
): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinRemovalResolved(pending);
  if (pending.skillChoiceResolved)
    throw new Error("skill reward is already resolved");
  if (!pending.skillOptions.includes(skill))
    throw new Error("skill is not an offered reward");
  if (!isRewardSkillEligibleForCharacter(db, run.character, skill)) {
    throw new Error("skill reward is not eligible for this character");
  }
  const targetSlot = resolveEquipSlot(run, replaceSlot);
  if (isLockedSkill(db, run.equippedSkills[targetSlot] ?? null))
    throw new Error("locked skill cannot be replaced");
  const nextSkills = [...run.equippedSkills];
  nextSkills[targetSlot] = skill;
  // 교체 슬롯 강화 리셋 (P6 D3 계약 — 종전 미구현으로 새 스킬이 강화를 상속하던 결함 수정)
  const nextUpgraded = [...run.upgradedSlots] as UpgradedSlots;
  nextUpgraded[targetSlot] = false;
  return finishRewardsIfComplete(
    {
      ...run,
      equippedSkills: equippedSkills(nextSkills),
      upgradedSlots: nextUpgraded,
    },
    { ...pending, skillChoiceResolved: true },
    db,
  );
};

export const skipSkillReward = (run: RunState, db?: ContentDb): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinRemovalResolved(pending);
  if (pending.skillChoiceResolved)
    throw new Error("skill reward is already resolved");
  return finishRewardsIfComplete(
    run,
    {
      ...pending,
      skillChoiceResolved: true,
    },
    db,
  );
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
  if (run.phase !== "choose-node")
    throw new Error("run is not choosing a node");
  assertRunGraphInvariants(run);
  const layer = run.graph.layers[run.combatIndex];
  if (layer === undefined || layer.length < 1) {
    throw new Error("current layer has no selectable node");
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= layer.length) {
    throw new Error("node choice is out of range");
  }
  const nodeChoices = [...run.nodeChoices];
  nodeChoices[run.combatIndex] = choice;
  return enterCurrentLayer({ ...run, nodeChoices }, db);
};

const advanceToNextLayer = (run: RunState, db: ContentDb): RunState => {
  if (run.combatIndex >= run.graph.layers.length - 1)
    throw new Error("cannot advance past the final layer");
  return enterCurrentLayer(
    {
      ...run,
      combatIndex: run.combatIndex + 1,
      attempt: 0,
      phase: "ready",
      pendingRewards: undefined,
      pendingShop: undefined,
      pendingEvent: undefined,
      pendingTreasure: undefined,
    },
    db,
  );
};

const requireRestNode = (run: RunState): void => {
  if (run.phase !== "rest") throw new Error("run is not resting");
  assertRunGraphInvariants(run);
  if (currentRunNode(run).kind !== "rest")
    throw new Error("current node is not a rest node");
};

// P6 D1 — 휴식: 최대 체력 30% 회복(내림, 상한 maxHp) 또는 스킬 강화 택1
export const restHeal = (run: RunState, db: ContentDb): RunState => {
  requireRestNode(run);
  const healed = Math.min(
    run.maxHp,
    run.currentHp + Math.floor(run.maxHp * 0.3),
  );
  return advanceToNextLayer(
    { ...run, currentHp: healed, restHeals: run.restHeals + 1 },
    db,
  );
};

export const restUpgrade = (
  run: RunState,
  slotIndex: number,
  db: ContentDb,
): RunState => {
  requireRestNode(run);
  if (
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    slotIndex >= run.equippedSkills.length
  ) {
    throw new Error("upgrade slot is out of range");
  }
  if (run.upgradedSlots[slotIndex]) throw new Error("slot is already upgraded");
  const def = db.skills[String(run.equippedSkills[slotIndex])];
  if (def === undefined) throw new Error("unknown equipped skill");
  if (def.upgrade === undefined) throw new Error("skill has no upgrade");
  const upgradedSlots = [...run.upgradedSlots] as UpgradedSlots;
  upgradedSlots[slotIndex] = true;
  return advanceToNextLayer(
    { ...run, upgradedSlots, restUpgrades: run.restUpgrades + 1 },
    db,
  );
};

// P6 D1 — 보물: 금화 100 + 패시브 1 부여 (풀 소진 시 금화만)
export const claimTreasure = (run: RunState, db: ContentDb): RunState => {
  if (run.phase !== "treasure" || run.pendingTreasure === undefined)
    throw new Error("run is not opening a treasure");
  assertRunGraphInvariants(run);
  const node = currentRunNode(run);
  if (node.kind !== "treasure")
    throw new Error("current node is not a treasure node");
  const passive = run.pendingTreasure.passiveOption;
  if (passive !== null && (db.passives ?? {})[String(passive)] === undefined)
    throw new Error("treasure passive is unknown");
  return advanceToNextLayer(
    {
      ...run,
      gold: run.gold + nodeGoldReward("treasure"),
      acquiredPassives:
        passive === null
          ? run.acquiredPassives
          : [...run.acquiredPassives, passive],
      treasureOpened: run.treasureOpened + 1,
      pendingTreasure: undefined,
    },
    db,
  );
};

// P6 D2 — 보스 보상 패시브 3중1택 (null = 스킵)
export const choosePassiveReward = (
  run: RunState,
  passive: PassiveId | null,
  db?: ContentDb,
): RunState => {
  const pending = requirePendingRewards(run);
  requireCoinChoiceResolved(pending);
  if (pending.passiveChoiceResolved ?? true)
    throw new Error("passive reward is already resolved");
  if (passive !== null && !(pending.passiveOptions ?? []).includes(passive))
    throw new Error("passive is not an offered reward");
  const acquiredPassives =
    passive === null
      ? run.acquiredPassives
      : [...run.acquiredPassives, passive];
  return finishRewardsIfComplete(
    { ...run, acquiredPassives },
    { ...pending, passiveChoiceResolved: true },
    db,
  );
};

// P6 D2 — 상점 패시브 구매
export const buyShopPassive = (
  run: RunState,
  optionIndex: number,
  db: ContentDb,
): RunState => {
  const pending = requirePendingShop(run);
  assertRunGraphInvariants(run);
  const options = pending.passiveOptions ?? [];
  const prices = pending.passivePrices ?? [];
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= options.length
  )
    throw new Error("shop passive option is out of range");
  const passive = options[optionIndex]!;
  const def = (db.passives ?? {})[String(passive)];
  if (def === undefined) throw new Error("unknown shop passive");
  if (prices[optionIndex] !== def.price)
    throw new Error("shop passive price is invalid");
  if (run.gold < def.price) throw new Error("not enough gold");
  if (run.acquiredPassives.map(String).includes(String(passive)))
    throw new Error("passive is already acquired");
  return {
    ...run,
    gold: run.gold - def.price,
    acquiredPassives: [...run.acquiredPassives, passive],
    shopPurchasedPassives: run.shopPurchasedPassives + 1,
    pendingShop: {
      ...pending,
      passiveOptions: options.filter((_, index) => index !== optionIndex),
      passivePrices: prices.filter((_, index) => index !== optionIndex),
    },
  };
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
  if (!isCoinEligibleForCharacter(db, run.character, coin))
    throw new Error("shop coin is not eligible for this character");
  if (price !== coinShopPrice(db, run.character, coin))
    throw new Error("shop coin price is invalid");
  if (run.gold < price) throw new Error("not enough gold");
  const added = appendPermanentCoin(run, coin);
  return {
    ...run,
    ...added,
    gold: run.gold - price,
    shopPurchasedCoins: run.shopPurchasedCoins + 1,
    pendingShop: {
      ...pending,
      coinOptions: pending.coinOptions.filter(
        (_, index) => index !== optionIndex,
      ),
      coinPrices: pending.coinPrices.filter(
        (_, index) => index !== optionIndex,
      ),
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
  const skill = pending.skillOptions[optionIndex]!;
  if (!isRewardSkillEligibleForCharacter(db, run.character, skill))
    throw new Error("shop skill is not eligible for this character");
  const targetSlot = resolveEquipSlot(run, replaceSlot);
  if (isLockedSkill(db, run.equippedSkills[targetSlot] ?? null))
    throw new Error("locked skill cannot be replaced");
  const price = pending.skillPrices[optionIndex]!;
  if (price !== skillShopPrice(db, skill))
    throw new Error("shop skill price is invalid");
  if (run.gold < price) throw new Error("not enough gold");
  if (run.equippedSkills.map(String).includes(String(skill))) {
    throw new Error("shop skill is already owned");
  }
  const equipped = [...run.equippedSkills];
  equipped[targetSlot] = skill;
  // 교체 슬롯 강화 리셋 (P6 D3 계약 — 상속 결함 수정, 보상 흐름과 동일 규칙)
  const purchasedUpgraded = [...run.upgradedSlots] as UpgradedSlots;
  purchasedUpgraded[targetSlot] = false;
  return {
    ...run,
    gold: run.gold - price,
    equippedSkills: equippedSkills(equipped),
    upgradedSlots: purchasedUpgraded,
    shopPurchasedSkills: run.shopPurchasedSkills + 1,
    pendingShop: {
      ...pending,
      skillOptions: pending.skillOptions.filter(
        (_, index) => index !== optionIndex,
      ),
      skillPrices: pending.skillPrices.filter(
        (_, index) => index !== optionIndex,
      ),
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
  if (
    !Number.isInteger(bagIndex) ||
    bagIndex < 0 ||
    bagIndex >= run.bag.length
  ) {
    throw new Error("bag index is out of range");
  }
  const price = 75 + 25 * run.shopRemovals;
  if (run.gold < price) throw new Error("not enough gold");
  const removed = removePermanentCoin(run, bagIndex);
  return {
    ...run,
    ...removed,
    gold: run.gold - price,
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
