import { LEGACY_CONTENT_VERSIONS } from "@game/content";
import {
  RUN_ENCOUNTERS,
  RUN_SAVE_VERSION,
  MAX_SKILL_SLOTS,
  completedCombatCount,
  nodeGoldReward,
  rolledEventIdFor,
  signatureElement,
  type CharacterId,
  type CoinDefId,
  type ContentDb,
  type EquippedSkills,
  type EventDefId,
  type PassiveId,
  type PendingRewards,
  type PendingShop,
  type RunPhase,
  type RunSave,
  type RunState,
  type SkillId,
} from "@game/core";

export const RUN_SAVE_KEY = "deckbuilding-roguelite.run-save";
// P5.4 저장 계약: 이중 쓰기(주+백업)·손상 시 백업 복구·원문 격리(조용한 삭제 금지)
export const RUN_SAVE_BACKUP_KEY = `${RUN_SAVE_KEY}.backup`;
export const RUN_SAVE_QUARANTINE_KEY = `${RUN_SAVE_KEY}.quarantine`;

export type LoadRunStatus =
  | "missing"      // 저장 없음
  | "loaded"       // 주 저장 정상
  | "recovered"    // 주 손상 → 백업으로 복구 (주 원문은 격리)
  | "corrupt"      // 주·백업 모두 파싱 불가 (원문 격리, 사용자 결정 대기)
  | "unsupported"  // 형식은 유효하나 미지 버전/콘텐츠 (원문 격리, 사용자 결정 대기)
  | "unavailable"; // 저장소 접근 자체가 불가

export interface LoadRunResult {
  status: LoadRunStatus;
  save: RunSave | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RunValidationContext = Pick<
  ContentDb,
  "characters" | "coins" | "skills" | "enemies" | "events" | "passives"
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isNonEmptyString);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  isNonNegativeSafeInteger(value) && value > 0;

const isRunPhase = (value: unknown): value is RunPhase =>
  value === "ready" ||
  value === "choose-node" ||
  value === "combat" ||
  value === "rewards" ||
  value === "shop" ||
  value === "event" ||
  value === "rest" ||
  value === "treasure" ||
  value === "victory" ||
  value === "defeat";

const isRunNodeKind = (
  value: unknown,
): value is RunSave["graph"]["layers"][number][number]["kind"] =>
  value === "combat" ||
  value === "elite" ||
  value === "shop" ||
  value === "event" ||
  value === "rest" ||
  value === "treasure" ||
  value === "boss";

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const sameStrings = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => String(value) === String(right[index]));

const isSkillSlotArray = (value: unknown): value is (string | null)[] =>
  Array.isArray(value) &&
  value.every((entry) => entry === null || typeof entry === "string");

const isKnownCoin = (value: string, context: RunValidationContext): boolean =>
  context.coins[value] !== undefined;
const isKnownSkill = (value: string, context: RunValidationContext): boolean =>
  context.skills[value] !== undefined;

// P11 냉기 도적 리워크: P10까지 저장된 냉기 기사 스킬 ID를 새 역할에 가장 가까운
// 확정 스킬로 승격한다. 현 콘텐츠 버전의 알 수 없는 ID는 계속 손상으로 거부한다.
const RETIRED_COLD_SKILL_REPLACEMENTS: Readonly<Record<string, string>> = {
  "frost-slash": "ice-claw",
  "glacial-wall": "ice-sleight",
  "chilling-field": "frost-mark",
  "glacier-strike": "freezing-incision",
  "winters-grasp": "frost-fur-cloak",
};

const migrateRetiredColdSkills = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const mapSkill = (candidate: unknown): unknown =>
    typeof candidate === "string"
      ? (RETIRED_COLD_SKILL_REPLACEMENTS[candidate] ?? candidate)
      : candidate;
  const mapSkills = (candidate: unknown): unknown =>
    Array.isArray(candidate) ? candidate.map(mapSkill) : candidate;
  const pendingRewards = isRecord(value.pendingRewards)
    ? { ...value.pendingRewards, skillOptions: mapSkills(value.pendingRewards.skillOptions) }
    : value.pendingRewards;
  const pendingShop = isRecord(value.pendingShop)
    ? { ...value.pendingShop, skillOptions: mapSkills(value.pendingShop.skillOptions) }
    : value.pendingShop;
  return {
    ...value,
    equippedSkills: mapSkills(value.equippedSkills),
    pendingRewards,
    pendingShop,
  };
};

const legacyGraphForSave = (): RunSave["graph"] => ({
  layers: RUN_ENCOUNTERS.map((encounter, index) => [
    {
      id: `legacy-combat-${index}`,
      kind: "combat" as const,
      encounter: [...encounter],
    },
  ]),
});

