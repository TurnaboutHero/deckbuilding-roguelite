import { CONTENT_VERSION, contentDb } from "@game/content";
import {
  acceptEvent,
  buyShopCoin,
  buyShopRemoval,
  buyShopSkill,
  chooseCoinReward,
  choosePassiveReward,
  chooseRunNode,
  chooseSkillReward,
  claimTreasure,
  createRun,
  declineEvent,
  leaveShop,
  resolveCoinRemoval,
  restHeal,
  settleRunCombat,
  skipSkillReward,
  startRunCombat,
  step,
} from "@game/core";
import type {
  CharacterId,
  CoinDefId,
  CombatState,
  RunState,
  SkillId,
} from "@game/core";

import { createPolicy } from "./policies";
import type { PolicyId } from "./policies/types";
import type { CombatPolicy } from "./policies";
import { resolveBuildPolicy, type NodePolicyId } from "./run-sim";
import { combatInvariantViolations } from "./bulk/trace";
import type { M6BuildPolicyConfig, SimCharacterId } from "./bulk";

declare const process: {
  argv: string[];
};

export const P4_ECONOMY_REPORT_SCHEMA_VERSION = "p4-economy-report-v1" as const;

export const P4_ECONOMY_CHARACTER_IDS = [
  "warrior",
  "arcanist",
  "sorcerer",
  "frost-knight",
] as const;

export const P4_ECONOMY_NODE_POLICY_IDS = [
  "fight-first",
  "economy-first",
] as const;

const COIN_IDS = ["basic", "fire", "frost", "lightning", "mana"] as const;

export interface P4EconomyReportOptions {
  readonly games?: number;
  /** 비교용 고정 baseline 전투 정책 (D7) — 캐릭터 최적 전략이 아니다. 교차 진단용 파라미터. */
  readonly combatPolicyId?: PolicyId;
}

interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
}

interface Distribution {
  readonly count: number;
  readonly mean: number | null;
  readonly p50: number | null;
  readonly p90: number | null;
}

interface EventDeltaDistribution {
  readonly hp: Distribution;
  readonly gold: Distribution;
  readonly coins: Distribution;
}

interface EventTypeSummary {
  readonly reached: number;
  readonly accepted: number;
  readonly acceptanceRate: Ratio;
  readonly acceptedOutcomeDelta: EventDeltaDistribution;
}

interface P4EconomyCell {
  readonly characterId: SimCharacterId;
  readonly nodePolicyId: NodePolicyId;
  readonly runs: number;
  readonly safety: {
    readonly terminalRuns: number;
    readonly crashRuns: number;
    readonly invariantViolationRuns: number;
    readonly invariantViolationCount: number;
    readonly crashBreakdown: readonly {
      readonly code: string;
      readonly runs: number;
    }[];
  };
  readonly progression: {
    readonly bossReachRate: Ratio;
    readonly finalWinRate: Ratio;
    readonly completedCombats: Distribution;
    readonly finalGold: Distribution;
    readonly finalHp: Distribution;
  };
  /** 운영 파산: 무구매 방문 비율 (진입 시점 구매 의도는 있었음) */
  readonly bankruptcyRate: Ratio;
  /** 문자적 D7: 잔여 의도 불가 종료 방문 비율 — 현 가격에서 포화(~100%)가 정상 관측 */
  readonly unmetDemandRate: Ratio;
  readonly purchases: {
    readonly coins: Distribution;
    readonly skills: Distribution;
    readonly removals: Distribution;
    readonly removalCostStageReached: readonly {
      readonly stage: number;
      readonly runs: number;
    }[];
  };
  readonly exposureRate: Record<(typeof COIN_IDS)[number], Ratio>;
  // P6 D1 텔레메트리 — 후보 생성 분포와 실제 방문 분포는 반드시 구분해 기록한다
  readonly generatedKindCounts: NodeKindCounts;
  readonly visitedKindCounts: NodeKindCounts;
  readonly events: {
    readonly reachRate: Ratio;
    readonly typeDistribution: readonly {
      readonly eventType: string;
      readonly reached: number;
    }[];
    readonly byType: Record<string, EventTypeSummary>;
  };
}

