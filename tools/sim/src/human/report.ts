import { CONTENT_VERSION, contentDb } from "@game/content";
import { effectiveElements } from "@game/core";
import type { CombatState } from "@game/core";

import type {
  HumanReport,
  RatioMetric,
  ReplayedDecision,
  RewardStage,
  RewardStageSummary,
  RunResult,
  VerifiedHumanRun,
} from "./types";

export const HUMAN_REPORT_SCHEMA_VERSION = "human-report-v1" as const;

const NOTE =
  "이 리포트는 지표 계산 도구이며 게이트 판정을 대신하지 않는다" as const;

type RewardMap = Record<RewardStage, RewardStageSummary>;

interface MutableFold {
  turns: number;
  skills: number;
  drawn: number;
  wasted: number;
  fireSeen: number;
  fireUsed: number;
  consumeUses: number;
  consumeOpportunityTurns: number;
  multiCoinUses: number;
  multiCoinOpportunityTurns: number;
  surplusBlockTurns: number;
  burnApplications: number;
  zeroTickBurnApplications: number;
  turnsByEnemy: Record<string, number[]>;
}

const rewardStages: RewardStage[] = [
  "coin",
  "removal",
  "skill",
  "fallback-coin",
];

const emptyRewardSummary = (): RewardStageSummary => ({
  selected: 0,
  skipped: 0,
  declined: 0,
  chosen: {},
});

const emptyRewardMap = (): RewardMap => ({
  coin: emptyRewardSummary(),
  removal: emptyRewardSummary(),
  skill: emptyRewardSummary(),
  "fallback-coin": emptyRewardSummary(),
});

const emptyFold = (): MutableFold => ({
  turns: 0,
  skills: 0,
  drawn: 0,
  wasted: 0,
  fireSeen: 0,
  fireUsed: 0,
  consumeUses: 0,
  consumeOpportunityTurns: 0,
  multiCoinUses: 0,
  multiCoinOpportunityTurns: 0,
  surplusBlockTurns: 0,
  burnApplications: 0,
  zeroTickBurnApplications: 0,
  turnsByEnemy: {},
});

const ratio = (numerator: number, denominator: number): RatioMetric => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : [...values].sort((left, right) => left - right).reduce(
        (sum, value) => sum + value,
        0,
      ) / values.length;

const sortedRecord = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );

const enemyAttackIntent = (state: CombatState): boolean =>
  state.enemies.some(
    (enemy) =>
      enemy.hp > 0 &&
      enemy.intent.actions.some((action) => action.kind === "attack"),
  );

const isFireCoin = (state: CombatState, coinId: number): boolean => {
  const coin = state.coins[coinId];
  return coin !== undefined && effectiveElements(coin, contentDb).includes("fire");
};

const coinFireFromEither = (
  before: CombatState,
  after: CombatState,
  coinId: number,
): boolean => isFireCoin(before, coinId) || isFireCoin(after, coinId);

const turnKey = (decision: ReplayedDecision): string =>
  `${decision.combatIndex}:${decision.before.turn}`;

const groupTurns = (
  decisions: readonly ReplayedDecision[],
): ReplayedDecision[][] => {
  const groups = new Map<string, ReplayedDecision[]>();
  for (const decision of decisions) {
    const key = turnKey(decision);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [decision]);
    else existing.push(decision);
  }
  return [...groups.values()].sort((left, right) => {
    const leftFirst = left[0];
    const rightFirst = right[0];
    if (leftFirst === undefined || rightFirst === undefined) return 0;
    return (
      leftFirst.combatIndex - rightFirst.combatIndex ||
      leftFirst.before.turn - rightFirst.before.turn
    );
  });
};

const hasConsumeOpportunity = (state: CombatState): boolean =>
  state.slots.some((slot, index) => {
    if (slot.usedThisTurn) return false;
    const skill = contentDb.skills[String(slot.skillId)];
    if (skill === undefined || skill.type !== "consume") return false;
    const validFuel = state.zones.hand.filter((coin) =>
      isFireCoin(state, Number(coin)),
    );
    void index;
    return validFuel.length >= skill.consume.count;
  });

const hasMultiCoinOpportunity = (state: CombatState): boolean =>
  state.slots.some((slot, index) => {
    if (slot.usedThisTurn) return false;
    const skill = contentDb.skills[String(slot.skillId)];
    if (skill === undefined || skill.type !== "flip" || skill.cost < 2) {
      return false;
    }
    const placed = state.zones.placed[index as never]?.length ?? 0;
    return state.zones.hand.length + placed >= skill.cost;
  });

const countInitialFireInHand = (state: CombatState): number =>
  state.zones.hand.filter((coin) => isFireCoin(state, Number(coin))).length;

