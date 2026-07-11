import { LEGACY_CONTENT_VERSIONS } from "@game/content";
import {
  LEGACY_RUN_SAVE_VERSIONS,
  RUN_ENCOUNTERS,
  RUN_ENCOUNTER_COUNT,
  RUN_SAVE_VERSION,
  rewardEligibleSkillIds,
  type CharacterId,
  type CoinDefId,
  type ContentDb,
  type EquippedSkills,
  type PendingRewards,
  type RunPhase,
  type RunSave,
  type SkillId,
} from "@game/core";

export const RUN_SAVE_KEY = "deckbuilding-roguelite.run-save";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RunValidationContext = Pick<
  ContentDb,
  "characters" | "coins" | "skills" | "enemies"
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
  value === "combat" ||
  value === "rewards" ||
  value === "victory" ||
  value === "defeat";

const isRunNodeKind = (
  value: unknown,
): value is RunSave["graph"]["layers"][number][number]["kind"] =>
  value === "combat" ||
  value === "elite" ||
  value === "shop" ||
  value === "event" ||
  value === "boss";

const hasUniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const sameStrings = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => String(value) === String(right[index]));

const isKnownCoin = (value: string, context: RunValidationContext): boolean =>
  context.coins[value] !== undefined;
const isKnownSkill = (value: string, context: RunValidationContext): boolean =>
  context.skills[value] !== undefined;

const legacyGraphForSave = (): RunSave["graph"] => ({
  layers: RUN_ENCOUNTERS.map((encounter, index) => [
    {
      id: `legacy-combat-${index}`,
      kind: "combat" as const,
      encounter: [...encounter],
    },
  ]),
});

const migratedLegacySave = (
  value: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (
    !LEGACY_RUN_SAVE_VERSIONS.includes(
      value.version as (typeof LEGACY_RUN_SAVE_VERSIONS)[number],
    )
  ) {
    return value.version === RUN_SAVE_VERSION ? value : null;
  }
  const graph = legacyGraphForSave();
  return {
    ...value,
    version: RUN_SAVE_VERSION,
    graph,
    nodeChoices: Array.from({ length: graph.layers.length }, () => 0),
    shopRemovals: 0,
  };
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
      if (node.eventId !== undefined && !isNonEmptyString(node.eventId))
        return null;
      // 노드 종류별 payload 계약 (통합 감사): combat/elite/boss = 비어있지 않은
      // encounter 필수(전부 콘텐츠 사전에 존재)·eventId 금지, event = eventId 필수·
      // encounter 금지, shop = 둘 다 금지.
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
        if (node.eventId === undefined || encounter !== undefined) return null;
      } else if (encounter !== undefined || node.eventId !== undefined) {
        return null;
      }
      return node.eventId === undefined
        ? { id: node.id, kind: node.kind, encounter }
        : { id: node.id, kind: node.kind, encounter, eventId: node.eventId };
    });
    return nodes.every((node) => node !== null) ? nodes : null;
  });
  if (layers.length === 0 || layers.some((layer) => layer === null))
    return null;
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
    startingSkills.length === 6 &&
    hasUniqueStrings(startingSkills) &&
    startingSkills.every((skill) => isKnownSkill(skill, context))
  );
};

const parsePendingRewards = (
  value: unknown,
  combatIndex: number,
  equippedSkills: readonly string[],
  character: string,
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

  if (combatIndex === 1) {
    if (skillOptions.length !== 0 || !value.skillChoiceResolved) return null;
    if (value.coinRemovalResolved && !value.coinChoiceResolved) return null;
  } else {
    const equipped = new Set(equippedSkills);
    // 코어 보상 생성과 같은 술어(rewardEligibleSkillIds)를 사용 — exclusiveTo를 무시하면
    // 공용 풀 소진 저장에서 전용 스킬을 가용으로 오판해 정상 저장을 거부한다 (감시자 발견)
    const unownedSkillCount = rewardEligibleSkillIds(
      context.skills,
      character as CharacterId,
      equippedSkills.map((skill) => skill as SkillId),
    ).length;
    if (unownedSkillCount >= 2) {
      if (
        skillOptions.length !== 2 ||
        !hasUniqueStrings(skillOptions) ||
        !skillOptions.every(
          (skill) => isKnownSkill(skill, context) && !equipped.has(skill),
        ) ||
        value.skillChoiceResolved ||
        (value.coinRemovalResolved && !value.coinChoiceResolved)
      ) {
        return null;
      }
    } else {
      // B2 exhausted-pool flow reuses the public PendingRewards shape. Before removal,
      // the normal coin stage may be unresolved/resolved. After removal, core swaps in
      // the fallback offer and resets only coinChoiceResolved for its select/skip step.
      if (skillOptions.length !== 0 || !value.skillChoiceResolved) return null;
      if (value.coinRemovalResolved && value.coinChoiceResolved) return null;
    }
  }

  if (
    value.coinChoiceResolved &&
    value.coinRemovalResolved &&
    value.skillChoiceResolved
  )
    return null;
  return {
    coinOptions: coinOptions as CoinDefId[],
    coinChoiceResolved: value.coinChoiceResolved,
    coinRemovalResolved: value.coinRemovalResolved,
    skillOptions: skillOptions as SkillId[],
    skillChoiceResolved: value.skillChoiceResolved,
  };
};

