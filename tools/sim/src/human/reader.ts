import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CONTENT_VERSION } from "@game/content";

import type {
  HumanCombatTrace,
  HumanDamageFact,
  HumanDecisionFact,
  HumanRewardFact,
  HumanRunTraceLike,
  TelemetryCommand,
} from "./types";

export type { HumanRunTraceLike };
export interface HumanLogFile {
  filename: string;
  trace: HumanRunTraceLike;
}

type JsonObject = Record<string, unknown>;

const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES = 500;

const objectValue = (value: unknown, label: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
};

const stringValue = (
  object: JsonObject,
  key: string,
  label: string,
  maxLength = 200,
): string => {
  const value = object[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${label}.${key} must be a non-empty bounded string`);
  }
  return value;
};

const optionalStringValue = (
  object: JsonObject,
  key: string,
  label: string,
): string | undefined => {
  if (object[key] === undefined) return undefined;
  return stringValue(object, key, label);
};

const integerValue = (object: JsonObject, key: string, label: string): number => {
  const value = object[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label}.${key} must be an integer`);
  }
  return value;
};

const nonNegativeInteger = (
  object: JsonObject,
  key: string,
  label: string,
): number => {
  const value = integerValue(object, key, label);
  if (value < 0) throw new Error(`${label}.${key} must be non-negative`);
  return value;
};

const optionalIndex = (
  object: JsonObject,
  key: string,
  label: string,
): number | undefined =>
  object[key] === undefined ? undefined : nonNegativeInteger(object, key, label);

const literalValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid`);
  }
  return value as T;
};

const boundedArray = (
  value: unknown,
  label: string,
  maxLength: number,
): unknown[] => {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`${label} must be a bounded array`);
  }
  return value;
};

const stringArray = (
  value: unknown,
  label: string,
  maxLength = 64,
): string[] =>
  boundedArray(value, label, maxLength).map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 200) {
      throw new Error(`${label}[${index}] must be a non-empty bounded string`);
    }
    return item;
  });

const numberArray = (value: unknown, label: string): number[] =>
  boundedArray(value, label, 64).map((item, index) => {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
      throw new Error(`${label}[${index}] must be a non-negative integer`);
    }
    return item;
  });

const sanitizeCommand = (value: unknown, label: string): TelemetryCommand => {
  const object = objectValue(value, label);
  const type = literalValue(
    object.type,
    [
      "placeCoin",
      "unplaceCoin",
      "useFlipSkill",
      "useConsumeSkill",
      "endTurn",
    ] as const,
    `${label}.type`,
  );
  if (type === "placeCoin") {
    return {
      type,
      coin: nonNegativeInteger(object, "coin", label),
      slot: nonNegativeInteger(object, "slot", label),
    };
  }
  if (type === "unplaceCoin") {
    return { type, coin: nonNegativeInteger(object, "coin", label) };
  }
  if (type === "useFlipSkill") {
    const command: Extract<TelemetryCommand, { type: "useFlipSkill" }> = {
      type,
      slot: nonNegativeInteger(object, "slot", label),
    };
    const target = optionalIndex(object, "target", label);
    const chosenSummon = optionalIndex(object, "chosenSummon", label);
    if (target !== undefined) command.target = target;
    if (object.chosen !== undefined)
      command.chosen = numberArray(object.chosen, `${label}.chosen`);
    if (object.desiredCoin !== undefined)
      command.desiredCoin = stringValue(object, "desiredCoin", label);
    if (object.chosenEquipment !== undefined)
      command.chosenEquipment = stringValue(object, "chosenEquipment", label);
    if (chosenSummon !== undefined) command.chosenSummon = chosenSummon;
    return command;
  }
  if (type === "useConsumeSkill") {
    const command: Extract<TelemetryCommand, { type: "useConsumeSkill" }> = {
      type,
      slot: nonNegativeInteger(object, "slot", label),
      coins: numberArray(object.coins, `${label}.coins`),
    };
    const target = optionalIndex(object, "target", label);
    const chosenSummon = optionalIndex(object, "chosenSummon", label);
    if (target !== undefined) command.target = target;
    if (object.desiredCoin !== undefined)
      command.desiredCoin = stringValue(object, "desiredCoin", label);
    if (chosenSummon !== undefined) command.chosenSummon = chosenSummon;
    return command;
  }
  return object.preserve === undefined
    ? { type: "endTurn" }
    : { type: "endTurn", preserve: numberArray(object.preserve, `${label}.preserve`) };
};

const sanitizeDamage = (value: unknown, label: string): HumanDamageFact => {
  const object = objectValue(value, label);
  const target = literalValue(
    object.target,
    ["player", "enemy"] as const,
    `${label}.target`,
  );
  const enemyIndex = optionalIndex(object, "enemyIndex", label);
  if (target === "enemy" && enemyIndex === undefined) {
    throw new Error(`${label}.enemyIndex is required for enemy damage`);
  }
  const common = {
    amount: nonNegativeInteger(object, "amount", label),
    blocked: nonNegativeInteger(object, "blocked", label),
    source: literalValue(
      object.source,
      ["skill", "burn", "enemy", "self"] as const,
      `${label}.source`,
    ),
  };
  return target === "player"
    ? { target, ...common }
    : { target, enemyIndex, ...common };
};

const sanitizeDecision = (value: unknown, label: string): HumanDecisionFact => {
  const object = objectValue(value, label);
  const hp = objectValue(object.hp, `${label}.hp`);
  return {
    turn: nonNegativeInteger(object, "turn", label),
    ...(object.source === undefined
      ? {}
      : {
          source: literalValue(
            object.source,
            ["manual", "auto-turn-end"] as const,
            `${label}.source`,
          ),
        }),
    commands: boundedArray(object.commands, `${label}.commands`, 32).map(
      (command, index) => sanitizeCommand(command, `${label}.commands[${index}]`),
    ),
    skills: boundedArray(object.skills, `${label}.skills`, 16).map(
      (skill, index) => {
        const entry = objectValue(skill, `${label}.skills[${index}]`);
        return {
          slot: nonNegativeInteger(entry, "slot", `${label}.skills[${index}]`),
          skill: stringValue(entry, "skill", `${label}.skills[${index}]`),
          kind: literalValue(
            entry.kind,
            ["flip", "consume"] as const,
            `${label}.skills[${index}].kind`,
          ),
        };
      },
    ),
    flips: boundedArray(object.flips, `${label}.flips`, 64).map(
      (flip, index) => {
        const entry = objectValue(flip, `${label}.flips[${index}]`);
        return {
          coin: nonNegativeInteger(entry, "coin", `${label}.flips[${index}]`),
          face: literalValue(
            entry.face,
            ["heads", "tails"] as const,
            `${label}.flips[${index}].face`,
          ),
        };
      },
    ),
    damage: boundedArray(object.damage, `${label}.damage`, 64).map(
      (damage, index) => sanitizeDamage(damage, `${label}.damage[${index}]`),
    ),
    hp: {
      playerBefore: nonNegativeInteger(hp, "playerBefore", `${label}.hp`),
      playerAfter: nonNegativeInteger(hp, "playerAfter", `${label}.hp`),
      enemiesBefore: numberArray(hp.enemiesBefore, `${label}.hp.enemiesBefore`),
      enemiesAfter: numberArray(hp.enemiesAfter, `${label}.hp.enemiesAfter`),
    },
  };
};

const sanitizeCombat = (value: unknown, label: string): HumanCombatTrace => {
  const object = objectValue(value, label);
  const outcome =
    object.outcome === undefined
      ? undefined
      : (() => {
          const entry = objectValue(object.outcome, `${label}.outcome`);
          return {
            result: literalValue(
              entry.result,
              ["victory", "defeat"] as const,
              `${label}.outcome.result`,
            ),
            turns: nonNegativeInteger(entry, "turns", `${label}.outcome`),
            playerHp: nonNegativeInteger(entry, "playerHp", `${label}.outcome`),
            enemyHp: numberArray(entry.enemyHp, `${label}.outcome.enemyHp`),
          };
        })();
  return {
    combatIndex: nonNegativeInteger(object, "combatIndex", label),
    attempt: nonNegativeInteger(object, "attempt", label),
    enemyIds: stringArray(object.enemyIds, `${label}.enemyIds`, 8),
    startingHp: nonNegativeInteger(object, "startingHp", label),
    maxHp: nonNegativeInteger(object, "maxHp", label),
    decisions: boundedArray(object.decisions, `${label}.decisions`, 500).map(
      (decision, index) => sanitizeDecision(decision, `${label}.decisions[${index}]`),
    ),
    ...(outcome === undefined ? {} : { outcome }),
  };
};

const sanitizeReward = (value: unknown, label: string): HumanRewardFact => {
  const object = objectValue(value, label);
  const stage = literalValue(
    object.stage,
    ["coin", "removal", "fallback-coin", "skill"] as const,
    `${label}.stage`,
  );
  const choice =
    object.choice === null ? null : stringValue(object, "choice", label);
  return {
    combatIndex: nonNegativeInteger(object, "combatIndex", label),
    stage,
    // v2: 10레이어 런은 가방이 16을 넘는다 (10 시작 + 전투 보상 + 상점 구매) — 32로 상향
    options: stringArray(object.options, `${label}.options`, 32),
    choice,
    resolution: literalValue(
      object.resolution,
      ["selected", "skipped", "declined"] as const,
      `${label}.resolution`,
    ),
    ...(object.bagIndex === undefined
      ? {}
      : { bagIndex: nonNegativeInteger(object, "bagIndex", label) }),
    ...(object.replacedSlot === undefined
      ? {}
      : { replacedSlot: nonNegativeInteger(object, "replacedSlot", label) }),
  };
};

// null 또는 유계 문자열 — v3 treasure/passive-reward 사실의 passiveId
const nullableStringValue = (
  object: JsonObject,
  key: string,
  label: string,
): string | null => {
  if (object[key] === null) return null;
  return stringValue(object, key, label);
};

const sanitizePathFact = (
  value: unknown,
  label: string,
  // v3 가산 사실(rest/treasure/passive-reward, buy-passive)은 v3 로그에서만 허용 —
  // v2 어휘는 불변으로 유지한다 (가산 원칙).
  allowV3: boolean,
): HumanRunTraceLike["path"][number] => {
  const object = objectValue(value, label);
  const layer = nonNegativeInteger(object, "layer", label);
  if (object.type === "choose-node") {
    return { layer, type: "choose-node", choice: nonNegativeInteger(object, "choice", label) };
  }
  if (object.type === "event") {
    const action = literalValue(
      object.action,
      ["accept", "decline"] as const,
      `${label}.action`,
    );
    const choice = optionalIndex(object, "choice", label);
    return choice === undefined
      ? { layer, type: "event", action }
      : { layer, type: "event", action, choice };
  }
  if (allowV3 && object.type === "rest") {
    const choice = literalValue(
      object.choice,
      ["heal", "upgrade"] as const,
      `${label}.choice`,
    );
    const slot = optionalIndex(object, "slot", label);
    return slot === undefined
      ? { layer, type: "rest", choice }
      : { layer, type: "rest", choice, slot };
  }
  if (allowV3 && object.type === "treasure") {
    return { layer, type: "treasure", passiveId: nullableStringValue(object, "passiveId", label) };
  }
  if (allowV3 && object.type === "passive-reward") {
    return { layer, type: "passive-reward", passiveId: nullableStringValue(object, "passiveId", label) };
  }
  if (object.type !== "shop") throw new Error(`${label}.type is unsupported`);
  const actions = boundedArray(object.actions, `${label}.actions`, 64).map((action, index) => {
    const entry = objectValue(action, `${label}.actions[${index}]`);
    if (entry.kind === "buy-coin")
      return { kind: "buy-coin" as const, option: nonNegativeInteger(entry, "option", label) };
    if (entry.kind === "buy-skill")
      return {
        kind: "buy-skill" as const,
        option: nonNegativeInteger(entry, "option", label),
        slot: nonNegativeInteger(entry, "slot", label)
      };
    if (entry.kind === "remove-coin")
      return { kind: "remove-coin" as const, bagIndex: nonNegativeInteger(entry, "bagIndex", label) };
    if (allowV3 && entry.kind === "buy-passive")
      return { kind: "buy-passive" as const, option: nonNegativeInteger(entry, "option", label) };
    if (entry.kind === "leave") return { kind: "leave" as const };
    throw new Error(`${label}.actions[${index}].kind is unsupported`);
  });
  return { layer, type: "shop", actions };
};

const sanitizeTrace = (value: unknown): HumanRunTraceLike => {
  const object = objectValue(value, "trace");
  // v2 (P4.3): path 사실 필수 — v1(그래프 이전) 로그는 콘텐츠 드리프트와 같은 이유로 거부.
  // v3 (P6): rest/treasure/passive-reward/buy-passive 가산 사실 허용. v2는 레거시
  // (무 rest/treasure) 그래프에서만 재생 가능하므로 그대로 수용한다.
  if (object.schemaVersion !== 2 && object.schemaVersion !== 3)
    throw new Error("schemaVersion is unsupported");
  const schemaVersion = object.schemaVersion;
  if (object.source !== "human") throw new Error("source must be human");
  const contentVersion = stringValue(object, "contentVersion", "trace");
  if (contentVersion !== CONTENT_VERSION) {
    throw new Error(
      `content drift: trace contentVersion ${contentVersion} does not match ${CONTENT_VERSION}`,
    );
  }
  const finalHp =
    object.finalHp === undefined
      ? undefined
      : nonNegativeInteger(object, "finalHp", "trace");
  return {
    schemaVersion,
    source: "human",
    runSeed: stringValue(object, "runSeed", "trace"),
    contentVersion,
    buildId: stringValue(object, "buildId", "trace"),
    startedAtLocal: stringValue(object, "startedAtLocal", "trace"),
    maxHp: nonNegativeInteger(object, "maxHp", "trace"),
    combats: boundedArray(object.combats, "trace.combats", 32).map(
      (combat, index) => sanitizeCombat(combat, `trace.combats[${index}]`),
    ),
    rewards: boundedArray(object.rewards, "trace.rewards", 128).map(
      (reward, index) => sanitizeReward(reward, `trace.rewards[${index}]`),
    ),
    // v3: 3막×10방문 그래프는 v2 상한 64를 넘을 수 있다 (레이어당 choose-node +
    // 노드 사실 + 보상 패시브 사실) — 128로 상향, v2는 기존 상한 유지.
    path: boundedArray(
      object.path,
      "trace.path",
      schemaVersion === 3 ? 128 : 64,
    ).map((fact, index) =>
      sanitizePathFact(fact, `trace.path[${index}]`, schemaVersion === 3),
    ),
    result: literalValue(
      object.result,
      ["in-progress", "victory", "defeat"] as const,
      "trace.result",
    ),
    ...(object.endedAtLocal === undefined
      ? {}
      : { endedAtLocal: optionalStringValue(object, "endedAtLocal", "trace") }),
    ...(finalHp === undefined ? {} : { finalHp }),
  };
};

export function readHumanLogDirectory(dir: string): {
  files: HumanLogFile[];
  rejected: Array<{ filename: string; reason: string }>;
} {
  const files: HumanLogFile[] = [];
  const rejected: Array<{ filename: string; reason: string }> = [];

  let entries: string[];
  try {
    entries = readdirSync(dir)
      .filter((entry) => entry.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    return {
      files,
      rejected: [
        {
          filename: dir,
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  for (const filename of entries.slice(0, MAX_FILES)) {
    const path = join(dir, filename);
    try {
      const stats = statSync(path);
      if (!stats.isFile()) continue;
      if (stats.size > MAX_FILE_BYTES) {
        throw new Error(`file exceeds ${MAX_FILE_BYTES} bytes`);
      }
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      files.push({ filename, trace: sanitizeTrace(parsed) });
    } catch (error) {
      rejected.push({
        filename,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (entries.length > MAX_FILES) {
    rejected.push({
      filename: dir,
      reason: `directory contains more than ${MAX_FILES} JSON files`,
    });
  }

  return { files, rejected };
}