export interface P4EconomyReport {
  readonly schemaVersion: typeof P4_ECONOMY_REPORT_SCHEMA_VERSION;
  readonly configuration: {
    readonly contentVersion: string;
    readonly games: number;
    readonly totalRuns: number;
    readonly characters: readonly SimCharacterId[];
    readonly nodePolicies: readonly NodePolicyId[];
    // D7 baseline 의미: 모든 캐릭터에 동일하게 고정한 비교용 전투 정책 —
    // 캐릭터별 최적 전략이 아니며, 셀 결과만으로 수치를 조정하지 않는다.
    // 시드는 전투 정책을 포함하지 않는다(감사 반영): 같은 (node-policy, character,
    // index)는 전투 정책이 달라도 동일 시드 → 정책 간 짝지은 비교(paired comparison,
    // CRN과 동일한 분산 감소)가 성립한다. 시드 생성 변경 금지.
    readonly combatPolicy: PolicyId;
    readonly combatPolicyMeaning: "fixed-comparison-baseline";
    readonly seedRule: "p45-<node-policy>-<character>-<index>";
    readonly isCiGate: false;
  };
  readonly tuningDecision: {
    readonly numericContentChange: "none";
    readonly reason: string;
  };
  readonly cells: readonly P4EconomyCell[];
  readonly phase3: {
    readonly conclusionLabels: readonly [
      "engineering-safe",
      "balance-provisional",
      "experience-unverified",
    ];
    readonly reportOnly: true;
  };
}

// P6 D1 — 노드 종류 분포 카운트 (생성 vs 방문 구분 기록용)
const NODE_KIND_IDS = [
  "boss",
  "combat",
  "elite",
  "event",
  "rest",
  "shop",
  "treasure",
] as const;
type NodeKindCounts = Record<(typeof NODE_KIND_IDS)[number], number>;

const emptyNodeKindCounts = (): NodeKindCounts =>
  Object.fromEntries(NODE_KIND_IDS.map((kind) => [kind, 0])) as NodeKindCounts;

// 후보 생성 분포: 그래프 전 레이어의 모든 후보 노드 kind 합계
const generatedKindCountsOf = (run: RunState): NodeKindCounts => {
  const counts = emptyNodeKindCounts();
  for (const layer of run.graph.layers) {
    for (const node of layer) counts[node.kind] += 1;
  }
  return counts;
};

// 실제 방문 분포: 선택된 노드만 — includeCurrent는 현 레이어 방문 확정(터미널) 여부
const visitedKindCountsOf = (
  run: RunState,
  includeCurrent: boolean,
): NodeKindCounts => {
  const counts = emptyNodeKindCounts();
  const upper = Math.min(
    includeCurrent ? run.combatIndex : run.combatIndex - 1,
    run.graph.layers.length - 1,
  );
  for (let layer = 0; layer <= upper; layer += 1) {
    const node = run.graph.layers[layer]?.[run.nodeChoices[layer] ?? 0];
    if (node !== undefined) counts[node.kind] += 1;
  }
  return counts;
};

const addNodeKindCounts = (
  target: NodeKindCounts,
  source: NodeKindCounts,
): void => {
  for (const kind of NODE_KIND_IDS) target[kind] += source[kind];
};

interface RunEconomyTrace {
  readonly result: "victory" | "defeat" | "crash" | "nonterminal";
  readonly crash: string | null;
  readonly invariantViolations: readonly string[];
  readonly completedCombats: number;
  readonly reachedBoss: boolean;
  readonly finalGold: number;
  readonly finalHp: number;
  readonly shopVisits: number;
  readonly bankruptShopVisits: number;
  readonly unmetDemandShopVisits: number;
  readonly purchasedCoins: number;
  readonly purchasedSkills: number;
  readonly removals: number;
  readonly exposedCoins: readonly string[];
  readonly events: readonly EventTrace[];
  readonly generatedKindCounts: NodeKindCounts;
  readonly visitedKindCounts: NodeKindCounts;
}

interface EventTrace {
  readonly eventType: string;
  readonly accepted: boolean;
  readonly hpDelta: number;
  readonly goldDelta: number;
  readonly coinDelta: number;
}

interface MutableCell {
  readonly characterId: SimCharacterId;
  readonly nodePolicyId: NodePolicyId;
  runs: number;
  terminalRuns: number;
  crashRuns: number;
  invariantViolationRuns: number;
  invariantViolationCount: number;
  bossReached: number;
  wins: number;
  shopVisits: number;
  bankruptShopVisits: number;
  unmetDemandShopVisits: number;
  eventReachedRuns: number;
  readonly generatedKindCounts: NodeKindCounts;
  readonly visitedKindCounts: NodeKindCounts;
  readonly completedCombats: number[];
  readonly finalGold: number[];
  readonly finalHp: number[];
  readonly purchasedCoins: number[];
  readonly purchasedSkills: number[];
  readonly removals: number[];
  readonly exposures: Map<string, number>;
  readonly eventReached: Map<string, number>;
  readonly eventAccepted: Map<string, number>;
  readonly eventHpDeltas: Map<string, number[]>;
  readonly eventGoldDeltas: Map<string, number[]>;
  readonly eventCoinDeltas: Map<string, number[]>;
  readonly crashes: Map<string, number>;
}

const character = (value: SimCharacterId): CharacterId => value as CharacterId;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNumber = (left: number, right: number): number => left - right;

const ratio = (numerator: number, denominator: number): Ratio => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

