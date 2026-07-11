import { foldM6Metrics, type M6AnomalyFlag, type M6RunTrace } from "../metrics";
import { POLICY_IDS, type PolicyId } from "../policies";
import { simulatePolicyRun } from "../run-sim";
import { deriveEpisodeSeed, episodeIdFor, fingerprintText } from "./seed";
import {
  M6_BULK_REPORT_SCHEMA_VERSION,
  M6_BUILD_POLICY_IDS,
  SIM_CHARACTER_IDS,
  M6_VARIANT_IDS,
  type M6AnomalySeed,
  type M6AaIdentityProof,
  type M6BulkOptions,
  type M6BulkResult,
  type M6EpisodeFingerprint,
  type M6EpisodeTranscript,
  type M6BuildPolicyId,
  type SimCharacterId,
  type M6VariantId,
} from "./types";

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export interface M6FixedAnomalyFixture {
  readonly baseSeed: string;
  readonly episodeIndex: number;
  readonly reason: string;
}

/**
 * Persistent regression fixtures belong here. Entries are always emitted in
 * anomalySeeds even when current metrics no longer flag them, so a formerly
 * interesting seed cannot disappear without an explicit code review.
 */
export const M6_FIXED_ANOMALY_FIXTURES: readonly M6FixedAnomalyFixture[] =
  Object.freeze([]);

const validateIds = <T extends string>(
  values: readonly T[],
  allowed: readonly T[],
  label: string,
): void => {
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  const allowedSet = new Set<string>(allowed);
  for (const value of values) {
    if (!allowedSet.has(value)) throw new Error(`unknown ${label}: ${value}`);
  }
};

const validateOptions = (options: M6BulkOptions): void => {
  if (options.baseSeed.length === 0) throw new Error("baseSeed is required");
  if (!Number.isSafeInteger(options.games) || options.games <= 0) {
    throw new RangeError("games must be a positive safe integer");
  }
  validateIds(options.policyIds, POLICY_IDS, "policyIds");
  validateIds(options.variantIds ?? ["baseline"], M6_VARIANT_IDS, "variantIds");
  validateIds(options.characterIds ?? ["warrior"], SIM_CHARACTER_IDS, "characterIds");
  validateIds(
    options.buildPolicyIds ?? ["fire-build"],
    M6_BUILD_POLICY_IDS,
    "buildPolicyIds",
  );
};

const anomalyTraceId = (anomaly: M6AnomalyFlag): string | undefined => {
  switch (anomaly.kind) {
    case "nonterminal":
    case "invariantFailure":
    case "extremeTurnCount":
    case "extremeDamage":
      return anomaly.traceId;
    case "gatekeeperPolicySequenceConvergence":
    case "consumeDominanceWarning":
      return undefined;
  }
};

const anomalyEpisodeId = (anomaly: M6AnomalyFlag): string | undefined => {
  switch (anomaly.kind) {
    case "nonterminal":
    case "invariantFailure":
    case "gatekeeperPolicySequenceConvergence":
      return anomaly.episodeId;
    case "extremeTurnCount":
    case "extremeDamage":
    case "consumeDominanceWarning":
      return undefined;
  }
};

interface MutableAnomalySeed {
  episodeIndex: number;
  episodeId: string;
  runSeed: string;
  traceIds: Set<string>;
  reasons: Set<string>;
}

const buildAnomalyLists = (
  baseSeed: string,
  traces: readonly M6RunTrace[],
  anomalies: readonly M6AnomalyFlag[],
): {
  readonly anomalySeeds: readonly M6AnomalySeed[];
  readonly globalAnomalies: readonly M6AnomalyFlag[];
} => {
  const byTraceId = new Map(traces.map((trace) => [trace.traceId, trace]));
  const byEpisodeId = new Map<string, M6RunTrace>();
  for (const trace of traces) {
    if (!byEpisodeId.has(trace.episodeId)) byEpisodeId.set(trace.episodeId, trace);
  }
  const seeds = new Map<string, MutableAnomalySeed>();
  const globalAnomalies: M6AnomalyFlag[] = [];
  const ensure = (trace: M6RunTrace): MutableAnomalySeed => {
    const current = seeds.get(trace.episodeId) ?? {
      episodeIndex: trace.episodeIndex,
      episodeId: trace.episodeId,
      runSeed: trace.runSeed,
      traceIds: new Set<string>(),
      reasons: new Set<string>(),
    };
    seeds.set(trace.episodeId, current);
    return current;
  };

  for (const trace of traces) {
    if (trace.crash !== null) {
      const seed = ensure(trace);
      seed.traceIds.add(trace.traceId);
      seed.reasons.add(`crash:${trace.crash.code}`);
    }
  }
  for (const anomaly of anomalies) {
    const traceId = anomalyTraceId(anomaly);
    const episodeId = anomalyEpisodeId(anomaly);
    const trace =
      (traceId === undefined ? undefined : byTraceId.get(traceId)) ??
      (episodeId === undefined ? undefined : byEpisodeId.get(episodeId));
    if (trace === undefined) {
      globalAnomalies.push(anomaly);
      continue;
    }
    const seed = ensure(trace);
    if (traceId !== undefined) seed.traceIds.add(traceId);
    else {
      for (const paired of traces.filter(
        (candidate) => candidate.episodeId === trace.episodeId,
      )) {
        seed.traceIds.add(paired.traceId);
      }
    }
    seed.reasons.add(`${anomaly.kind}:${JSON.stringify(anomaly)}`);
  }

  for (const fixture of M6_FIXED_ANOMALY_FIXTURES) {
    if (fixture.baseSeed !== baseSeed) continue;
    const episodeId = episodeIdFor(baseSeed, fixture.episodeIndex);
    const runSeed = deriveEpisodeSeed(baseSeed, fixture.episodeIndex);
    const current = seeds.get(episodeId) ?? {
      episodeIndex: fixture.episodeIndex,
      episodeId,
      runSeed,
      traceIds: new Set<string>(),
      reasons: new Set<string>(),
    };
    current.reasons.add(`fixed:${fixture.reason}`);
    seeds.set(episodeId, current);
  }

  return {
    anomalySeeds: [...seeds.values()]
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
      })),
    globalAnomalies: [...globalAnomalies].sort((left, right) =>
      compareText(JSON.stringify(left), JSON.stringify(right)),
    ),
  };
};