// P7 D2 — v7 공통 패딩: 장착 8칸(null=빈 슬롯) / 강화 8칸(false)
const MAX_SLOTS = MAX_SKILL_SLOTS;

const paddedToV7 = (value: Record<string, unknown>): Record<string, unknown> => {
  const equipped = Array.isArray(value.equippedSkills)
    ? [...(value.equippedSkills as unknown[])]
    : [];
  while (equipped.length < MAX_SLOTS) equipped.push(null);
  const upgraded = Array.isArray(value.upgradedSlots)
    ? [...(value.upgradedSlots as unknown[])]
    : [];
  while (upgraded.length < MAX_SLOTS) upgraded.push(false);
  return {
    ...value,
    version: RUN_SAVE_VERSION,
    equippedSkills: equipped,
    upgradedSlots: upgraded,
  };
};

const migratedLegacySave = (
  value: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (value.version === RUN_SAVE_VERSION) return value;
  // P7 D2 — v6 → v7: 장착/강화 배열을 8칸 패딩(빈 슬롯 null / false)만 — 필드 의미 불변.
  if (value.version === 6) return paddedToV7(value);
  // v5 → v6 (P6 D1): 기존 그래프는 acts 부재 = 단일 레거시 막으로 해석되고,
  // 신규 필드는 기본값. 진행 중 런은 기존 규칙(actOfLayer=0, 스케일 ×1)으로 완주한다.
  if (value.version === 5)
    return paddedToV7({
      ...value,
      upgradedSlots: [false, false, false, false, false, false],
      acquiredPassives: [],
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      pendingTreasure: undefined,
    });
  if (value.version === 4)
    return paddedToV7({
      ...value,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
      eventCombats: 0,
      eventCoinGains: 0,
      eventCoinLosses: 0,
      upgradedSlots: [false, false, false, false, false, false],
      acquiredPassives: [],
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      pendingTreasure: undefined,
    });
  if (value.version === 3)
    return paddedToV7({
      ...value,
      pendingShop: undefined,
      shopPurchasedCoins: 0,
      shopPurchasedSkills: 0,
      pendingEvent: undefined,
      pendingEventCombat: undefined,
      eventCombats: 0,
      eventCoinGains: 0,
      eventCoinLosses: 0,
      upgradedSlots: [false, false, false, false, false, false],
      acquiredPassives: [],
      shopPurchasedPassives: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      pendingTreasure: undefined,
    });
  if (value.version !== 1 && value.version !== 2) return null;
  const graph = legacyGraphForSave();
  return paddedToV7({
    ...value,
    graph,
    nodeChoices: Array.from({ length: graph.layers.length }, () => 0),
    shopRemovals: 0,
    pendingShop: undefined,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    pendingEvent: undefined,
    pendingEventCombat: undefined,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    upgradedSlots: [false, false, false, false, false, false],
    acquiredPassives: [],
    shopPurchasedPassives: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
    pendingTreasure: undefined,
  });
};

const coinShopPrice = (
  coin: string,
  character: string,
  context: RunValidationContext,
): number | null => {
  const element = context.coins[coin]?.element;
  if (element === undefined) return null;
  if (element === null) return 25;
  return element === signatureElement(context as ContentDb, character as CharacterId)
    ? 50
    : 70;
};

const skillShopPrice = (
  skill: string,
  context: RunValidationContext,
): number | null => {
  const rarity = context.skills[skill]?.rarity;
  if (rarity === undefined) return null;
  if (rarity === "common") return 50;
  if (rarity === "advanced") return 80;
  return 120;
};