const percentile = (
  values: readonly number[],
  percentage: number,
): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort(compareNumber);
  return sorted[Math.max(1, Math.ceil(percentage * sorted.length)) - 1] ?? null;
};

const distribution = (values: readonly number[]): Distribution => ({
  count: values.length,
  mean:
    values.length === 0
      ? null
      : [...values].sort(compareNumber).reduce((sum, value) => sum + value, 0) /
        values.length,
  p50: percentile(values, 0.5),
  p90: percentile(values, 0.9),
});

const runInvariantViolations = (run: RunState): string[] => {
  const violations: string[] = [];
  if (run.currentHp < 0 || run.currentHp > run.maxHp) {
    violations.push("run HP out of range");
  }
  if (run.gold < 0) violations.push("run gold is negative");
  if (run.bag.length === 0) violations.push("run bag is empty");
  if (run.equippedSkills.length !== 8) {
    violations.push("run must have exactly eight skill slots");
  }
  if (run.bag.some((id) => contentDb.coins[String(id)] === undefined)) {
    violations.push("run bag contains an unknown coin");
  }
  return violations;
};

const progressFingerprint = (state: CombatState): string =>
  [
    state.turn,
    state.phase,
    state.player.hp,
    state.player.block,
    state.enemies.map((enemy) => `${enemy.hp}:${enemy.block}`).join(","),
    state.zones.hand.length,
    state.zones.draw.length,
    state.zones.discard.length,
    state.zones.exhausted.length,
    Object.values(state.zones.placed)
      .map((coins) => coins.length)
      .join(","),
    state.slots.map((slot) => slot.cooldownRemaining).join(""),
    state.turnTriggers.length,
  ].join("|");

const playFastPolicyCombat = (
  initial: CombatState,
  policy: CombatPolicy,
): { readonly state: CombatState; readonly invariantViolations: string[] } => {
  let state = initial;
  let expectedCoins = Object.keys(state.coins).length;
  const invariantViolations = combatInvariantViolations(state, expectedCoins);
  for (
    let commandIndex = 0;
    commandIndex < 500 && state.phase === "player";
    commandIndex += 1
  ) {
    const before = progressFingerprint(state);
    const command = policy.choose(state, contentDb);
    const result = step(state, command, contentDb);
    if (!result.ok) throw new Error(`policy command rejected: ${result.error}`);
    state = result.state;
    if (progressFingerprint(state) === before) {
      throw new Error(`policy made no progress with command ${command.type}`);
    }
    expectedCoins += result.events.filter(
      (event) => event.type === "coinCreated",
    ).length;
    invariantViolations.push(
      ...combatInvariantViolations(state, expectedCoins),
    );
    if (invariantViolations.length > 0) {
      throw new Error("INVARIANT_VIOLATION");
    }
  }
  return { state, invariantViolations };
};

const chooseNode = (run: RunState, nodePolicyId: NodePolicyId): RunState => {
  const layer = run.graph.layers[run.combatIndex] ?? [];
  const combatIndex = layer.findIndex(
    (node) =>
      node.kind === "combat" || node.kind === "elite" || node.kind === "boss",
  );
  const shopIndex = layer.findIndex((node) => node.kind === "shop");
  const eventIndex = layer.findIndex((node) => node.kind === "event");
  const choice =
    nodePolicyId === "economy-first" && (shopIndex >= 0 || eventIndex >= 0)
      ? shopIndex >= 0
        ? shopIndex
        : eventIndex
      : nodePolicyId === "fight-first" && eventIndex >= 0
        ? eventIndex
        : combatIndex >= 0
          ? combatIndex
          : 0;
  return chooseRunNode(run, choice, contentDb);
};

const replacementSlot = (
  run: RunState,
  buildPolicy: M6BuildPolicyConfig,
): number => {
  for (const skillId of buildPolicy.replacementPriority) {
    const index = run.equippedSkills.findIndex(
      (skill) => String(skill) === skillId,
    );
    if (index >= 0) return index;
  }
  return run.equippedSkills.length - 1;
};

const preferredCoinReward = (
  run: RunState,
  buildPolicy: M6BuildPolicyConfig,
): CoinDefId | null => {
  const options = run.pendingRewards?.coinOptions ?? [];
  for (const coinId of buildPolicy.coinRewardPriority) {
    const selected = options.find((option) => String(option) === coinId);
    if (selected !== undefined) return selected;
  }
  return options[0] ?? null;
};