const normalizeRunSave = (
  rawValue: unknown,
  expectedContentVersion: string,
  context: RunValidationContext,
): RunSave | null => {
  if (!isRecord(rawValue)) return null;
  // v1 → v2 → v3 명시 마이그레이션: v1/v2 선형 5전투 저장은 레거시 그래프로 감싼다.
  // 미지의 미래 버전은 거부한다 — 증거 계약 §2.
  const migrated = migratedLegacySave(rawValue);
  if (migrated === null || migrated.version !== RUN_SAVE_VERSION) return null;
  const value = migrated;
  if (!isNonEmptyString(value.contentVersion)) return null;
  // 레거시 콘텐츠 버전(m5)은 현 콘텐츠의 부분집합·수치 불변이라 안전 마이그레이션 —
  // 반환 저장의 contentVersion은 현 버전으로 정규화되어 다음 저장부터 새 표기를 쓴다.
  const contentVersionAccepted =
    value.contentVersion === expectedContentVersion ||
    LEGACY_CONTENT_VERSIONS.includes(value.contentVersion);
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

  if (
    !isNonNegativeSafeInteger(value.combatIndex) ||
    value.combatIndex >= RUN_ENCOUNTER_COUNT
  )
    return null;
  const graph = parseRunGraph(value.graph, context);
  if (graph === null || graph.layers.length !== RUN_ENCOUNTER_COUNT)
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
  if (value.phase === "rewards" && value.combatIndex === 0) return null;
  if (
    value.phase === "victory" &&
    value.combatIndex !== RUN_ENCOUNTER_COUNT - 1
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
  const minimumBagSize = Math.max(1, startingBag.length - value.combatIndex);
  const maximumBagSize =
    startingBag.length + value.combatIndex + Math.max(0, value.combatIndex - 1);
  if (value.bag.length < minimumBagSize || value.bag.length > maximumBagSize)
    return null;
  if (value.combatIndex === 0 && !sameStrings(value.bag, startingBag))
    return null;

  if (!isStringArray(value.equippedSkills) || value.equippedSkills.length !== 6)
    return null;
  if (
    !hasUniqueStrings(value.equippedSkills) ||
    !value.equippedSkills.every((skill) => isKnownSkill(skill, context))
  ) {
    return null;
  }
  const startingSkills = character.startingSkills.map(String);
  const changedSlots = value.equippedSkills.filter(
    (skill, index) => skill !== startingSkills[index],
  ).length;
  const completedSkillRewardCount = Math.max(
    0,
    value.combatIndex - (value.phase === "rewards" ? 2 : 1),
  );
  if (changedSlots > completedSkillRewardCount) return null;

  const pendingRewards =
    value.pendingRewards === undefined
      ? undefined
      : parsePendingRewards(
          value.pendingRewards,
          value.combatIndex,
          value.equippedSkills,
          value.character,
          context,
        );
  if (value.phase === "rewards" && pendingRewards === undefined) return null;
  if (value.phase !== "rewards" && value.pendingRewards !== undefined)
    return null;
  if (pendingRewards === null) return null;

  const save: RunSave = {
    version: RUN_SAVE_VERSION,
    contentVersion: expectedContentVersion,
    runSeed: value.runSeed,
    character: value.character as CharacterId,
    currentHp: value.currentHp,
    maxHp: value.maxHp,
    bag: value.bag as CoinDefId[],
    equippedSkills: [...value.equippedSkills] as EquippedSkills,
    gold: value.gold,
    graph,
    nodeChoices,
    shopRemovals: value.shopRemovals,
    combatIndex: value.combatIndex,
    attempt: value.attempt,
    phase: value.phase,
  };
  return pendingRewards === undefined ? save : { ...save, pendingRewards };
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
): void => {
  storage.setItem(RUN_SAVE_KEY, serializeRunSave(save, context));
};

export const loadRun = (
  storage: StorageLike,
  expectedContentVersion: string,
  context: RunValidationContext,
): RunSave | null => {
  try {
    const raw = storage.getItem(RUN_SAVE_KEY);
    return raw === null
      ? null
      : parseRunSave(raw, expectedContentVersion, context);
  } catch {
    return null;
  }
};

export const clearRun = (storage: StorageLike): void => {
  storage.removeItem(RUN_SAVE_KEY);
};