const parseRunGraph = (
  value: unknown,
  context: RunValidationContext,
): RunSave["graph"] | null => {
  if (!isRecord(value) || !Array.isArray(value.layers)) return null;
  const ids = new Set<string>();
  const layers = value.layers.map((layer) => {
    if (!Array.isArray(layer) || layer.length === 0) return null;
    const nodes = layer.map((node) => {
      if (
        !isRecord(node) ||
        !isNonEmptyString(node.id) ||
        !isRunNodeKind(node.kind) ||
        ids.has(node.id)
      ) {
        return null;
      }
      ids.add(node.id);
      const encounter =
        node.encounter === undefined
          ? undefined
          : isStringArray(node.encounter)
            ? node.encounter
            : null;
      if (encounter === null) return null;
      // 노드 종류별 payload 계약 (통합 감사): combat/elite/boss = 비어있지 않은
      // encounter 필수(전부 콘텐츠 사전에 존재)·eventId 금지, event/shop = 정적 payload 금지.
      if (
        node.kind === "combat" ||
        node.kind === "elite" ||
        node.kind === "boss"
      ) {
        if (encounter === undefined || encounter.length === 0) return null;
        if (!encounter.every((id) => context.enemies[id] !== undefined))
          return null;
        if (node.eventId !== undefined) return null;
      } else if (node.kind === "event") {
        if (node.eventId !== undefined || encounter !== undefined) return null;
      } else if (encounter !== undefined || node.eventId !== undefined) {
        // shop/rest/treasure — 정적 payload 금지
        return null;
      }
      return { id: node.id, kind: node.kind, encounter };
    });
    return nodes.every((node) => node !== null) ? nodes : null;
  });
  if (layers.length === 0 || layers.some((layer) => layer === null))
    return null;
  // acts 메타 (P6 D1) — 부재 = 레거시 단일 막. 존재하면 오름차순·범위·0 시작 검증.
  if (value.acts !== undefined) {
    if (!Array.isArray(value.acts) || value.acts.length === 0) return null;
    let previous = -1;
    for (const act of value.acts) {
      if (!isRecord(act) || !isNonNegativeSafeInteger(act.start)) return null;
      if (act.start <= previous || act.start >= value.layers.length) return null;
      previous = act.start;
    }
    if ((value.acts[0] as { start: number }).start !== 0) return null;
    return {
      layers: layers as RunSave["graph"]["layers"],
      acts: value.acts.map((act) => ({ start: (act as { start: number }).start })),
    };
  }
  return { layers: layers as RunSave["graph"]["layers"] };
};

const validCharacterContext = (
  characterId: string,
  context: RunValidationContext,
): boolean => {
  const character = context.characters[characterId];
  if (character === undefined || !isPositiveSafeInteger(character.maxHp))
    return false;
  const startingBag = character.startingBag.map(String);
  const startingSkills = character.startingSkills.map(String);
  return (
    startingBag.length > 0 &&
    startingBag.every((coin) => isKnownCoin(coin, context)) &&
    // P7 D2 — 시작 스킬 1~8 (기본 4): 슬롯 상한 안에서 콘텐츠가 결정
    startingSkills.length >= 1 &&
    startingSkills.length <= MAX_SLOTS &&
    hasUniqueStrings(startingSkills) &&
    startingSkills.every((skill) => isKnownSkill(skill, context))
  );
};

// P6 D1 보상 신스펙 검증: 동전 3택 + (엘리트 1|이벤트 희귀 2) 스킬 + 보스 패시브 ≤3.
// 레거시(acts 부재) v5 저장의 옛 흐름(3전투째 스킬 2택·제거 단계)도 구조 검증으로 수용 —
// 코어의 v5 커맨드(resolveCoinRemoval 등)가 남아 있어 흐름이 완주 가능하다.
const parsePendingRewards = (
  value: unknown,
  equippedSkills: readonly (string | null)[],
  acquiredPassives: readonly string[],
  context: RunValidationContext,
): PendingRewards | null => {
  if (
    !isRecord(value) ||
    !isStringArray(value.coinOptions) ||
    !isStringArray(value.skillOptions)
  )
    return null;
  if (
    typeof value.coinChoiceResolved !== "boolean" ||
    typeof value.coinRemovalResolved !== "boolean" ||
    typeof value.skillChoiceResolved !== "boolean"
  ) {
    return null;
  }

  const coinOptions = value.coinOptions;
  const skillOptions = value.skillOptions;
  if (
    coinOptions.length !== 3 ||
    !hasUniqueStrings(coinOptions) ||
    !coinOptions.every((coin) => isKnownCoin(coin, context))
  ) {
    return null;
  }
  const equipped = new Set(equippedSkills.filter((skill) => skill !== null));
  if (
    skillOptions.length > 2 ||
    !hasUniqueStrings(skillOptions) ||
    !skillOptions.every(
      (skill) => isKnownSkill(skill, context) && !equipped.has(skill),
    )
  ) {
    return null;
  }
  if (skillOptions.length === 0 && !value.skillChoiceResolved) return null;

  const passiveOptions =
    value.passiveOptions === undefined
      ? undefined
      : isStringArray(value.passiveOptions)
        ? value.passiveOptions
        : null;
  if (passiveOptions === null) return null;
  const owned = new Set(acquiredPassives);
  if (passiveOptions !== undefined) {
    if (
      passiveOptions.length > 3 ||
      !hasUniqueStrings(passiveOptions) ||
      !passiveOptions.every(
        (passive) =>
          (context.passives ?? {})[passive] !== undefined && !owned.has(passive),
      )
    )
      return null;
    if (
      value.passiveChoiceResolved !== undefined &&
      typeof value.passiveChoiceResolved !== "boolean"
    )
      return null;
    if (passiveOptions.length === 0 && value.passiveChoiceResolved === false)
      return null;
  }
  const passiveChoiceResolved =
    passiveOptions === undefined
      ? undefined
      : typeof value.passiveChoiceResolved === "boolean"
        ? value.passiveChoiceResolved
        : true;

  if (
    value.coinChoiceResolved &&
    value.coinRemovalResolved &&
    value.skillChoiceResolved &&
    (passiveChoiceResolved ?? true)
  )
    return null;
  const parsed: PendingRewards = {
    coinOptions: coinOptions as CoinDefId[],
    coinChoiceResolved: value.coinChoiceResolved,
    coinRemovalResolved: value.coinRemovalResolved,
    skillOptions: skillOptions as SkillId[],
    skillChoiceResolved: value.skillChoiceResolved,
  };
  if (passiveOptions !== undefined) {
    parsed.passiveOptions = passiveOptions as PendingRewards["passiveOptions"];
    parsed.passiveChoiceResolved = passiveChoiceResolved;
  }
  return parsed;
};