const resolveRewards = (
  input: RunState,
  buildPolicy: M6BuildPolicyConfig,
  exposedCoins: Set<string>,
): RunState => {
  for (const option of input.pendingRewards?.coinOptions ?? []) {
    exposedCoins.add(String(option));
  }
  let run = chooseCoinReward(
    input,
    preferredCoinReward(input, buildPolicy),
    contentDb,
  );
  // P6 신스펙: 제거 단계는 레거시(v5 흐름) 보상에만 존재 — 페이즈/미해결 가드
  // (코인 선택만으로 rewards가 완결될 수 있다: coinRemovalResolved 고정 true)
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.coinRemovalResolved === false
  ) {
    const basicIndex = run.bag.findIndex((id) => String(id) === "basic");
    run = resolveCoinRemoval(run, basicIndex >= 0 ? basicIndex : null, contentDb);
  }
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.coinChoiceResolved === false &&
    run.pendingRewards.coinRemovalResolved
  ) {
    for (const option of run.pendingRewards.coinOptions)
      exposedCoins.add(String(option));
    run = chooseCoinReward(
      run,
      preferredCoinReward(run, buildPolicy),
      contentDb,
    );
  }
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.skillChoiceResolved === false
  ) {
    const offered = run.pendingRewards.skillOptions;
    const selected =
      buildPolicy.skillRewardPriority
        .map((skillId) => offered.find((skill) => String(skill) === skillId))
        .find((skill): skill is SkillId => skill !== undefined) ?? null;
    run =
      selected === null
        ? skipSkillReward(run, contentDb)
        : chooseSkillReward(
            run,
            selected,
            replacementSlot(run, buildPolicy),
            contentDb,
          );
  }
  // P6 보스 보상 패시브 — 심 정책과 동일: 첫 제안 선택(결정론). balance-provisional.
  if (
    run.phase === "rewards" &&
    run.pendingRewards?.passiveChoiceResolved === false
  ) {
    const offered = run.pendingRewards.passiveOptions ?? [];
    run = choosePassiveReward(run, offered[0] ?? null, contentDb);
  }
  return run;
};

const highestRarityShopSkillIndex = (run: RunState): number => {
  const pending = run.pendingShop;
  if (pending === undefined) return -1;
  const rank = { common: 0, advanced: 1, rare: 2 } as const;
  let bestIndex = -1;
  let bestRank = -1;
  for (let index = 0; index < pending.skillOptions.length; index += 1) {
    const skill = pending.skillOptions[index]!;
    if (run.equippedSkills.map(String).includes(String(skill))) continue;
    const rarity = contentDb.skills[String(skill)]?.rarity;
    if (rarity !== undefined && rank[rarity] > bestRank) {
      bestIndex = index;
      bestRank = rank[rarity];
    }
  }
  return bestIndex;
};

const wantsUnaffordablePurchase = (
  run: RunState,
  buildPolicy: M6BuildPolicyConfig,
  removedOnce: boolean,
): boolean => {
  const pending = run.pendingShop;
  if (pending === undefined)
    throw new Error("shop phase requires pending shop");
  const basicIndex = run.bag.findIndex((id) => String(id) === "basic");
  if (
    !removedOnce &&
    basicIndex >= 0 &&
    run.bag.length > 1 &&
    run.gold < 75 + 25 * run.shopRemovals
  ) {
    return true;
  }
  if (
    buildPolicy.coinRewardPriority.some((coinId) => {
      const index = pending.coinOptions.findIndex(
        (option) => String(option) === coinId,
      );
      return index >= 0 && run.gold < pending.coinPrices[index]!;
    })
  ) {
    return true;
  }
  const skillIndex = highestRarityShopSkillIndex(run);
  return skillIndex >= 0 && run.gold < pending.skillPrices[skillIndex]!;
};

export const resolveShop = (
  input: RunState,
  buildPolicy: M6BuildPolicyConfig,
  exposedCoins: Set<string>,
): {
  readonly run: RunState;
  readonly bankrupt: boolean;
  readonly unmetDemand: boolean;
} => {
  let run = input;
  let removedOnce = false;
  let purchases = 0;
  for (const option of run.pendingShop?.coinOptions ?? [])
    exposedCoins.add(String(option));
  for (
    let stepIndex = 0;
    stepIndex < 500 && run.phase === "shop";
    stepIndex += 1
  ) {
    const pending = run.pendingShop;
    if (pending === undefined)
      throw new Error("shop phase requires pending shop");
    const basicIndex = run.bag.findIndex((id) => String(id) === "basic");
    const removalCost = 75 + 25 * run.shopRemovals;
    if (
      !removedOnce &&
      basicIndex >= 0 &&
      run.bag.length > 1 &&
      run.gold >= removalCost
    ) {
      run = buyShopRemoval(run, basicIndex, contentDb);
      removedOnce = true;
      purchases += 1;
      continue;
    }
    const coinIndex = buildPolicy.coinRewardPriority
      .map((coinId) =>
        pending.coinOptions.findIndex((option) => String(option) === coinId),
      )
      .find((index) => index !== -1 && run.gold >= pending.coinPrices[index]!);
    if (coinIndex !== undefined) {
      run = buyShopCoin(run, coinIndex, contentDb);
      purchases += 1;
      continue;
    }
    const skillIndex = highestRarityShopSkillIndex(run);
    if (skillIndex >= 0 && run.gold >= pending.skillPrices[skillIndex]!) {
      run = buyShopSkill(
        run,
        skillIndex,
        contentDb,
        replacementSlot(run, buildPolicy),
      );
      purchases += 1;
      continue;
    }
    // 지표 분리 (3차 감사 — Fable 판정): 문자적 D7 정의("구매 의도+골드 부족으로
    // 종료")는 정책 구조상 전 방문에서 참(잔여 진열은 항상 남은 골드보다 비싸다) —
    // 100% 포화(동어반복)로 지표 무가치. 따라서:
    //  · bankruptcyRate(운영) = 무구매 파산 — 진입 시점부터 아무것도 못 산 방문
    //  · unmetDemandRate(문자적) = 잔여 의도 품목 불가로 종료한 방문 (포화 관측 자체가 사실)
    const unmetDemand = wantsUnaffordablePurchase(run, buildPolicy, removedOnce);
    const bankrupt = purchases === 0 && unmetDemand;
    return { run: leaveShop(run, contentDb), bankrupt, unmetDemand };
  }
  if (run.phase === "shop") {
    throw new Error("shop policy did not finish within 500 commands");
  }
  return { run, bankrupt: false, unmetDemand: false };
};

