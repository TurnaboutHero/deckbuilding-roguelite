import type { CombatEvent, CombatState, Command } from "@game/core";

// v2 (P4.3): 런 그래프 경로 사실(path) 추가 — 갈림길 선택·상점 행동이 없으면
// 리플레이가 비전투 노드를 통과할 수 없다. v1은 그래프 이전 세대라 거부한다.
// v5 (D18): windup nominations, recovery/cancellation, and full Lead state detect every Aurel-only divergence.
export const HUMAN_RUN_SCHEMA_VERSION = 5 as const;
export const UI_BUILD_IDENTIFIER = "m6-ui-local-telemetry";

type RunResult = "in-progress" | "victory" | "defeat";
type RewardStage = "coin" | "removal" | "fallback-coin" | "skill";
type RewardResolution = "selected" | "skipped" | "declined";

export type TelemetryCommand =
  | {
      type: "useImmediateFlipSkill";
      slot: number;
      coins: number[];
      target?: number;
    }
  | { type: "placeCoin"; coin: number; slot: number }
  | { type: "unplaceCoin"; coin: number }
  | {
      type: "useFlipSkill";
      slot: number;
      target?: number;
      chosen?: number[];
      desiredCoin?: string;
      chosenEquipment?: string;
      chosenSummon?: number;
    }
  | {
      type: "useConsumeSkill";
      slot: number;
      coins: number[];
      target?: number;
      desiredCoin?: string;
      chosenSummon?: number;
    }
  | { type: "endTurn"; preserve?: number[] };

export interface HumanDamageFact {
  target: "player" | "enemy";
  enemyIndex?: number;
  amount: number;
  blocked: number;
  source: "skill" | "coin" | "burn" | "poison" | "enemy" | "self" | "fixed";
}

export interface HumanDecisionFact {
  turn: number;
  source?: "manual" | "auto-turn-end";
  commands: TelemetryCommand[];
  skills: Array<{
    slot: number;
    skill: string;
    kind: "flip" | "consume";
  }>;
  flips: Array<{ coin: number; face: "heads" | "tails" }>;
  damage: HumanDamageFact[];
  hp: {
    playerBefore: number;
    playerAfter: number;
    enemiesBefore: number[];
    enemiesAfter: number[];
    enemyFurnaceBefore: number[];
    enemyFurnaceAfter: number[];
    enemyRoyalVaultBefore: Array<{ sourceEnemyUid: number; coins: number[]; nominated: number[]; recovered: number; cancelOn: Array<{ kind: "vaultCoinsRecovered"; count: number } | { kind: "skillDamage"; threshold: number }>; cancelledWindupIntentId?: string }>;
    enemyRoyalVaultAfter: Array<{ sourceEnemyUid: number; coins: number[]; nominated: number[]; recovered: number; cancelOn: Array<{ kind: "vaultCoinsRecovered"; count: number } | { kind: "skillDamage"; threshold: number }>; cancelledWindupIntentId?: string }>;
    enemyLeadBefore: Array<{ sourceEnemyUid: number; initial: number; remaining: number; active: boolean; weakenedThisTurn: number; weakenedTotal: number }>;
    enemyLeadAfter: Array<{ sourceEnemyUid: number; initial: number; remaining: number; active: boolean; weakenedThisTurn: number; weakenedTotal: number }>;
  };
}

export interface HumanCombatTrace {
  combatIndex: number;
  attempt: number;
  enemyIds: string[];
  startingHp: number;
  maxHp: number;
  decisions: HumanDecisionFact[];
  outcome?: {
    result: "victory" | "defeat";
    turns: number;
    playerHp: number;
    enemyHp: number[];
  };
}

export interface HumanRewardFact {
  combatIndex: number;
  stage: RewardStage;
  options: string[];
  choice: string | null;
  resolution: RewardResolution;
  bagIndex?: number;
  replacedSlot?: number;
}

export type HumanShopAction =
  | { kind: "buy-coin"; option: number }
  | { kind: "buy-skill"; option: number; slot: number }
  | { kind: "buy-passive"; option: number }
  | { kind: "remove-coin"; bagIndex: number }
  | { kind: "leave" };

