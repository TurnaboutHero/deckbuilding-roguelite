import type { M6RunTrace } from "../metrics";
import type { PolicyId } from "../policies";
import { runBulk, runBulkWithAaIdentity } from "./runner";
import {
  M6_CRN_REPORT_SCHEMA_VERSION,
  type M6AaIdentityProof,
  type M6AnomalySeed,
  type M6BuildPolicyId,
  type M6BulkResult,
  type M6CrnPairedOutcome,
  type M6CrnReport,
  type SimCharacterId,
  type M6VariantId,
} from "./types";

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export interface M6CrnOptions {
  readonly baseSeed: string;
  readonly games: number;
  readonly policyId: PolicyId;
  readonly variantA?: M6VariantId;
  readonly variantB?: M6VariantId;
  readonly characterA?: SimCharacterId;
  readonly characterB?: SimCharacterId;
  readonly buildPolicyA?: M6BuildPolicyId;
  readonly buildPolicyB?: M6BuildPolicyId;
}

interface AaRun {
  readonly proof: M6AaIdentityProof;
  readonly result: M6BulkResult;
}

const proveAa = (
  baseSeed: string,
  games: number,
  policyId: PolicyId,
  variantId: M6VariantId,
  characterId?: SimCharacterId,
  buildPolicyId?: M6BuildPolicyId,
): AaRun => {
  const options = {
    baseSeed,
    games,
    policyIds: [policyId],
    variantIds: [variantId],
    ...(characterId === undefined ? {} : { characterIds: [characterId] }),
    ...(buildPolicyId === undefined ? {} : { buildPolicyIds: [buildPolicyId] }),
  } as const;
  const verified = runBulkWithAaIdentity(options);
  return {
    proof: verified.aa,
    result: verified.result,
  };
};

export const proveAaIdentity = (
  baseSeed: string,
  games: number,
  policyId: PolicyId,
  variantId: M6VariantId = "baseline",
): M6AaIdentityProof => proveAa(baseSeed, games, policyId, variantId).proof;

const endingHp = (trace: M6RunTrace): number =>
  trace.combats.at(-1)?.endingPlayerHp ?? 70;

const completedCombats = (trace: M6RunTrace): number =>
  trace.combats.filter(
    (combat) => combat.result === "victory" || combat.result === "defeat",
  ).length;

const pairedOutcomes = (
  a: readonly M6RunTrace[],
  b: readonly M6RunTrace[],
): M6CrnPairedOutcome => {
  const byEpisodeB = new Map(b.map((trace) => [trace.episodeId, trace]));
  let sameResult = 0;
  let aOnlyWins = 0;
  let bOnlyWins = 0;
  let bothWin = 0;
  let bothDefeat = 0;
  let nonterminalPairs = 0;
  let hpDelta = 0;
  let completedCombatDelta = 0;
  let terminalPairs = 0;

  for (const left of a) {
    const right = byEpisodeB.get(left.episodeId);
    if (right === undefined) {
      throw new Error(`missing CRN pair for ${left.episodeId}`);
    }
    if (left.runSeed !== right.runSeed) {
      throw new Error(`CRN run seed mismatch for ${left.episodeId}`);
    }
    if (left.result === right.result) sameResult += 1;
    if (left.result === "victory" && right.result === "victory") bothWin += 1;
    if (left.result === "defeat" && right.result === "defeat") bothDefeat += 1;
    if (left.result === "victory" && right.result !== "victory") {
      aOnlyWins += 1;
    }
    if (right.result === "victory" && left.result !== "victory") {
      bOnlyWins += 1;
    }
    const terminal =
      (left.result === "victory" || left.result === "defeat") &&
      (right.result === "victory" || right.result === "defeat");
    if (!terminal) {
      nonterminalPairs += 1;
      continue;
    }
    terminalPairs += 1;
    hpDelta += endingHp(right) - endingHp(left);
    completedCombatDelta += completedCombats(right) - completedCombats(left);
  }

  return {
    pairs: a.length,
    sameResult,
    aOnlyWins,
    bOnlyWins,
    bothWin,
    bothDefeat,
    nonterminalPairs,
    meanCarriedHpDeltaBMinusA:
      terminalPairs === 0 ? null : hpDelta / terminalPairs,
    meanCompletedCombatDeltaBMinusA:
      terminalPairs === 0 ? null : completedCombatDelta / terminalPairs,
  };
};