const resolveEvent = (
  input: RunState,
  nodePolicyId: NodePolicyId,
): { readonly run: RunState; readonly event: EventTrace } => {
  const pending = input.pendingEvent;
  if (pending === undefined)
    throw new Error("event phase requires pending event");
  const event = (contentDb.events ?? {})[String(pending.eventId)];
  if (event === undefined) throw new Error("unknown event");
  const before = {
    hp: input.currentHp,
    gold: input.gold,
    coins: input.bag.length,
  };
  const basicIndex = input.bag.findIndex((id) => String(id) === "basic");
  const accepted =
    nodePolicyId === "fight-first"
      ? event.risk === "combat"
      : event.risk === "combat"
        ? false
        : event.risk === "hp"
          ? input.currentHp > event.requireCurrentHpAbove
          : event.risk === "gold"
            ? input.gold >= event.goldCost && basicIndex >= 0
            : input.bag.length > event.sacrifice.minimumBagSize &&
              basicIndex >= 0;
  const run = accepted
    ? event.risk === "gold" || event.risk === "coin"
      ? acceptEvent(input, contentDb, basicIndex)
      : acceptEvent(input, contentDb)
    : declineEvent(input, contentDb);
  return {
    run,
    event: {
      eventType: event.risk,
      accepted,
      hpDelta: run.currentHp - before.hp,
      goldDelta: run.gold - before.gold,
      coinDelta: run.bag.length - before.coins,
    },
  };
};