const parsePendingShop = (
  value: unknown,
  character: string,
  context: RunValidationContext,
): PendingShop | null => {
  if (
    !isRecord(value) ||
    !isStringArray(value.coinOptions) ||
    !isStringArray(value.skillOptions) ||
    !Array.isArray(value.coinPrices) ||
    !Array.isArray(value.skillPrices)
  ) {
    return null;
  }
  const coinOptions = value.coinOptions;
  const skillOptions = value.skillOptions;
  const coinPrices = value.coinPrices;
  const skillPrices = value.skillPrices;
  if (
    coinOptions.length > 3 ||
    skillOptions.length > 5 ||
    coinOptions.length !== coinPrices.length ||
    skillOptions.length !== skillPrices.length ||
    !hasUniqueStrings(coinOptions) ||
    !hasUniqueStrings(skillOptions) ||
    !coinOptions.every((coin) => isKnownCoin(coin, context)) ||
    !skillOptions.every((skill) => isKnownSkill(skill, context)) ||
    !coinPrices.every(isPositiveSafeInteger) ||
    !skillPrices.every(isPositiveSafeInteger)
  ) {
    return null;
  }
  if (
    !coinOptions.every(
      (coin, index) => coinPrices[index] === coinShopPrice(coin, character, context),
    ) ||
    !skillOptions.every(
      (skill, index) => skillPrices[index] === skillShopPrice(skill, context),
    )
  ) {
    return null;
  }
  const passiveOptions =
    value.passiveOptions === undefined
      ? undefined
      : isStringArray(value.passiveOptions)
        ? value.passiveOptions
        : null;
  if (passiveOptions === null) return null;
  let passivePrices: number[] | undefined;
  if (passiveOptions !== undefined) {
    if (
      passiveOptions.length > 1 ||
      !Array.isArray(value.passivePrices) ||
      value.passivePrices.length !== passiveOptions.length ||
      !value.passivePrices.every(isPositiveSafeInteger) ||
      !passiveOptions.every(
        (passive, index) =>
          (context.passives ?? {})[passive] !== undefined &&
          (value.passivePrices as number[])[index] ===
            (context.passives ?? {})[passive]!.price,
      )
    )
      return null;
    passivePrices = value.passivePrices as number[];
  }
  const parsed: PendingShop = {
    coinOptions: coinOptions as CoinDefId[],
    coinPrices: coinPrices as number[],
    skillOptions: skillOptions as SkillId[],
    skillPrices: skillPrices as number[],
  };
  if (passiveOptions !== undefined) {
    parsed.passiveOptions = passiveOptions as PendingShop["passiveOptions"];
    parsed.passivePrices = passivePrices;
  }
  return parsed;
};

const parsePendingEvent = (
  value: unknown,
  context: RunValidationContext,
): { eventId: EventDefId } | null => {
  if (!isRecord(value) || !isNonEmptyString(value.eventId)) return null;
  if ((context.events ?? {})[value.eventId] === undefined) return null;
  return { eventId: value.eventId as EventDefId };
};