const assertStreamIsolation = (
  a: M6BulkResult,
  b: M6BulkResult,
): void => {
  const episodesB = new Map(
    b.report.episodes.map((episode) => [episode.episodeId, episode]),
  );
  for (const left of a.report.episodes) {
    const right = episodesB.get(left.episodeId);
    if (right === undefined) {
      throw new Error(`missing stream evidence pair for ${left.episodeId}`);
    }
    const sharedCombatCount = Math.min(
      left.combatStreams.length,
      right.combatStreams.length,
    );
    for (let index = 0; index < sharedCombatCount; index += 1) {
      if (
        JSON.stringify(left.combatStreams[index]) !==
        JSON.stringify(right.combatStreams[index])
      ) {
        throw new Error(
          `combat stream mismatch for ${left.episodeId}/combat-${index}`,
        );
      }
    }
    const sharedRewardCount = Math.min(
      left.rewardOffers.length,
      right.rewardOffers.length,
    );
    for (let index = 0; index < sharedRewardCount; index += 1) {
      if (
        JSON.stringify(left.rewardOffers[index]) !==
        JSON.stringify(right.rewardOffers[index])
      ) {
        throw new Error(
          `reward stream mismatch for ${left.episodeId}/reward-${index}`,
        );
      }
    }
  }
};

const mergeAnomalySeeds = (
  a: readonly M6AnomalySeed[],
  b: readonly M6AnomalySeed[],
): readonly M6AnomalySeed[] => {
  const merged = new Map<
    string,
    {
      episodeIndex: number;
      episodeId: string;
      runSeed: string;
      traceIds: Set<string>;
      reasons: Set<string>;
    }
  >();
  const add = (seed: M6AnomalySeed, prefix: string): void => {
    const current = merged.get(seed.episodeId) ?? {
      episodeIndex: seed.episodeIndex,
      episodeId: seed.episodeId,
      runSeed: seed.runSeed,
      traceIds: new Set<string>(),
      reasons: new Set<string>(),
    };
    seed.traceIds.forEach((traceId) => current.traceIds.add(traceId));
    seed.reasons.forEach((reason) => current.reasons.add(`${prefix}:${reason}`));
    merged.set(seed.episodeId, current);
  };
  a.forEach((seed) => add(seed, "a"));
  b.forEach((seed) => add(seed, "b"));
  return [...merged.values()]
    .sort(
      (left, right) =>
        left.episodeIndex - right.episodeIndex ||
        compareText(left.episodeId, right.episodeId),
    )
    .map((seed) => ({
      episodeIndex: seed.episodeIndex,
      episodeId: seed.episodeId,
      runSeed: seed.runSeed,
      traceIds: [...seed.traceIds].sort(compareText),
      reasons: [...seed.reasons].sort(compareText),
    }));
};

export const runCrnComparison = (options: M6CrnOptions): M6CrnReport => {
  const variantA = options.variantA ?? "baseline";
  const variantB = options.variantB ?? "basic-first";
  const aa = proveAa(
    options.baseSeed,
    options.games,
    options.policyId,
    variantA,
    options.characterA,
    options.buildPolicyA,
  );
  const b = runBulk({
    baseSeed: options.baseSeed,
    games: options.games,
    policyIds: [options.policyId],
    variantIds: [variantB],
    ...(options.characterB === undefined
      ? {}
      : { characterIds: [options.characterB] }),
    ...(options.buildPolicyB === undefined
      ? {}
      : { buildPolicyIds: [options.buildPolicyB] }),
  });
  assertStreamIsolation(aa.result, b);

  return {
    schemaVersion: M6_CRN_REPORT_SCHEMA_VERSION,
    baseSeed: options.baseSeed,
    games: options.games,
    policyId: options.policyId,
    variantA,
    variantB,
    aa: aa.proof,
    paired: pairedOutcomes(aa.result.traces, b.traces),
    a: aa.result.report,
    b: b.report,
    anomalySeeds: mergeAnomalySeeds(
      aa.result.report.anomalySeeds,
      b.report.anomalySeeds,
    ),
  };
};