const simulateEconomyRun = (
  seed: string,
  characterId: SimCharacterId,
  nodePolicyId: NodePolicyId,
  combatPolicyId: PolicyId,
): RunEconomyTrace => {
  const exposedCoins = new Set<string>();
  const events: EventTrace[] = [];
  const invariantViolations: string[] = [];
  let completedCombats = 0;
  let reachedBoss = false;
  // 매복 '수락 후 결과'(D10)는 이벤트 전투 정산까지 — 수락 직후 0델타 오귀속 방지
  let ambushPending: {
    index: number;
    baseline: { hp: number; gold: number; coins: number };
  } | null = null;
  let shopVisits = 0;
  let bankruptShopVisits = 0;
  let unmetDemandShopVisits = 0;
  let run = createRun(
    {
      contentVersion: CONTENT_VERSION,
      runSeed: seed,
      character: character(characterId),
    },
    contentDb,
  );
  const buildPolicy = resolveBuildPolicy(characterId, "baseline");
  const policy = createPolicy(combatPolicyId, { runSeed: seed, episodeIndex: 0 });
  // P6 D1 — 생성 분포는 그래프 확정 시점(런 생성)에 고정된다
  const generatedKindCounts = generatedKindCountsOf(run);

  try {
    for (
      let stepIndex = 0;
      stepIndex < 500 && run.phase !== "victory" && run.phase !== "defeat";
      stepIndex += 1
    ) {
      if (run.phase === "choose-node") {
        run = chooseNode(run, nodePolicyId);
        continue;
      }
      if (run.phase === "shop") {
        shopVisits += 1;
        const shop = resolveShop(run, buildPolicy, exposedCoins);
        bankruptShopVisits += shop.bankrupt ? 1 : 0;
        unmetDemandShopVisits += shop.unmetDemand ? 1 : 0;
        run = shop.run;
        invariantViolations.push(...runInvariantViolations(run));
        continue;
      }
      if (run.phase === "event") {
        const baseline = {
          hp: run.currentHp,
          gold: run.gold,
          coins: run.bag.length,
        };
        const resolved = resolveEvent(run, nodePolicyId);
        events.push(resolved.event);
        run = resolved.run;
        // 매복 수락은 아직 미해결(전투 전) — 정산 후 델타로 갱신하기 위해 표시
        if (
          resolved.event.accepted &&
          resolved.event.eventType === "combat"
        ) {
          ambushPending = { index: events.length - 1, baseline };
        }
        invariantViolations.push(...runInvariantViolations(run));
        continue;
      }
      // P6 D1 — 심 정책: 휴식=회복, 보물=개봉 (run-sim.ts와 동일한 결정론 최소 정책)
      if (run.phase === "rest") {
        run = restHeal(run, contentDb);
        invariantViolations.push(...runInvariantViolations(run));
        continue;
      }
      if (run.phase === "treasure") {
        run = claimTreasure(run, contentDb);
        invariantViolations.push(...runInvariantViolations(run));
        continue;
      }
      if (run.phase !== "ready") {
        throw new Error(`unexpected run phase before combat: ${run.phase}`);
      }
      const node =
        run.graph.layers[run.combatIndex]?.[
          run.nodeChoices[run.combatIndex] ?? 0
        ];
      reachedBoss = reachedBoss || node?.kind === "boss";
      const started = startRunCombat(run, contentDb);
      const combat = playFastPolicyCombat(started.combat, policy);
      invariantViolations.push(...combat.invariantViolations);
      if (combat.state.phase !== "victory" && combat.state.phase !== "defeat") {
        return {
          result: "nonterminal",
          crash: null,
          invariantViolations,
          completedCombats,
          reachedBoss,
          finalGold: run.gold,
          finalHp: run.currentHp,
          shopVisits,
          bankruptShopVisits,
          unmetDemandShopVisits,
          purchasedCoins: run.shopPurchasedCoins,
          purchasedSkills: run.shopPurchasedSkills,
          removals: run.shopRemovals,
          exposedCoins: [...exposedCoins].sort(compareText),
          events,
          generatedKindCounts,
          // 전투가 실제로 벌어진 현 레이어는 방문으로 센다
          visitedKindCounts: visitedKindCountsOf(run, true),
        };
      }
      run = settleRunCombat(started.run, combat.state, contentDb);
      completedCombats += 1;
      if (ambushPending !== null && node?.kind === "event") {
        const prior = events[ambushPending.index];
        if (prior !== undefined) {
          events[ambushPending.index] = {
            ...prior,
            hpDelta: run.currentHp - ambushPending.baseline.hp,
            goldDelta: run.gold - ambushPending.baseline.gold,
            coinDelta: run.bag.length - ambushPending.baseline.coins,
          };
        }
        ambushPending = null;
      }
      if (run.phase === "rewards") {
        run = resolveRewards(run, buildPolicy, exposedCoins);
      }
      invariantViolations.push(...runInvariantViolations(run));
    }
    if (run.phase !== "victory" && run.phase !== "defeat") {
      return {
        result: "nonterminal",
        crash: null,
        invariantViolations,
        completedCombats,
        reachedBoss,
        finalGold: run.gold,
        finalHp: run.currentHp,
        shopVisits,
        bankruptShopVisits,
        unmetDemandShopVisits,
        purchasedCoins: run.shopPurchasedCoins,
        purchasedSkills: run.shopPurchasedSkills,
        removals: run.shopRemovals,
        exposedCoins: [...exposedCoins].sort(compareText),
        events,
        generatedKindCounts,
        // 현 레이어는 아직 방문 확정 전(선택 미완)일 수 있어 제외한다
        visitedKindCounts: visitedKindCountsOf(run, false),
      };
    }
    return {
      result: run.phase,
      crash: null,
      invariantViolations,
      completedCombats,
      reachedBoss,
      finalGold: run.gold,
      finalHp: run.currentHp,
      shopVisits,
      bankruptShopVisits,
      unmetDemandShopVisits,
      purchasedCoins: run.shopPurchasedCoins,
      purchasedSkills: run.shopPurchasedSkills,
      removals: run.shopRemovals,
      exposedCoins: [...exposedCoins].sort(compareText),
      events,
      generatedKindCounts,
      visitedKindCounts: visitedKindCountsOf(run, true),
    };
  } catch (error) {
    return {
      result: "crash",
      crash: error instanceof Error ? error.message : "UNKNOWN_THROW",
      invariantViolations,
      completedCombats,
      reachedBoss,
      finalGold: run.gold,
      finalHp: run.currentHp,
      shopVisits,
      bankruptShopVisits,
      unmetDemandShopVisits,
      purchasedCoins: run.shopPurchasedCoins,
      purchasedSkills: run.shopPurchasedSkills,
      removals: run.shopRemovals,
      exposedCoins: [...exposedCoins].sort(compareText),
      events,
      generatedKindCounts,
      visitedKindCounts: visitedKindCountsOf(run, false),
    };
  }
};