const normalizeRunSave = (
  rawValue: unknown,
  expectedContentVersion: string,
  context: RunValidationContext,
): RunSave | null => {
  if (!isRecord(rawValue)) return null;
  // v1 → v2 → v3 → v4 명시 마이그레이션: v1/v2 선형 5전투 저장은 레거시 그래프로 감싼다.
  // 미지의 미래 버전은 거부한다 — 증거 계약 §2.
  const migrated = migratedLegacySave(rawValue);
  if (migrated === null || migrated.version !== RUN_SAVE_VERSION) return null;
  if (!isNonEmptyString(migrated.contentVersion)) return null;
  const isLegacyContent = LEGACY_CONTENT_VERSIONS.includes(migrated.contentVersion);
  const value = isLegacyContent ? migrateRetiredColdSkills(migrated) : migrated;
  // 레거시 콘텐츠 버전(m5)은 현 콘텐츠의 부분집합·수치 불변이라 안전 마이그레이션 —
  // 반환 저장의 contentVersion은 현 버전으로 정규화되어 다음 저장부터 새 표기를 쓴다.
  const contentVersionAccepted =
    value.contentVersion === expectedContentVersion ||
    isLegacyContent;
  if (!contentVersionAccepted) return null;
  if (!isNonEmptyString(value.runSeed) || !isNonEmptyString(value.character))
    return null;
  if (!isRunPhase(value.phase)) return null;
  if (!validCharacterContext(value.character, context)) return null;

  const character = context.characters[value.character];
  if (character === undefined) return null;
  if (!isPositiveSafeInteger(value.maxHp) || value.maxHp !== character.maxHp)
    return null;
  if (
    !isNonNegativeSafeInteger(value.currentHp) ||
    value.currentHp > value.maxHp
  )
    return null;
  if (value.phase === "defeat" ? value.currentHp !== 0 : value.currentHp === 0)
    return null;

  const graph = parseRunGraph(value.graph, context);
  if (graph === null) return null;
  if (
    !isNonNegativeSafeInteger(value.combatIndex) ||
    value.combatIndex >= graph.layers.length
  )
    return null;
  if (!Array.isArray(value.nodeChoices)) return null;
  if (value.nodeChoices.length !== graph.layers.length) return null;
  const nodeChoices = value.nodeChoices;
  if (
    !nodeChoices.every(
      (choice, index) =>
        isNonNegativeSafeInteger(choice) && choice < graph.layers[index]!.length,
    )
  ) {
    return null;
  }
  if (!isNonNegativeSafeInteger(value.shopRemovals)) return null;
  if (
    !isNonNegativeSafeInteger(value.shopPurchasedCoins) ||
    !isNonNegativeSafeInteger(value.shopPurchasedSkills)
  )
    return null;
  if (
    !isNonNegativeSafeInteger(value.eventCombats) ||
    !isNonNegativeSafeInteger(value.eventCoinGains) ||
    !isNonNegativeSafeInteger(value.eventCoinLosses)
  )
    return null;
  if (
    !isNonNegativeSafeInteger(value.shopPurchasedPassives) ||
    !isNonNegativeSafeInteger(value.treasureOpened) ||
    !isNonNegativeSafeInteger(value.restHeals) ||
    !isNonNegativeSafeInteger(value.restUpgrades)
  )
    return null;
  if (
    !Array.isArray(value.upgradedSlots) ||
    value.upgradedSlots.length !== MAX_SLOTS ||
    !value.upgradedSlots.every((flag) => typeof flag === "boolean")
  )
    return null;
  if (
    !isStringArray(value.acquiredPassives) ||
    !hasUniqueStrings(value.acquiredPassives) ||
    !value.acquiredPassives.every((passive) => {
      const def = (context.passives ?? {})[passive];
      return (
        def !== undefined &&
        (def.exclusiveTo === undefined ||
          String(def.exclusiveTo) === String(value.character))
      );
    })
  )
    return null;
  if (value.phase === "rewards" && value.combatIndex === 0) return null;
  if (value.phase === "victory" && value.combatIndex !== graph.layers.length - 1)
    return null;
  if (
    value.phase === "choose-node" &&
    (graph.layers[value.combatIndex]?.length ?? 0) < 2
  )
    return null;
  if (!isNonNegativeSafeInteger(value.attempt)) return null;
  if (value.phase === "rewards" && value.attempt !== 0) return null;
  if (!isNonNegativeSafeInteger(value.gold)) return null;
  if (
    value.combatIndex === 0 &&
    value.phase !== "defeat" &&
    value.currentHp !== value.maxHp
  )
    return null;

  if (
    !isStringArray(value.bag) ||
    !value.bag.every((coin) => isKnownCoin(coin, context))
  )
    return null;
  const startingBag = character.startingBag.map(String);
  const progressProbe = {
    ...value,
    graph,
    nodeChoices,
  } as RunState;
  const completedCombats = completedCombatCount(progressProbe);
  // ---- P4.4 verifier HIGH 수정: 이벤트 경제 보존 법칙 -------------------------
  // 완료된 이벤트 레이어의 롤을 코어 정본(rolledEventIdFor)으로 재구성해 counters가
  // 물리적으로 가능한 수락 조합인지 검증한다. 예: 첫 이벤트가 변환 제단인데 골드
  // 100 지불 흔적 없이 기본→대표 교체를 주장하는 위조 저장을 거부.
  {
    const completedEventTypes = { combat: 0, hp: 0, gold: 0, coin: 0 };
    let grossGold = 0;
    const upperLayer = Math.min(value.combatIndex, graph.layers.length);
    for (let layer = 0; layer < upperLayer; layer += 1) {
      const node = graph.layers[layer]?.[nodeChoices[layer] ?? 0];
      if (node === undefined) continue;
      if (node.kind === "event") {
        const rolled = (context.events ?? {})[
          String(rolledEventIdFor(value.runSeed, layer, context as ContentDb))
        ];
        if (rolled === undefined) return null;
        completedEventTypes[rolled.risk] += 1;
      } else if (node.kind !== "shop") {
        grossGold += nodeGoldReward(node.kind);
      }
    }
    {
      let passedTreasures = 0;
      let passedRests = 0;
      for (let layer = 0; layer < upperLayer; layer += 1) {
        const node = graph.layers[layer]?.[nodeChoices[layer] ?? 0];
        if (node?.kind === "treasure") passedTreasures += 1;
        if (node?.kind === "rest") passedRests += 1;
      }
      if (value.treasureOpened !== passedTreasures) return null;
      if (value.restHeals + value.restUpgrades !== passedRests) return null;
    }
    if (value.phase === "victory") {
      const node = graph.layers[value.combatIndex]?.[nodeChoices[value.combatIndex] ?? 0];
      if (node !== undefined && node.kind !== "shop" && node.kind !== "event")
        grossGold += nodeGoldReward(node.kind);
    }
    grossGold += 70 * value.eventCombats;
    const hasEventNodes = graph.layers.some((layer) =>
      layer.some((node) => node.kind === "event"),
    );
    // 수락 산술: gains−losses = 피의 제물 수락 수, losses = 제단+희생 수락 수
    const bloodAccepts = value.eventCoinGains - value.eventCoinLosses;
    if (bloodAccepts < 0 || bloodAccepts > completedEventTypes.hp) return null;
    if (value.eventCoinLosses > completedEventTypes.gold + completedEventTypes.coin)
      return null;
    if (value.eventCombats > completedEventTypes.combat) return null;
    // HP 보존: 피의 제물 수락마다 5씩 잃었어야 한다 — 레거시(무회복) 그래프 한정.
    // P6 그래프는 휴식 회복·막 보스 전체 회복이 있어 이 상한이 성립하지 않는다.
    if (graph.acts === undefined && value.currentHp + 5 * bloodAccepts > value.maxHp)
      return null;
    // 골드 보존: 최소 변환 제단 수락 수 = losses − 희생 가용 수, 각 100 지불
    const minTransmute = Math.max(
      0,
      value.eventCoinLosses - completedEventTypes.coin,
    );
    // 골드-총수입 상한은 이벤트 시대 그래프에만 적용한다 — 레거시(무이벤트) 그래프
    // 저장은 골드 의미론이 경제 이전 세대라 counters 검사(위 3종)만 유효하다.
    if (hasEventNodes && value.gold + 100 * minTransmute > grossGold) return null;
  }
  // 검증 High: 최종 보스 전투는 승리로 런이 끝나 보상 페이즈가 없다 — victory에서
  // completedCombatCount가 세는 마지막 전투를 코인/스킬 보상 원천에서 제외한다.
  const rewardGrantingCombats =
    value.phase === "victory" ? completedCombats - 1 : completedCombats;
  const rewardBagCombats = rewardGrantingCombats + value.eventCombats;
  const minimumBagSize = Math.max(
    1,
    startingBag.length - value.shopRemovals - value.eventCoinLosses,
  );
  const maximumBagSize =
    startingBag.length + rewardBagCombats + value.shopPurchasedCoins + value.eventCoinGains;
  if (value.bag.length < minimumBagSize || value.bag.length > maximumBagSize)
    return null;
  if (value.combatIndex === 0 && !sameStrings(value.bag, startingBag))
    return null;

  // P7 D2 — 슬롯 8 고정, null = 빈 슬롯. 중복/존재 검증은 non-null만.
  if (
    !isSkillSlotArray(value.equippedSkills) ||
    value.equippedSkills.length !== MAX_SLOTS
  )
    return null;
  if (
    value.equippedSkills.some(
      (skill, index) =>
        skill === null && (value.upgradedSlots as boolean[])[index] === true,
    )
  )
    return null;
  const equippedNonNull = value.equippedSkills.filter(
    (skill): skill is string => skill !== null,
  );
  if (
    equippedNonNull.length === 0 ||
    !hasUniqueStrings(equippedNonNull) ||
    !equippedNonNull.every((skill) => isKnownSkill(skill, context))
  ) {
    return null;
  }
  const startingSkills: (string | null)[] = character.startingSkills.map(String);
  while (startingSkills.length < MAX_SLOTS) startingSkills.push(null);
  const changedSlots = value.equippedSkills.filter(
    (skill, index) => skill !== startingSkills[index],
  ).length;
  let completedSkillRewardCount: number;
  if (graph.acts !== undefined) {
    // P6 신스펙: 스킬 제안 원천 = 엘리트 정산 + 이벤트 전투(희귀 2택) + 상점 구매
    let settledElites = 0;
    const upper = Math.min(value.combatIndex, graph.layers.length);
    for (let layer = 0; layer < upper; layer += 1) {
      const node = graph.layers[layer]?.[nodeChoices[layer] ?? 0];
      if (node?.kind === "elite") settledElites += 1;
    }
    completedSkillRewardCount =
      settledElites + value.eventCombats + value.shopPurchasedSkills;
  } else {
    completedSkillRewardCount =
      Math.max(0, rewardBagCombats - (value.phase === "rewards" ? 2 : 1)) +
      value.shopPurchasedSkills;
  }
  if (changedSlots > completedSkillRewardCount) return null;

  const pendingRewards =
    value.pendingRewards === undefined
      ? undefined
      : parsePendingRewards(
          value.pendingRewards,
          value.equippedSkills,
          value.acquiredPassives,
          context,
        );
  if (value.phase === "rewards" && pendingRewards === undefined) return null;
  if (value.phase !== "rewards" && value.pendingRewards !== undefined)
    return null;
  if (pendingRewards === null) return null;

  const pendingShop =
    value.pendingShop === undefined
      ? undefined
      : parsePendingShop(value.pendingShop, value.character, context);
  if (value.phase === "shop" && pendingShop === undefined) return null;
  if (value.phase !== "shop" && value.pendingShop !== undefined) return null;
  if (pendingShop === null) return null;

  let pendingTreasure: RunSave["pendingTreasure"];
  if (value.pendingTreasure !== undefined) {
    if (!isRecord(value.pendingTreasure)) return null;
    const option = value.pendingTreasure.passiveOption;
    if (option !== null) {
      if (
        !isNonEmptyString(option) ||
        (context.passives ?? {})[option] === undefined ||
        value.acquiredPassives.includes(option)
      )
        return null;
    }
    pendingTreasure = {
      passiveOption: option === null ? null : (option as PassiveId),
    };
  }
  if (value.phase === "treasure" && pendingTreasure === undefined) return null;
  if (value.phase !== "treasure" && value.pendingTreasure !== undefined)
    return null;
  if (value.phase === "rest" || value.phase === "treasure") {
    const node = graph.layers[value.combatIndex]?.[nodeChoices[value.combatIndex]];
    if (node?.kind !== value.phase) return null;
  }

  const pendingEvent =
    value.pendingEvent === undefined
      ? undefined
      : parsePendingEvent(value.pendingEvent, context);
  const pendingEventCombat =
    value.pendingEventCombat === undefined
      ? undefined
      : parsePendingEvent(value.pendingEventCombat, context);
  const currentNode =
    graph.layers[value.combatIndex]?.[nodeChoices[value.combatIndex]];
  if (value.phase === "event") {
    if (pendingEvent === undefined || currentNode?.kind !== "event") return null;
  } else if (value.pendingEvent !== undefined) {
    return null;
  }
  if (pendingEvent === null || pendingEventCombat === null) return null;
  if (
    pendingEventCombat !== undefined &&
    (currentNode?.kind !== "event" ||
      (value.phase !== "ready" && value.phase !== "combat") ||
      (context.events ?? {})[String(pendingEventCombat.eventId)]?.risk !== "combat")
  ) {
    return null;
  }

  const save: RunSave = {
    version: RUN_SAVE_VERSION,
    contentVersion: expectedContentVersion,
    runSeed: value.runSeed,
    character: value.character as CharacterId,
    currentHp: value.currentHp,
    maxHp: value.maxHp,
    bag: value.bag as CoinDefId[],
    equippedSkills: [...value.equippedSkills] as EquippedSkills,
    upgradedSlots: [...value.upgradedSlots] as RunSave["upgradedSlots"],
    acquiredPassives: value.acquiredPassives as RunSave["acquiredPassives"],
    gold: value.gold,
    graph,
    nodeChoices,
    shopRemovals: value.shopRemovals,
    shopPurchasedCoins: value.shopPurchasedCoins,
    shopPurchasedSkills: value.shopPurchasedSkills,
    shopPurchasedPassives: value.shopPurchasedPassives,
    eventCombats: value.eventCombats,
    eventCoinGains: value.eventCoinGains,
    eventCoinLosses: value.eventCoinLosses,
    treasureOpened: value.treasureOpened,
    restHeals: value.restHeals,
    restUpgrades: value.restUpgrades,
    combatIndex: value.combatIndex,
    attempt: value.attempt,
    phase: value.phase,
  };
  const withRewards =
    pendingRewards === undefined ? save : { ...save, pendingRewards };
  const withShop =
    pendingShop === undefined ? withRewards : { ...withRewards, pendingShop };
  const withEvent =
    pendingEvent === undefined ? withShop : { ...withShop, pendingEvent };
  const withEventCombat =
    pendingEventCombat === undefined
      ? withEvent
      : { ...withEvent, pendingEventCombat };
  return pendingTreasure === undefined
    ? withEventCombat
    : { ...withEventCombat, pendingTreasure };
};