export type HumanPathFact =
  | { layer: number; type: "choose-node"; choice: number }
  | { layer: number; type: "shop"; actions: HumanShopAction[] }
  | { layer: number; type: "event"; action: "accept" | "decline"; choice?: number }
  // P6 v3 — 휴식/보물/보상 패시브 경로 사실 (사실 없으면 리플레이 mismatch)
  | { layer: number; type: "rest"; choice: "heal" | "upgrade"; slot?: number }
  | { layer: number; type: "treasure"; passiveId: string | null }
  | { layer: number; type: "passive-reward"; passiveId: string | null };

export interface HumanRunTrace {
  schemaVersion: typeof HUMAN_RUN_SCHEMA_VERSION;
  source: "human";
  runSeed: string;
  contentVersion: string;
  buildId: string;
  startedAtLocal: string;
  maxHp: number;
  combats: HumanCombatTrace[];
  rewards: HumanRewardFact[];
  path: HumanPathFact[];
  result: RunResult;
  endedAtLocal?: string;
  finalHp?: number;
}

export interface LocalDownloadPort {
  createObjectUrl: (blob: Blob) => string;
  clickDownload: (href: string, filename: string) => void;
  revokeObjectUrl: (href: string) => void;
}

interface CreateHumanRunTraceInput {
  runSeed: string;
  contentVersion: string;
  maxHp: number;
  buildId?: string;
  startedAt?: Date;
}

interface BeginHumanCombatInput {
  combatIndex: number;
  attempt: number;
  combat: CombatState;
}

interface RecordHumanDecisionInput {
  combatIndex: number;
  attempt: number;
  before: CombatState;
  commands: readonly Command[];
  after: CombatState;
  events: readonly CombatEvent[];
  source?: "manual" | "auto-turn-end";
}

export interface RecordHumanRewardInput {
  combatIndex: number;
  stage: RewardStage;
  options: readonly string[];
  choice: string | null;
  resolution: RewardResolution;
  bagIndex?: number;
  replacedSlot?: number;
}

interface FinishHumanRunInput {
  result: "victory" | "defeat";
  finalHp: number;
  maxHp: number;
  endedAt?: Date;
}

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, "0");