const newCell = (
  characterId: SimCharacterId,
  nodePolicyId: NodePolicyId,
): MutableCell => ({
  characterId,
  nodePolicyId,
  runs: 0,
  terminalRuns: 0,
  crashRuns: 0,
  invariantViolationRuns: 0,
  invariantViolationCount: 0,
  bossReached: 0,
  wins: 0,
  shopVisits: 0,
  bankruptShopVisits: 0,
  unmetDemandShopVisits: 0,
  eventReachedRuns: 0,
  generatedKindCounts: emptyNodeKindCounts(),
  visitedKindCounts: emptyNodeKindCounts(),
  completedCombats: [],
  finalGold: [],
  finalHp: [],
  purchasedCoins: [],
  purchasedSkills: [],
  removals: [],
  exposures: new Map(COIN_IDS.map((id) => [id, 0])),
  eventReached: new Map(),
  eventAccepted: new Map(),
  eventHpDeltas: new Map(),
  eventGoldDeltas: new Map(),
  eventCoinDeltas: new Map(),
  crashes: new Map(),
});

const addEventType = (map: Map<string, number>, eventType: string): void => {
  map.set(eventType, (map.get(eventType) ?? 0) + 1);
};

const appendEventDelta = (
  map: Map<string, number[]>,
  eventType: string,
  value: number,
): void => {
  const values = map.get(eventType) ?? [];
  values.push(value);
  map.set(eventType, values);
};

const observeRun = (cell: MutableCell, trace: RunEconomyTrace): void => {
  cell.runs += 1;
  if (trace.result === "victory" || trace.result === "defeat") {
    cell.terminalRuns += 1;
  }
  if (trace.result === "crash") cell.crashRuns += 1;
  if (trace.crash !== null) {
    cell.crashes.set(trace.crash, (cell.crashes.get(trace.crash) ?? 0) + 1);
  }
  if (trace.invariantViolations.length > 0) {
    cell.invariantViolationRuns += 1;
    cell.invariantViolationCount += trace.invariantViolations.length;
  }
  cell.bossReached += trace.reachedBoss ? 1 : 0;
  cell.wins += trace.result === "victory" ? 1 : 0;
  addNodeKindCounts(cell.generatedKindCounts, trace.generatedKindCounts);
  addNodeKindCounts(cell.visitedKindCounts, trace.visitedKindCounts);
  cell.shopVisits += trace.shopVisits;
  cell.bankruptShopVisits += trace.bankruptShopVisits;
  cell.unmetDemandShopVisits += trace.unmetDemandShopVisits;
  cell.completedCombats.push(trace.completedCombats);
  cell.finalGold.push(trace.finalGold);
  cell.finalHp.push(trace.finalHp);
  cell.purchasedCoins.push(trace.purchasedCoins);
  cell.purchasedSkills.push(trace.purchasedSkills);
  cell.removals.push(trace.removals);
  for (const id of trace.exposedCoins) {
    cell.exposures.set(id, (cell.exposures.get(id) ?? 0) + 1);
  }
  if (trace.events.length > 0) cell.eventReachedRuns += 1;
  for (const event of trace.events) {
    addEventType(cell.eventReached, event.eventType);
    if (event.accepted) {
      addEventType(cell.eventAccepted, event.eventType);
      appendEventDelta(cell.eventHpDeltas, event.eventType, event.hpDelta);
      appendEventDelta(cell.eventGoldDeltas, event.eventType, event.goldDelta);
      appendEventDelta(cell.eventCoinDeltas, event.eventType, event.coinDelta);
    }
  }
};

const eventTypeSummary = (
  cell: MutableCell,
  eventType: string,
): EventTypeSummary => {
  const reached = cell.eventReached.get(eventType) ?? 0;
  const accepted = cell.eventAccepted.get(eventType) ?? 0;
  return {
    reached,
    accepted,
    acceptanceRate: ratio(accepted, reached),
    acceptedOutcomeDelta: {
      hp: distribution(cell.eventHpDeltas.get(eventType) ?? []),
      gold: distribution(cell.eventGoldDeltas.get(eventType) ?? []),
      coins: distribution(cell.eventCoinDeltas.get(eventType) ?? []),
    },
  };
};