const foldTurn = (fold: MutableFold, group: readonly ReplayedDecision[]): void => {
  const first = group[0];
  if (first === undefined) return;
  const initial = first.before;
  fold.turns += 1;
  fold.drawn += initial.zones.hand.length;
  fold.fireSeen += countInitialFireInHand(initial);
  if (hasConsumeOpportunity(initial)) fold.consumeOpportunityTurns += 1;
  if (hasMultiCoinOpportunity(initial)) fold.multiCoinOpportunityTurns += 1;

  const touchedDrawn = new Set<number>();
  const initialHand = new Set(initial.zones.hand.map(Number));
  let blockGained = 0;
  let playerDamageBlocked = 0;
  let turnBurnApplications = 0;
  let zeroTickBurnApplications = 0;

  for (const decision of group) {
    for (const event of decision.events) {
      if (event.type === "skillUsed") {
        fold.skills += 1;
        if (event.kind === "consume") fold.consumeUses += 1;
        const skill = contentDb.skills[String(event.skill)];
        if (skill?.type === "flip" && skill.cost >= 2) fold.multiCoinUses += 1;
      }
      if (event.type === "coinPlaced" && initialHand.has(Number(event.coin))) {
        touchedDrawn.add(Number(event.coin));
      }
      if (event.type === "coinsConsumed") {
        for (const coin of event.coins) {
          if (initialHand.has(Number(coin))) touchedDrawn.add(Number(coin));
          if (coinFireFromEither(decision.before, decision.after, Number(coin))) {
            fold.fireUsed += 1;
          }
        }
      }
      if (
        event.type === "coinFlipped" &&
        event.face === "heads" &&
        coinFireFromEither(decision.before, decision.after, Number(event.coin))
      ) {
        fold.fireUsed += 1;
      }
      if (event.type === "coinCreated") {
        const def = contentDb.coins[event.defId];
        if (def?.element === "fire") fold.fireSeen += 1;
      }
      if (event.type === "blockGained" && event.target.type === "player") {
        blockGained += event.amount;
      }
      if (event.type === "damageDealt" && event.target.type === "player") {
        playerDamageBlocked += event.blocked;
      }
      if (event.type === "statusApplied" && event.status === "burn") {
        turnBurnApplications += event.stacks;
        if (decision.after.phase === "victory") {
          zeroTickBurnApplications += event.stacks;
        }
      }
    }
  }

  fold.wasted += [...initialHand].filter((coin) => !touchedDrawn.has(coin)).length;
  if (blockGained > 0 && !enemyAttackIntent(initial) && playerDamageBlocked === 0) {
    fold.surplusBlockTurns += 1;
  }
  fold.burnApplications += turnBurnApplications;
  fold.zeroTickBurnApplications += zeroTickBurnApplications;
};

const mergeFold = (target: MutableFold, source: MutableFold): void => {
  target.turns += source.turns;
  target.skills += source.skills;
  target.drawn += source.drawn;
  target.wasted += source.wasted;
  target.fireSeen += source.fireSeen;
  target.fireUsed += source.fireUsed;
  target.consumeUses += source.consumeUses;
  target.consumeOpportunityTurns += source.consumeOpportunityTurns;
  target.multiCoinUses += source.multiCoinUses;
  target.multiCoinOpportunityTurns += source.multiCoinOpportunityTurns;
  target.surplusBlockTurns += source.surplusBlockTurns;
  target.burnApplications += source.burnApplications;
  target.zeroTickBurnApplications += source.zeroTickBurnApplications;
  for (const [enemy, turns] of Object.entries(source.turnsByEnemy)) {
    target.turnsByEnemy[enemy] = [...(target.turnsByEnemy[enemy] ?? []), ...turns];
  }
};

const rewardSummaryFor = (run: VerifiedHumanRun): RewardMap => {
  const rewards = emptyRewardMap();
  for (const reward of run.trace.rewards) {
    const summary = rewards[reward.stage];
    summary[reward.resolution] += 1;
    const chosen = reward.choice ?? "<none>";
    summary.chosen[chosen] = (summary.chosen[chosen] ?? 0) + 1;
  }
  for (const stage of rewardStages) {
    rewards[stage].chosen = sortedRecord(rewards[stage].chosen);
  }
  return rewards;
};

const mergeRewards = (target: RewardMap, source: RewardMap): void => {
  for (const stage of rewardStages) {
    target[stage].selected += source[stage].selected;
    target[stage].skipped += source[stage].skipped;
    target[stage].declined += source[stage].declined;
    for (const [choice, count] of Object.entries(source[stage].chosen)) {
      target[stage].chosen[choice] = (target[stage].chosen[choice] ?? 0) + count;
    }
    target[stage].chosen = sortedRecord(target[stage].chosen);
  }
};