export const serializeRunSave = (
  save: RunSave,
  context: RunValidationContext,
): string => {
  const normalized = normalizeRunSave(save, save.contentVersion, context);
  if (normalized === null)
    throw new Error("cannot serialize an invalid run save");
  return JSON.stringify(normalized);
};

export const parseRunSave = (
  raw: string,
  expectedContentVersion: string,
  context: RunValidationContext,
): RunSave | null => {
  try {
    return normalizeRunSave(
      JSON.parse(raw) as unknown,
      expectedContentVersion,
      context,
    );
  } catch {
    return null;
  }
};

export const saveRun = (
  storage: StorageLike,
  save: RunSave,
  context: RunValidationContext,
): boolean => {
  const raw = serializeRunSave(save, context);
  let primaryOk = false;
  try {
    storage.setItem(RUN_SAVE_KEY, raw);
    primaryOk = true;
  } catch {
    primaryOk = false;
  }
  try {
    storage.setItem(RUN_SAVE_BACKUP_KEY, raw);
  } catch {
    // 백업 실패는 경고 대상이지만 주 성공이면 저장은 유효
  }
  return primaryOk;
};

// 손상 vs 미지원 판별: JSON 파싱 불가/형식 파손 = corrupt. 파싱은 되는데
// (a) 미래 스키마 버전 또는 (b) 알 수 없는 콘텐츠 버전이면 = unsupported
// (다른 세대의 정상 저장 — 데이터 파손이 아니다).
const classifyInvalidRaw = (
  raw: string,
  expectedContentVersion: string,
): "corrupt" | "unsupported" => {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value !== "object" || value === null) return "corrupt";
    const version = value.version;
    if (typeof version === "number" && version > RUN_SAVE_VERSION)
      return "unsupported";
    if (typeof value.contentVersion === "string") {
      const knownContentVersions = new Set<string>([
        expectedContentVersion,
        ...LEGACY_CONTENT_VERSIONS,
      ]);
      if (!knownContentVersions.has(value.contentVersion)) return "unsupported";
    }
    return "corrupt";
  } catch {
    return "corrupt";
  }
};