const finalizeCell = (cell: MutableCell): P4EconomyCell => {
  const eventTypes = [...cell.eventReached.keys()].sort(compareText);
  return {
    characterId: cell.characterId,
    nodePolicyId: cell.nodePolicyId,
    runs: cell.runs,
    safety: {
      terminalRuns: cell.terminalRuns,
      crashRuns: cell.crashRuns,
      invariantViolationRuns: cell.invariantViolationRuns,
      invariantViolationCount: cell.invariantViolationCount,
      crashBreakdown: [...cell.crashes.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([code, runs]) => ({ code, runs })),
    },
    progression: {
      bossReachRate: ratio(cell.bossReached, cell.runs),
      finalWinRate: ratio(cell.wins, cell.terminalRuns),
      completedCombats: distribution(cell.completedCombats),
      finalGold: distribution(cell.finalGold),
      finalHp: distribution(cell.finalHp),
    },
    bankruptcyRate: ratio(cell.bankruptShopVisits, cell.shopVisits),
    unmetDemandRate: ratio(cell.unmetDemandShopVisits, cell.shopVisits),
    purchases: {
      coins: distribution(cell.purchasedCoins),
      skills: distribution(cell.purchasedSkills),
      removals: distribution(cell.removals),
      removalCostStageReached: [...new Set(cell.removals)]
        .sort(compareNumber)
        .map((stage) => ({
          stage,
          runs: cell.removals.filter((value) => value === stage).length,
        })),
    },
    exposureRate: Object.fromEntries(
      COIN_IDS.map((id) => [id, ratio(cell.exposures.get(id) ?? 0, cell.runs)]),
    ) as Record<(typeof COIN_IDS)[number], Ratio>,
    generatedKindCounts: { ...cell.generatedKindCounts },
    visitedKindCounts: { ...cell.visitedKindCounts },
    events: {
      reachRate: ratio(cell.eventReachedRuns, cell.runs),
      typeDistribution: eventTypes.map((eventType) => ({
        eventType,
        reached: cell.eventReached.get(eventType) ?? 0,
      })),
      byType: Object.fromEntries(
        eventTypes.map((eventType) => [
          eventType,
          eventTypeSummary(cell, eventType),
        ]),
      ),
    },
  };
};

const normalizedOptions = (
  options: P4EconomyReportOptions,
): Required<P4EconomyReportOptions> => {
  const games = options.games ?? 500;
  if (!Number.isSafeInteger(games) || games <= 0) {
    throw new RangeError("games must be a positive safe integer");
  }
  return { games, combatPolicyId: options.combatPolicyId ?? "aggro" };
};

export const runP4EconomyReport = (
  options: P4EconomyReportOptions = {},
): P4EconomyReport => {
  const normalized = normalizedOptions(options);
  const cells: P4EconomyCell[] = [];
  for (const characterId of P4_ECONOMY_CHARACTER_IDS) {
    for (const nodePolicyId of P4_ECONOMY_NODE_POLICY_IDS) {
      const cell = newCell(characterId, nodePolicyId);
      for (let index = 0; index < normalized.games; index += 1) {
        observeRun(
          cell,
          simulateEconomyRun(
            `p45-${nodePolicyId}-${characterId}-${index}`,
            characterId,
            nodePolicyId,
            normalized.combatPolicyId,
          ),
        );
      }
      cells.push(finalizeCell(cell));
    }
  }
  return {
    schemaVersion: P4_ECONOMY_REPORT_SCHEMA_VERSION,
    configuration: {
      contentVersion: CONTENT_VERSION,
      games: normalized.games,
      totalRuns:
        normalized.games *
        P4_ECONOMY_CHARACTER_IDS.length *
        P4_ECONOMY_NODE_POLICY_IDS.length,
      characters: P4_ECONOMY_CHARACTER_IDS,
      nodePolicies: P4_ECONOMY_NODE_POLICY_IDS,
      combatPolicy: normalized.combatPolicyId,
      combatPolicyMeaning: "fixed-comparison-baseline",
      seedRule: "p45-<node-policy>-<character>-<index>",
      isCiGate: false,
    },
    tuningDecision: {
      numericContentChange: "none",
      reason:
        "P4.5 economy Monte Carlo is report-only; observed balance facts do not edit numeric content.",
    },
    cells,
    phase3: {
      conclusionLabels: [
        "engineering-safe",
        "balance-provisional",
        "experience-unverified",
      ],
      reportOnly: true,
    },
  };
};

export const parseP4EconomyReportArgs = (
  argv: readonly string[],
): P4EconomyReportOptions => {
  const options: { games?: number; combatPolicyId?: PolicyId } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--games") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--games requires a value");
      options.games = Number(value);
      index += 1;
    } else if (arg === "--combat-policy") {
      const value = argv[index + 1];
      if (
        value !== "aggro" &&
        value !== "greedy" &&
        value !== "turtle" &&
        value !== "random"
      ) {
        throw new Error("--combat-policy must be one of aggro|greedy|turtle|random");
      }
      options.combatPolicyId = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
};

if (process.argv[1]?.endsWith("economy-report.ts") === true) {
  console.log(
    JSON.stringify(
      runP4EconomyReport(parseP4EconomyReportArgs(process.argv.slice(2))),
    ),
  );
}
