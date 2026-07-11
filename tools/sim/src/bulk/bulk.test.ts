import { describe, expect, it } from "vitest";

import { foldM6Metrics } from "../metrics";
import { POLICY_IDS } from "../policies";
import { simulatePolicyRun } from "../run-sim";
import {
  deriveEpisodeSeed,
  episodeIdFor,
  proveAaIdentity,
  runBulk,
  runCrnComparison,
} from "./index";

describe("M6 bulk episode integration", () => {
  it("derives stable, index-separated episode seeds", () => {
    expect(deriveEpisodeSeed("1", 0)).toBe(deriveEpisodeSeed("1", 0));
    expect(deriveEpisodeSeed("1", 1)).not.toBe(deriveEpisodeSeed("1", 0));
    expect(episodeIdFor("1", 0)).toBe(episodeIdFor("1", 0));
    expect(() => deriveEpisodeSeed("1", -1)).toThrow(
      "episodeIndex must be a non-negative safe integer",
    );
  });

  it("records every actual command/event and every public opportunity snapshot", () => {
    const result = runBulk({
      baseSeed: "M6-TRACE",
      games: 1,
      policyIds: ["aggro"],
      captureTranscripts: true,
    });
    const trace = result.traces[0];
    const transcript = result.transcripts[0];
    expect(trace).toBeDefined();
    expect(transcript).toBeDefined();
    if (trace === undefined || transcript === undefined) return;

    expect(trace.result === "victory" || trace.result === "defeat").toBe(true);
    expect(trace.crash).toBeNull();
    expect(
      trace.invariantViolations.length +
        trace.combats.reduce(
          (count, combat) => count + combat.invariantViolations.length,
          0,
        ),
    ).toBe(0);
    expect(transcript.combats).toHaveLength(trace.combats.length);

    for (const combatTranscript of transcript.combats) {
      expect(combatTranscript.commands.length).toBeGreaterThan(0);
      expect(combatTranscript.opportunities).toHaveLength(
        combatTranscript.commands.length,
      );
      for (let index = 0; index < combatTranscript.commands.length; index += 1) {
        const command = combatTranscript.commands[index];
        const opportunity = combatTranscript.opportunities[index];
        expect(command).toBeDefined();
        expect(opportunity).toBeDefined();
        if (command === undefined || opportunity === undefined) continue;
        expect(command.decisionIndex).toBe(opportunity.decisionIndex);
        expect(opportunity.legalCommandKeys).toContain(command.commandKey);
        expect(Array.isArray(command.events)).toBe(true);
      }
    }

    expect(result.report.metrics).toEqual(foldM6Metrics(result.traces));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("captures a bounded nonterminal trace instead of losing the attempted episode", () => {
    const baseSeed = "M6-BOUND";
    const simulation = simulatePolicyRun({
      baseSeed,
      runSeed: deriveEpisodeSeed(baseSeed, 0),
      episodeId: episodeIdFor(baseSeed, 0),
      episodeIndex: 0,
      policyId: "random",
      maxCommandsPerCombat: 1,
    });

    expect(simulation.trace.result).toBe("nonterminal");
    expect(simulation.trace.crash).toBeNull();
    expect(simulation.trace.combats).toHaveLength(1);
    expect(simulation.transcript.combats[0]?.commands).toHaveLength(1);
    expect(simulation.trace.combats[0]?.turns).toHaveLength(1);
  });
});

describe("M6 deterministic bulk and CRN", () => {
  it("replays the same matrix byte-for-byte and keeps episode ordering stable", () => {
    const options = {
      baseSeed: "M6-REPLAY",
      games: 3,
      policyIds: ["random", "greedy"] as const,
    };
    const first = JSON.stringify(runBulk(options));
    const replay = JSON.stringify(runBulk(options));
    expect(replay).toBe(first);

    const report = runBulk(options).report;
    expect(report.episodes.map((episode) => episode.traceId)).toEqual([
      "baseline/greedy/00000000",
      "baseline/random/00000000",
      "baseline/greedy/00000001",
      "baseline/random/00000001",
      "baseline/greedy/00000002",
      "baseline/random/00000002",
    ]);
  });

  it("proves A=A identity before paired reward-preference A/B", () => {
    const proof = proveAaIdentity("M6-AA", 2, "random");
    expect(proof.identical).toBe(true);
    expect(proof.byteLength).toBeGreaterThan(0);
    expect(proof.fingerprint).toMatch(/^[0-9a-f]{8}$/);

    const report = runCrnComparison({
      baseSeed: "M6-CRN",
      games: 3,
      policyId: "random",
      variantA: "baseline",
      variantB: "basic-first",
    });
    expect(report.aa.identical).toBe(true);
    expect(report.paired.pairs).toBe(3);
    expect(report.a.episodes.map((episode) => episode.runSeed)).toEqual(
      report.b.episodes.map((episode) => episode.runSeed),
    );
    for (let index = 0; index < report.a.episodes.length; index += 1) {
      const a = report.a.episodes[index];
      const b = report.b.episodes[index];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) continue;
      expect(b.combatStreams.slice(0, a.combatStreams.length)).toEqual(
        a.combatStreams.slice(0, b.combatStreams.length),
      );
      expect(b.rewardOffers.slice(0, a.rewardOffers.length)).toEqual(
        a.rewardOffers.slice(0, b.rewardOffers.length),
      );
    }
    expect(report.anomalySeeds).toEqual(
      [...report.anomalySeeds].sort(
        (left, right) => left.episodeIndex - right.episodeIndex,
      ),
    );
  });

  it("terminates a small matrix for every accepted policy", () => {
    const result = runBulk({
      baseSeed: "M6-POLICY-MATRIX",
      games: 2,
      policyIds: POLICY_IDS,
    });

    expect(result.report.metrics.outcomes.runs).toBe(8);
    expect(result.report.metrics.outcomes.terminalRuns).toBe(8);
    expect(result.report.metrics.outcomes.crashRuns).toBe(0);
    expect(result.report.metrics.outcomes.invariantViolationCount).toBe(0);
    expect(result.report.metrics.policyOutcomes.map((item) => item.policyId)).toEqual([
      "aggro",
      "greedy",
      "random",
      "turtle",
    ]);
  });

  it("can run the accepted policy matrix for guardian with unique trace ids", () => {
    const result = runBulk({
      baseSeed: "P3-GUARDIAN-POLICY-MATRIX",
      games: 2,
      policyIds: POLICY_IDS,
      characterIds: ["guardian"],
    });

    expect(result.report.metrics.outcomes.runs).toBe(8);
    expect(result.report.metrics.outcomes.terminalRuns).toBe(8);
    expect(result.report.metrics.outcomes.crashRuns).toBe(0);
    expect(result.report.metrics.outcomes.invariantViolationCount).toBe(0);
    expect(result.traces.every((trace) => trace.characterId === "guardian")).toBe(
      true,
    );
    expect(new Set(result.traces.map((trace) => trace.traceId)).size).toBe(
      result.traces.length,
    );
  });
});