const quarantineRaw = (storage: StorageLike, raw: string): void => {
  try {
    storage.setItem(RUN_SAVE_QUARANTINE_KEY, raw);
  } catch {
    // 격리 실패해도 로드 흐름은 계속 — 원문은 주 키에 그대로 남는다
  }
};

export const loadRunDetailed = (
  storage: StorageLike,
  expectedContentVersion: string,
  context: RunValidationContext,
): LoadRunResult => {
  let primaryRaw: string | null;
  let backupRaw: string | null;
  try {
    primaryRaw = storage.getItem(RUN_SAVE_KEY);
    backupRaw = storage.getItem(RUN_SAVE_BACKUP_KEY);
  } catch {
    return { status: "unavailable", save: null };
  }
  if (primaryRaw === null && backupRaw === null)
    return { status: "missing", save: null };

  if (primaryRaw !== null) {
    const primary = parseRunSave(primaryRaw, expectedContentVersion, context);
    if (primary !== null) return { status: "loaded", save: primary };
  }
  // 주 저장 손상/부재 — 백업 시도
  if (backupRaw !== null) {
    const backup = parseRunSave(backupRaw, expectedContentVersion, context);
    if (backup !== null) {
      if (primaryRaw !== null) quarantineRaw(storage, primaryRaw);
      try {
        storage.setItem(RUN_SAVE_KEY, backupRaw);
      } catch {
        // 주 키 복원 실패해도 이번 세션은 백업 값으로 진행
      }
      return { status: "recovered", save: backup };
    }
  }
  // 둘 다 무효 — 원문 격리 후 사용자 결정 대기 (주 키는 지우지 않는다)
  const worst = primaryRaw ?? backupRaw;
  if (worst !== null) quarantineRaw(storage, worst);
  return {
    status: classifyInvalidRaw(worst ?? "", expectedContentVersion),
    save: null,
  };
};

export const loadRun = (
  storage: StorageLike,
  expectedContentVersion: string,
  context: RunValidationContext,
): RunSave | null =>
  loadRunDetailed(storage, expectedContentVersion, context).save;

export const clearRun = (storage: StorageLike): void => {
  try {
    storage.removeItem(RUN_SAVE_BACKUP_KEY);
  } catch {
    // 백업 정리 실패는 무시
  }
  storage.removeItem(RUN_SAVE_KEY);
};