const reportFold = (run: VerifiedHumanRun): MutableFold => {
  const fold = emptyFold();
  for (const combat of run.combats) {
    for (const enemy of combat.enemyIds) {
      fold.turnsByEnemy[enemy] = [...(fold.turnsByEnemy[enemy] ?? []), combat.turns];
    }
  }
  for (const group of groupTurns(run.decisions)) foldTurn(fold, group);
  return fold;
};

const averageTurnsByEnemy = (
  turnsByEnemy: Record<string, number[]>,
): Record<string, number> =>
  sortedRecord(
    Object.fromEntries(
      Object.entries(turnsByEnemy).map(([enemy, turns]) => [enemy, mean(turns) ?? 0]),
    ),
  );

const foldMetrics = (fold: MutableFold) => ({
  averageTurns: mean(Object.values(fold.turnsByEnemy).flat()),
  averageTurnsByEnemy: averageTurnsByEnemy(fold.turnsByEnemy),
  skillsPerTurn: ratio(fold.skills, fold.turns),
  coinWasteRate: ratio(fold.wasted, fold.drawn),
  fireCoinUtilization: ratio(fold.fireUsed, fold.fireSeen),
  consumeUsage: ratio(fold.consumeUses, fold.consumeOpportunityTurns),
  multiCoinSkillUsage: ratio(fold.multiCoinUses, fold.multiCoinOpportunityTurns),
  invalidActionTagsComputableSubset: {
    fullySurplusBlockTurns: ratio(fold.surplusBlockTurns, fold.turns),
    zeroTickBurnApplications: ratio(
      fold.zeroTickBurnApplications,
      fold.burnApplications,
    ),
  },
});

const resultOf = (run: VerifiedHumanRun): RunResult => run.trace.result;

export function buildHumanReport(
  runs: readonly VerifiedHumanRun[],
  rejected: Array<{ filename: string; reason: string }>,
): HumanReport {
  const sortedRuns = [...runs].sort((left, right) =>
    (left.filename ?? "").localeCompare(right.filename ?? ""),
  );
  const aggregateFold = emptyFold();
  const aggregateRewards = emptyRewardMap();
  const runReports = sortedRuns.map((run) => {
    const fold = reportFold(run);
    mergeFold(aggregateFold, fold);
    const rewards = rewardSummaryFor(run);
    mergeRewards(aggregateRewards, rewards);
    const metrics = foldMetrics(fold);
    const finalHp =
      run.trace.finalHp ?? run.combats[run.combats.length - 1]?.playerHp ?? null;
    return {
      filename: run.filename,
      runSeed: run.trace.runSeed,
      result: run.trace.result,
      finalHp,
      combatsCompleted: run.combats.filter((combat) => combat.result === "victory").length,
      averageTurns: metrics.averageTurns,
      averageTurnsByEnemy: metrics.averageTurnsByEnemy,
      skillsPerTurn: metrics.skillsPerTurn,
      coinWasteRate: metrics.coinWasteRate,
      fireCoinUtilization: metrics.fireCoinUtilization,
      consumeUsage: metrics.consumeUsage,
      multiCoinSkillUsage: metrics.multiCoinSkillUsage,
      invalidActionTagsComputableSubset: metrics.invalidActionTagsComputableSubset,
      rewards,
    };
  });

  const aggregateMetrics = foldMetrics(aggregateFold);
  return {
    schemaVersion: HUMAN_REPORT_SCHEMA_VERSION,
    note: NOTE,
    generatedFrom: {
      contentVersion: CONTENT_VERSION,
      runCount: sortedRuns.length,
      rejectedCount: rejected.length,
    },
    aggregate: {
      runs: sortedRuns.length,
      victories: sortedRuns.filter((run) => resultOf(run) === "victory").length,
      defeats: sortedRuns.filter((run) => resultOf(run) === "defeat").length,
      finalHpAverage: mean(
        runReports.flatMap((run) => (run.finalHp === null ? [] : [run.finalHp])),
      ),
      combatsCompletedAverage: mean(
        runReports.map((run) => run.combatsCompleted),
      ),
      averageTurns: aggregateMetrics.averageTurns,
      averageTurnsByEnemy: aggregateMetrics.averageTurnsByEnemy,
      skillsPerTurn: aggregateMetrics.skillsPerTurn,
      coinWasteRate: aggregateMetrics.coinWasteRate,
      fireCoinUtilization: aggregateMetrics.fireCoinUtilization,
      consumeUsage: aggregateMetrics.consumeUsage,
      multiCoinSkillUsage: aggregateMetrics.multiCoinSkillUsage,
      invalidActionTagsComputableSubset: {
        ...aggregateMetrics.invalidActionTagsComputableSubset,
        omitted: [
          "변환 대상 0개 폭주 등 UI 의도/프리뷰 없이는 판정할 수 없는 태그",
          "반사실 리플레이가 필요한 무효 행동 태그",
        ],
      },
      rewards: aggregateRewards,
    },
    runs: runReports,
    rejected: [...rejected].sort((left, right) =>
      left.filename.localeCompare(right.filename),
    ),
  };
}