const executeBulk = (
  options: M6BulkOptions,
  verifyAaIdentity: boolean,
): { readonly result: M6BulkResult; readonly aa: M6AaIdentityProof | null } => {
  validateOptions(options);
  const policyIds = [...options.policyIds].sort(compareText) as PolicyId[];
  const variantIds = [...(options.variantIds ?? ["baseline"])]
    .sort(compareText) as M6VariantId[];
  const characterIds =
    options.characterIds === undefined
      ? [undefined]
      : ([...options.characterIds].sort(compareText) as SimCharacterId[]);
  const buildPolicyIds =
    options.buildPolicyIds === undefined
      ? [undefined]
      : ([...options.buildPolicyIds].sort(compareText) as M6BuildPolicyId[]);
  const traces: M6RunTrace[] = [];
  const transcripts: M6EpisodeTranscript[] = [];
  const episodes: M6EpisodeFingerprint[] = [];
  const aaEpisodeFingerprints: string[] = [];
  let aaByteLength = 0;

  for (let episodeIndex = 0; episodeIndex < options.games; episodeIndex += 1) {
    const runSeed = deriveEpisodeSeed(options.baseSeed, episodeIndex);
    const episodeId = episodeIdFor(options.baseSeed, episodeIndex);
    for (const characterId of characterIds) {
      for (const buildPolicyId of buildPolicyIds) {
        for (const variantId of variantIds) {
          for (const policyId of policyIds) {
        const simulation = simulatePolicyRun({
          baseSeed: options.baseSeed,
          runSeed,
          episodeId,
          episodeIndex,
          policyId,
          variantId,
          characterId,
          buildPolicyId,
        });
        if (verifyAaIdentity) {
          const replay = simulatePolicyRun({
            baseSeed: options.baseSeed,
            runSeed,
            episodeId,
            episodeIndex,
            policyId,
            variantId,
            characterId,
            buildPolicyId,
          });
          const simulationBytes = JSON.stringify(simulation);
          const replayBytes = JSON.stringify(replay);
          if (simulationBytes !== replayBytes) {
            throw new Error(
              `A=A replay mismatch for ${policyId}/${variantId}/${episodeId}`,
            );
          }
          aaByteLength += simulationBytes.length;
          aaEpisodeFingerprints.push(fingerprintText(simulationBytes));
        }
        traces.push(simulation.trace);
        if (options.captureTranscripts === true) {
          transcripts.push(simulation.transcript);
        }
        episodes.push({
          episodeIndex: simulation.trace.episodeIndex,
          episodeId: simulation.trace.episodeId,
          runSeed: simulation.trace.runSeed,
          traceId: simulation.trace.traceId,
          result: simulation.trace.result,
          fingerprint: fingerprintText(
            JSON.stringify({
              trace: simulation.trace,
              transcript: simulation.transcript,
            }),
          ),
          combatStreams: simulation.transcript.combats.map(
            (combat) => combat.initialRng,
          ),
          rewardOffers: simulation.transcript.rewards.map((reward) => ({
            coinOptions: reward.coinOptions,
            skillOptions: reward.skillOptions,
            fallbackCoinOptions: reward.fallbackCoinOptions,
          })),
        });
      }
    }
    }
    }
  }

  const metrics = foldM6Metrics(traces);
  const anomalyLists = buildAnomalyLists(
    options.baseSeed,
    traces,
    metrics.anomalies,
  );
  const result: M6BulkResult = {
    report: {
      schemaVersion: M6_BULK_REPORT_SCHEMA_VERSION,
      baseSeed: options.baseSeed,
      games: options.games,
      policyIds,
      variantIds,
      metrics,
      anomalySeeds: anomalyLists.anomalySeeds,
      globalAnomalies: anomalyLists.globalAnomalies,
      episodes,
      tracesIncluded: false,
    },
    traces,
    transcripts,
  };
  return {
    result,
    aa: verifyAaIdentity
      ? {
          identical: true,
          byteLength: aaByteLength,
          fingerprint: fingerprintText(aaEpisodeFingerprints.join(":")),
        }
      : null,
  };
};

export const runBulk = (options: M6BulkOptions): M6BulkResult =>
  executeBulk(options, false).result;

export const runBulkWithAaIdentity = (
  options: M6BulkOptions,
): { readonly result: M6BulkResult; readonly aa: M6AaIdentityProof } => {
  const verified = executeBulk(options, true);
  if (verified.aa === null) throw new Error("A=A proof was not produced");
  return { result: verified.result, aa: verified.aa };
};