export const localTimestamp = (date: Date): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}.${pad(date.getMilliseconds(), 3)}`;

const hpList = (state: CombatState): number[] =>
  state.enemies.map((enemy) => enemy.hp);

const royalVaultSnapshot = (state: CombatState): HumanDecisionFact["hp"]["enemyRoyalVaultBefore"] =>
  state.enemies.flatMap((enemy) => {
    const cancelOn = (enemy.windup?.intent.cancelOn === undefined ? [] : Array.isArray(enemy.windup.intent.cancelOn) ? enemy.windup.intent.cancelOn : [enemy.windup.intent.cancelOn])
      .filter((predicate): predicate is { kind: "vaultCoinsRecovered"; count: number } | { kind: "skillDamage"; threshold: number } => predicate.kind === "vaultCoinsRecovered" || predicate.kind === "skillDamage");
    const coins = state.custody.filter((entry) => entry.kind === "royalVault" && entry.sourceEnemyUid === enemy.enemyUid).sort((left, right) => left.seizureOrder - right.seizureOrder).flatMap((entry) => entry.coins.map(Number));
    const nominated = enemy.royalVaultSeizure?.nominated.map(Number) ?? [];
    const recovered = enemy.royalVaultRecoveredThisWindup ?? 0;
    return coins.length + nominated.length + recovered + cancelOn.length === 0 && enemy.cancelledWindupIntentId === undefined
      ? []
      : [{ sourceEnemyUid: enemy.enemyUid, coins, nominated, recovered, cancelOn, ...(enemy.cancelledWindupIntentId === undefined ? {} : { cancelledWindupIntentId: enemy.cancelledWindupIntentId }) }];
  });

const leadSnapshot = (state: CombatState): HumanDecisionFact["hp"]["enemyLeadBefore"] =>
  state.enemies.flatMap((enemy) =>
    enemy.leadDecree === undefined
      ? []
      : [{ sourceEnemyUid: enemy.enemyUid, initial: enemy.leadDecree.initial, remaining: enemy.leadDecree.remaining, active: enemy.leadDecree.active === true, weakenedThisTurn: enemy.leadDecree.weakenedThisTurn, weakenedTotal: enemy.leadDecree.weakenedTotal }],
  );

const commandFact = (command: Command): TelemetryCommand => {
  if (command.type === "useImmediateFlipSkill") {
    const fact: TelemetryCommand = {
      type: command.type,
      slot: Number(command.slot),
      coins: command.coins.map(Number),
    };
    if (command.target !== undefined) fact.target = command.target;
    return fact;
  }
  if (command.type === "placeCoin") {
    return {
      type: command.type,
      coin: Number(command.coin),
      slot: Number(command.slot),
    };
  }
  if (command.type === "unplaceCoin") {
    return { type: command.type, coin: Number(command.coin) };
  }
  if (command.type === "useFlipSkill") {
    // P6 v3 — 선택 파라미터(기본 코인/장비/소환)를 사실로 보존해 리플레이가 발명된
    // 기본값에 의존하지 않게 한다 (v2는 chosen을 제안 재구성에 맡겼다 — 가산 유지).
    const fact: TelemetryCommand = {
      type: command.type,
      slot: Number(command.slot),
    };
    if (command.target !== undefined) fact.target = command.target;
    if (command.chosen !== undefined) fact.chosen = command.chosen.map(Number);
    if (command.desiredCoin !== undefined)
      fact.desiredCoin = String(command.desiredCoin);
    if (command.chosenEquipment !== undefined)
      fact.chosenEquipment = String(command.chosenEquipment);
    if (command.chosenSummon !== undefined) fact.chosenSummon = command.chosenSummon;
    return fact;
  }
  if (command.type === "useConsumeSkill") {
    const fact: TelemetryCommand = {
      type: command.type,
      slot: Number(command.slot),
      coins: command.coins.map(Number),
    };
    if (command.target !== undefined) fact.target = command.target;
    if (command.desiredCoin !== undefined)
      fact.desiredCoin = String(command.desiredCoin);
    if (command.chosenSummon !== undefined) fact.chosenSummon = command.chosenSummon;
    return fact;
  }
  return command.preserve === undefined
    ? { type: "endTurn" }
    : { type: "endTurn", preserve: command.preserve.map(Number) };
};

export const createHumanRunTrace = (
  input: CreateHumanRunTraceInput,
): HumanRunTrace => ({
  schemaVersion: HUMAN_RUN_SCHEMA_VERSION,
  path: [],
  source: "human",
  runSeed: input.runSeed,
  contentVersion: input.contentVersion,
  buildId: input.buildId ?? UI_BUILD_IDENTIFIER,
  startedAtLocal: localTimestamp(input.startedAt ?? new Date()),
  maxHp: input.maxHp,
  combats: [],
  rewards: [],
  result: "in-progress",
});

export const beginHumanCombat = (
  trace: HumanRunTrace,
  input: BeginHumanCombatInput,
): HumanRunTrace => {
  const alreadyStarted = trace.combats.some(
    (combat) =>
      combat.combatIndex === input.combatIndex &&
      combat.attempt === input.attempt,
  );
  if (alreadyStarted) return trace;
  return {
    ...trace,
    combats: [
      ...trace.combats,
      {
        combatIndex: input.combatIndex,
        attempt: input.attempt,
        enemyIds: input.combat.enemies.map((enemy) => String(enemy.defId)),
        startingHp: input.combat.player.hp,
        maxHp: input.combat.player.maxHp,
        decisions: [],
      },
    ],
  };
};

export const recordHumanDecision = (
  trace: HumanRunTrace,
  input: RecordHumanDecisionInput,
): HumanRunTrace => {
  const combatPosition = trace.combats.findIndex(
    (combat) =>
      combat.combatIndex === input.combatIndex &&
      combat.attempt === input.attempt,
  );
  if (combatPosition < 0) {
    throw new Error("human telemetry combat must be started before a decision");
  }

  const fact: HumanDecisionFact = {
    turn: input.before.turn,
    ...(input.source === undefined ? {} : { source: input.source }),
    commands: input.commands.map(commandFact),
    skills: input.events.flatMap((event) =>
      event.type === "skillUsed"
        ? [
            {
              slot: Number(event.slot),
              skill: String(event.skill),
              kind: event.kind,
            },
          ]
        : [],
    ),
    flips: input.events.flatMap((event) =>
      event.type === "coinFlipped"
        ? [{ coin: Number(event.coin), face: event.face }]
        : [],
    ),
    damage: input.events.flatMap((event) => {
      if (event.type !== "damageDealt") return [];
      const target =
        event.target.type === "player"
          ? ({ target: "player" } as const)
          : ({ target: "enemy", enemyIndex: event.target.index } as const);
      return [
        {
          ...target,
          amount: event.amount,
          blocked: event.blocked,
          source: event.source,
        },
      ];
    }),
    hp: {
      playerBefore: input.before.player.hp,
      playerAfter: input.after.player.hp,
      enemiesBefore: hpList(input.before),
      enemiesAfter: hpList(input.after),
      enemyFurnaceBefore: input.before.enemies.map((enemy) => enemy.furnaceTemperature ?? 0),
      enemyFurnaceAfter: input.after.enemies.map((enemy) => enemy.furnaceTemperature ?? 0),
      enemyRoyalVaultBefore: royalVaultSnapshot(input.before),
      enemyRoyalVaultAfter: royalVaultSnapshot(input.after),
      enemyLeadBefore: leadSnapshot(input.before),
      enemyLeadAfter: leadSnapshot(input.after),
    },
  };

  return {
    ...trace,
    combats: trace.combats.map((combat, index) =>
      index === combatPosition
        ? { ...combat, decisions: [...combat.decisions, fact] }
        : combat,
    ),
  };
};

export const finishHumanCombat = (
  trace: HumanRunTrace,
  combatIndex: number,
  attempt: number,
  combat: CombatState,
): HumanRunTrace => {
  if (combat.phase !== "victory" && combat.phase !== "defeat") {
    throw new Error("human telemetry combat outcome must be terminal");
  }
  const result = combat.phase;
  return {
    ...trace,
    combats: trace.combats.map((entry) =>
      entry.combatIndex === combatIndex && entry.attempt === attempt
        ? {
            ...entry,
            outcome: {
              result,
              turns: combat.turn,
              playerHp: combat.player.hp,
              enemyHp: hpList(combat),
            },
          }
        : entry,
    ),
  };
};

export const recordHumanReward = (
  trace: HumanRunTrace,
  input: RecordHumanRewardInput,
): HumanRunTrace => ({
  ...trace,
  rewards: [
    ...trace.rewards,
    {
      combatIndex: input.combatIndex,
      stage: input.stage,
      options: [...input.options],
      choice: input.choice,
      resolution: input.resolution,
      ...(input.bagIndex === undefined ? {} : { bagIndex: input.bagIndex }),
      ...(input.replacedSlot === undefined
        ? {}
        : { replacedSlot: input.replacedSlot }),
    },
  ],
});

export const finishHumanRun = (
  trace: HumanRunTrace,
  input: FinishHumanRunInput,
): HumanRunTrace => {
  if (input.maxHp !== trace.maxHp) {
    throw new Error("human telemetry max HP changed during the run");
  }
  if (trace.result !== "in-progress") return trace;
  return {
    ...trace,
    result: input.result,
    endedAtLocal: localTimestamp(input.endedAt ?? new Date()),
    finalHp: input.finalHp,
  };
};

export const recordHumanNodeChoice = (
  trace: HumanRunTrace,
  input: { layer: number; choice: number },
): HumanRunTrace => ({
  ...trace,
  path: [
    ...trace.path,
    { layer: input.layer, type: "choose-node", choice: input.choice },
  ],
});

export const recordHumanShopAction = (
  trace: HumanRunTrace,
  input: { layer: number; action: HumanShopAction },
): HumanRunTrace => {
  const last = trace.path[trace.path.length - 1];
  if (last !== undefined && last.type === "shop" && last.layer === input.layer) {
    const merged = { ...last, actions: [...last.actions, input.action] };
    return { ...trace, path: [...trace.path.slice(0, -1), merged] };
  }
  return {
    ...trace,
    path: [
      ...trace.path,
      { layer: input.layer, type: "shop", actions: [input.action] },
    ],
  };
};

// P6 v3 — 휴식/보물/보상 패시브 경로 사실 레코더
export const recordHumanRestChoice = (
  trace: HumanRunTrace,
  input: { layer: number; choice: "heal" | "upgrade"; slot?: number },
): HumanRunTrace => ({
  ...trace,
  path: [
    ...trace.path,
    input.slot === undefined
      ? { layer: input.layer, type: "rest", choice: input.choice }
      : { layer: input.layer, type: "rest", choice: input.choice, slot: input.slot },
  ],
});

export const recordHumanTreasure = (
  trace: HumanRunTrace,
  input: { layer: number; passiveId: string | null },
): HumanRunTrace => ({
  ...trace,
  path: [
    ...trace.path,
    { layer: input.layer, type: "treasure", passiveId: input.passiveId },
  ],
});

export const recordHumanPassiveReward = (
  trace: HumanRunTrace,
  input: { layer: number; passiveId: string | null },
): HumanRunTrace => ({
  ...trace,
  path: [
    ...trace.path,
    { layer: input.layer, type: "passive-reward", passiveId: input.passiveId },
  ],
});

export const recordHumanEventAction = (
  trace: HumanRunTrace,
  input: { layer: number; action: "accept" | "decline"; choice?: number },
): HumanRunTrace => ({
  ...trace,
  path: [
    ...trace.path,
    input.choice === undefined
      ? { layer: input.layer, type: "event", action: input.action }
      : {
          layer: input.layer,
          type: "event",
          action: input.action,
          choice: input.choice,
        },
  ],
});

type JsonObject = Record<string, unknown>;

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
  maxLength = 160,
): string => {
  const value = object[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
};

const integerValue = (
  object: JsonObject,
  key: string,
  label: string,
): number => {
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

const stringArray = (
  value: unknown,
  label: string,
  maxLength = 64,
): string[] => {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`${label} must be a bounded array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 160) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return item;
  });
};