const pct = (metric: RatioMetric): string =>
  metric.rate === null
    ? `n/a (${metric.numerator}/${metric.denominator})`
    : `${(metric.rate * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;

const countPer = (metric: RatioMetric): string =>
  metric.rate === null
    ? `n/a (${metric.numerator}/${metric.denominator})`
    : `${metric.rate.toFixed(2)} (${metric.numerator}/${metric.denominator})`;

const num = (value: number | null): string =>
  value === null ? "n/a" : value.toFixed(2);

const rewardLines = (rewards: RewardMap): string[] =>
  rewardStages.map((stage) => {
    const summary = rewards[stage];
    const choices = Object.entries(summary.chosen)
      .map(([choice, count]) => `${choice}:${count}`)
      .join(", ");
    return `| ${stage} | ${summary.selected} | ${summary.skipped} | ${summary.declined} | ${choices || "n/a"} |`;
  });

export function renderHumanReportMarkdown(report: HumanReport): string {
  const lines = [
    "# Human Play Log Metrics",
    "",
    report.note,
    "",
    `- schema: ${report.schemaVersion}`,
    `- contentVersion: ${report.generatedFrom.contentVersion}`,
    `- N: ${report.aggregate.runs}`,
    `- rejected: ${report.generatedFrom.rejectedCount}`,
    "",
    "## Aggregate",
    "",
    `- victory/defeat: ${report.aggregate.victories}/${report.aggregate.defeats}`,
    `- final HP average: ${num(report.aggregate.finalHpAverage)}`,
    `- combats completed average: ${num(report.aggregate.combatsCompletedAverage)}`,
    `- 평균 턴 수: ${num(report.aggregate.averageTurns)}`,
    `- 턴당 스킬 사용 수: ${countPer(report.aggregate.skillsPerTurn)}`,
    `- 코인 낭비율: ${pct(report.aggregate.coinWasteRate)}`,
    `- 속성 코인 활용률: ${pct(report.aggregate.fireCoinUtilization)}`,
    `- 소비형 사용률: ${pct(report.aggregate.consumeUsage)}`,
    `- 2코인+ 스킬 사용률: ${pct(report.aggregate.multiCoinSkillUsage)}`,
    `- fully-surplus block turns: ${pct(report.aggregate.invalidActionTagsComputableSubset.fullySurplusBlockTurns)}`,
    `- zero-tick burn applications: ${pct(report.aggregate.invalidActionTagsComputableSubset.zeroTickBurnApplications)}`,
    "",
    "### 평균 턴 수 by Enemy",
    "",
    "| enemy | average turns |",
    "| --- | ---: |",
    ...Object.entries(report.aggregate.averageTurnsByEnemy).map(
      ([enemy, turns]) => `| ${enemy} | ${num(turns)} |`,
    ),
    "",
    "### Reward Choices",
    "",
    "| stage | selected | skipped | declined | chosen histogram |",
    "| --- | ---: | ---: | ---: | --- |",
    ...rewardLines(report.aggregate.rewards),
    "",
    "### Computable Subset Note",
    "",
    "- fully-surplus block turns and zero-tick burn applications are rendered as rates because their denominators are all turns and all burn stack applications, respectively.",
    ...report.aggregate.invalidActionTagsComputableSubset.omitted.map(
      (item) => `- omitted: ${item}`,
    ),
    "",
    "## Runs",
    "",
    "| file | seed | result | final HP | combats | avg turns | skills/turn | fire use |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.runs.map(
      (run) =>
        `| ${run.filename ?? "n/a"} | ${run.runSeed} | ${run.result} | ${run.finalHp ?? "n/a"} | ${run.combatsCompleted} | ${num(run.averageTurns)} | ${countPer(run.skillsPerTurn)} | ${pct(run.fireCoinUtilization)} |`,
    ),
    "",
    "## Rejected Files",
    "",
  ];
  if (report.rejected.length === 0) {
    lines.push("None");
  } else {
    for (const rejected of report.rejected) {
      lines.push(`- ${rejected.filename}: ${rejected.reason}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