const numberArray = (value: unknown, label: string): number[] => {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(`${label} must be a bounded array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
      throw new Error(`${label}[${index}] must be a non-negative integer`);
    }
    return item;
  });
};

const booleanValue = (object: JsonObject, key: string, label: string): boolean => {
  if (typeof object[key] !== "boolean") throw new Error(`${label}.${key} must be a boolean`);
  return object[key];
};

const royalVaultArray = (
  value: unknown,
  label: string,
): HumanDecisionFact["hp"]["enemyRoyalVaultBefore"] => {
  if (!Array.isArray(value) || value.length > 3) throw new Error(`${label} must be a bounded array`);
  return value.map((item, index) => {
    const entry = objectValue(item, `${label}[${index}]`);
    const cancelOn = entry.cancelOn;
    if (!Array.isArray(cancelOn) || cancelOn.length > 2) throw new Error(`${label}[${index}].cancelOn must be a bounded array`);
    return {
      sourceEnemyUid: nonNegativeInteger(entry, "sourceEnemyUid", `${label}[${index}]`),
      coins: numberArray(entry.coins, `${label}[${index}].coins`),
      nominated: numberArray(entry.nominated, `${label}[${index}].nominated`),
      recovered: nonNegativeInteger(entry, "recovered", `${label}[${index}]`),
      cancelOn: cancelOn.map((predicate, cancelIndex) => {
        const cancel = objectValue(predicate, `${label}[${index}].cancelOn[${cancelIndex}]`);
        return cancel.kind === "vaultCoinsRecovered"
          ? { kind: "vaultCoinsRecovered" as const, count: nonNegativeInteger(cancel, "count", `${label}[${index}].cancelOn[${cancelIndex}]`) }
          : cancel.kind === "skillDamage"
            ? { kind: "skillDamage" as const, threshold: nonNegativeInteger(cancel, "threshold", `${label}[${index}].cancelOn[${cancelIndex}]`) }
            : (() => { throw new Error(`${label}[${index}].cancelOn[${cancelIndex}].kind is invalid`); })();
      }),
      ...(entry.cancelledWindupIntentId === undefined ? {} : { cancelledWindupIntentId: stringValue(entry, "cancelledWindupIntentId", `${label}[${index}]`) }),
    };
  });
};

const leadArray = (
  value: unknown,
  label: string,
): HumanDecisionFact["hp"]["enemyLeadBefore"] => {
  if (!Array.isArray(value) || value.length > 3) throw new Error(`${label} must be a bounded array`);
  return value.map((item, index) => {
    const entry = objectValue(item, `${label}[${index}]`);
    return {
      sourceEnemyUid: nonNegativeInteger(entry, "sourceEnemyUid", `${label}[${index}]`),
      initial: nonNegativeInteger(entry, "initial", `${label}[${index}]`),
      remaining: nonNegativeInteger(entry, "remaining", `${label}[${index}]`),
      active: booleanValue(entry, "active", `${label}[${index}]`),
      weakenedThisTurn: nonNegativeInteger(entry, "weakenedThisTurn", `${label}[${index}]`),
      weakenedTotal: nonNegativeInteger(entry, "weakenedTotal", `${label}[${index}]`),
    };
  });
};

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

const optionalIndex = (
  object: JsonObject,
  key: string,
  label: string,
): number | undefined =>
  object[key] === undefined
    ? undefined
    : nonNegativeInteger(object, key, label);

const sanitizeCommand = (value: unknown, label: string): TelemetryCommand => {
  const object = objectValue(value, label);
  const type = literalValue(
    object.type,
    [
      "useImmediateFlipSkill",
      "placeCoin",
      "unplaceCoin",
      "useFlipSkill",
      "useConsumeSkill",
      "endTurn",
    ] as const,
    `${label}.type`,
  );
  if (type === "useImmediateFlipSkill") {
    const command: Extract<TelemetryCommand, { type: "useImmediateFlipSkill" }> = {
      type,
      slot: nonNegativeInteger(object, "slot", label),
      coins: numberArray(object.coins, `${label}.coins`),
    };
    const target = optionalIndex(object, "target", label);
    if (target !== undefined) command.target = target;
    return command;
  }
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
    const target = optionalIndex(object, "target", label);
    const command: TelemetryCommand = {
      type,
      slot: nonNegativeInteger(object, "slot", label),
      coins: numberArray(object.coins, `${label}.coins`),
    };
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

const sanitizeDecision = (value: unknown, label: string): HumanDecisionFact => {
  const object = objectValue(value, label);
  if (!Array.isArray(object.commands) || object.commands.length > 32) {
    throw new Error(`${label}.commands must be a bounded array`);
  }
  if (!Array.isArray(object.skills) || object.skills.length > 16) {
    throw new Error(`${label}.skills must be a bounded array`);
  }
  if (!Array.isArray(object.flips) || object.flips.length > 64) {
    throw new Error(`${label}.flips must be a bounded array`);
  }
  if (!Array.isArray(object.damage) || object.damage.length > 64) {
    throw new Error(`${label}.damage must be a bounded array`);
  }
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
    commands: object.commands.map((command, index) =>
      sanitizeCommand(command, `${label}.commands[${index}]`),
    ),
    skills: object.skills.map((skill, index) => {
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
    }),
    flips: object.flips.map((flip, index) => {
      const entry = objectValue(flip, `${label}.flips[${index}]`);
      return {
        coin: nonNegativeInteger(entry, "coin", `${label}.flips[${index}]`),
        face: literalValue(
          entry.face,
          ["heads", "tails"] as const,
          `${label}.flips[${index}].face`,
        ),
      };
    }),
    damage: object.damage.map((damage, index) => {
      const entry = objectValue(damage, `${label}.damage[${index}]`);
      const target = literalValue(
        entry.target,
        ["player", "enemy"] as const,
        `${label}.damage[${index}].target`,
      );
      const enemyIndex = optionalIndex(
        entry,
        "enemyIndex",
        `${label}.damage[${index}]`,
      );
      if (target === "enemy" && enemyIndex === undefined) {
        throw new Error(`${label}.damage[${index}] needs enemyIndex`);
      }
      const common = {
        amount: nonNegativeInteger(
          entry,
          "amount",
          `${label}.damage[${index}]`,
        ),
        blocked: nonNegativeInteger(
          entry,
          "blocked",
          `${label}.damage[${index}]`,
        ),
        source: literalValue(
          entry.source,
          ["skill", "coin", "burn", "enemy", "self"] as const,
          `${label}.damage[${index}].source`,
        ),
      };
      return target === "player"
        ? { target, ...common }
        : { target, enemyIndex, ...common };
    }),
    hp: {
      playerBefore: nonNegativeInteger(hp, "playerBefore", `${label}.hp`),
      playerAfter: nonNegativeInteger(hp, "playerAfter", `${label}.hp`),
      enemiesBefore: numberArray(hp.enemiesBefore, `${label}.hp.enemiesBefore`),
      enemiesAfter: numberArray(hp.enemiesAfter, `${label}.hp.enemiesAfter`),
      enemyFurnaceBefore: numberArray(hp.enemyFurnaceBefore, `${label}.hp.enemyFurnaceBefore`),
      enemyFurnaceAfter: numberArray(hp.enemyFurnaceAfter, `${label}.hp.enemyFurnaceAfter`),
      enemyRoyalVaultBefore: royalVaultArray(hp.enemyRoyalVaultBefore, `${label}.hp.enemyRoyalVaultBefore`),
      enemyRoyalVaultAfter: royalVaultArray(hp.enemyRoyalVaultAfter, `${label}.hp.enemyRoyalVaultAfter`),
      enemyLeadBefore: leadArray(hp.enemyLeadBefore, `${label}.hp.enemyLeadBefore`),
      enemyLeadAfter: leadArray(hp.enemyLeadAfter, `${label}.hp.enemyLeadAfter`),
    },
  };
};

const sanitizeCombat = (value: unknown, label: string): HumanCombatTrace => {
  const object = objectValue(value, label);
  if (!Array.isArray(object.decisions) || object.decisions.length > 10_000) {
    throw new Error(`${label}.decisions must be a bounded array`);
  }
  const base: HumanCombatTrace = {
    combatIndex: nonNegativeInteger(object, "combatIndex", label),
    attempt: nonNegativeInteger(object, "attempt", label),
    enemyIds: stringArray(object.enemyIds, `${label}.enemyIds`),
    startingHp: nonNegativeInteger(object, "startingHp", label),
    maxHp: nonNegativeInteger(object, "maxHp", label),
    decisions: object.decisions.map((decision, index) =>
      sanitizeDecision(decision, `${label}.decisions[${index}]`),
    ),
  };
  if (object.outcome === undefined) return base;
  const outcome = objectValue(object.outcome, `${label}.outcome`);
  return {
    ...base,
    outcome: {
      result: literalValue(
        outcome.result,
        ["victory", "defeat"] as const,
        `${label}.outcome.result`,
      ),
      turns: nonNegativeInteger(outcome, "turns", `${label}.outcome`),
      playerHp: nonNegativeInteger(outcome, "playerHp", `${label}.outcome`),
      enemyHp: numberArray(outcome.enemyHp, `${label}.outcome.enemyHp`),
    },
  };
};

const sanitizeReward = (value: unknown, label: string): HumanRewardFact => {
  const object = objectValue(value, label);
  const choice = object.choice;
  if (choice !== null && typeof choice !== "string") {
    throw new Error(`${label}.choice must be a string or null`);
  }
  const bagIndex = optionalIndex(object, "bagIndex", label);
  const replacedSlot = optionalIndex(object, "replacedSlot", label);
  return {
    combatIndex: nonNegativeInteger(object, "combatIndex", label),
    stage: literalValue(
      object.stage,
      ["coin", "removal", "fallback-coin", "skill"] as const,
      `${label}.stage`,
    ),
    options: stringArray(object.options, `${label}.options`),
    choice,
    resolution: literalValue(
      object.resolution,
      ["selected", "skipped", "declined"] as const,
      `${label}.resolution`,
    ),
    ...(bagIndex === undefined ? {} : { bagIndex }),
    ...(replacedSlot === undefined ? {} : { replacedSlot }),
  };
};

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;

const timestampValue = (
  object: JsonObject,
  key: string,
  label: string,
): string => {
  const value = stringValue(object, key, label, 23);
  if (!TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`${label}.${key} must be a local timestamp`);
  }
  return value;
};

const sanitizePathFact = (input: unknown, label: string): HumanPathFact => {
  const object = objectValue(input, label);
  const layer = nonNegativeInteger(object, "layer", label);
  if (object.type === "choose-node") {
    return {
      layer,
      type: "choose-node",
      choice: nonNegativeInteger(object, "choice", label),
    };
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
  if (object.type !== "shop") throw new Error(`${label}.type is unsupported`);
  if (!Array.isArray(object.actions) || object.actions.length > 64) {
    throw new Error(`${label}.actions must be a bounded array`);
  }
  const actions = object.actions.map((action, index) => {
    const entry = objectValue(action, `${label}.actions[${index}]`);
    if (entry.kind === "buy-coin") {
      return {
        kind: "buy-coin" as const,
        option: nonNegativeInteger(entry, "option", label),
      };
    }
    if (entry.kind === "buy-skill") {
      return {
        kind: "buy-skill" as const,
        option: nonNegativeInteger(entry, "option", label),
        slot: nonNegativeInteger(entry, "slot", label),
      };
    }
    if (entry.kind === "remove-coin") {
      return {
        kind: "remove-coin" as const,
        bagIndex: nonNegativeInteger(entry, "bagIndex", label),
      };
    }
    if (entry.kind === "leave") return { kind: "leave" as const };
    throw new Error(`${label}.actions[${index}].kind is unsupported`);
  });
  return { layer, type: "shop", actions };
};

export const sanitizeHumanRunTrace = (input: unknown): HumanRunTrace => {
  const object = objectValue(input, "trace");
  if (object.schemaVersion !== HUMAN_RUN_SCHEMA_VERSION) {
    throw new Error("trace.schemaVersion is unsupported");
  }
  if (object.source !== "human") throw new Error("trace.source must be human");
  if (!Array.isArray(object.combats) || object.combats.length > 64) {
    throw new Error("trace.combats must be a bounded array");
  }
  if (!Array.isArray(object.rewards) || object.rewards.length > 256) {
    throw new Error("trace.rewards must be a bounded array");
  }
  if (!Array.isArray(object.path) || object.path.length > 64) {
    throw new Error("trace.path must be a bounded array");
  }
  const result = literalValue(
    object.result,
    ["in-progress", "victory", "defeat"] as const,
    "trace.result",
  );
  const base: HumanRunTrace = {
    schemaVersion: HUMAN_RUN_SCHEMA_VERSION,
    source: "human",
    runSeed: stringValue(object, "runSeed", "trace"),
    contentVersion: stringValue(object, "contentVersion", "trace"),
    buildId: stringValue(object, "buildId", "trace"),
    startedAtLocal: timestampValue(object, "startedAtLocal", "trace"),
    maxHp: nonNegativeInteger(object, "maxHp", "trace"),
    combats: object.combats.map((combat, index) =>
      sanitizeCombat(combat, `trace.combats[${index}]`),
    ),
    rewards: object.rewards.map((reward, index) =>
      sanitizeReward(reward, `trace.rewards[${index}]`),
    ),
    path: object.path.map((fact, index) =>
      sanitizePathFact(fact, `trace.path[${index}]`),
    ),
    result,
  };
  if (result === "in-progress") return base;
  return {
    ...base,
    endedAtLocal: timestampValue(object, "endedAtLocal", "trace"),
    finalHp: nonNegativeInteger(object, "finalHp", "trace"),
  };
};

const safeFilenamePart = (value: string): string => {
  const safe = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return safe.length === 0 ? "run" : safe;
};

const browserDownloadPort = (): LocalDownloadPort => ({
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  clickDownload: (href, filename) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  },
  revokeObjectUrl: (href) => URL.revokeObjectURL(href),
});

export const downloadHumanRunTrace = (
  trace: HumanRunTrace,
  port: LocalDownloadPort = browserDownloadPort(),
): { filename: string; json: string } => {
  const sanitized = sanitizeHumanRunTrace(trace);
  if (sanitized.result === "in-progress") {
    throw new Error("only a terminal human run can be exported");
  }
  const json = `${JSON.stringify(sanitized, null, 2)}\n`;
  const filename = `play-log-${safeFilenamePart(sanitized.runSeed)}-${sanitized.startedAtLocal.replace(/[:.]/g, "-")}.json`;
  const href = port.createObjectUrl(
    new Blob([json], { type: "application/json;charset=utf-8" }),
  );
  try {
    port.clickDownload(href, filename);
  } finally {
    port.revokeObjectUrl(href);
  }
  return { filename, json };
};
