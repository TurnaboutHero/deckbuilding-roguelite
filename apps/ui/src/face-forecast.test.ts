import { contentDb } from "@game/content";
import type { CoinDef, FlipSkillDef } from "@game/core";
import { describe, expect, it } from "vitest";

import { buildFaceForecast } from "./face-forecast";

const coin = (definition: CoinDef) => ({
  elements: definition.element === null ? [] : [definition.element],
  heads: definition.procs?.heads ?? [],
  tails: definition.procs?.tails ?? [],
});

describe("buildFaceForecast", () => {
  it("combines a one-coin success ladder tier with each basic coin face", () => {
    const skill = contentDb.skills.slash as FlipSkillDef;
    const forecast = buildFaceForecast(skill, [coin(contentDb.coins.basic!)]);

    expect(forecast).toEqual({
      heads: "피해 8",
      tails: "피해 2 · 방어 4",
      multi: false,
    });
  });

  it("shows only all-heads and all-tails extremes for multiple coins", () => {
    const skill = contentDb.skills["fire-fist"] as FlipSkillDef;
    const forecast = buildFaceForecast(skill, [
      coin(contentDb.coins.basic!),
      coin(contentDb.coins.fire!),
    ]);

    expect(forecast?.multi).toBe(true);
    expect(forecast?.heads).toContain("피해");
    expect(forecast?.heads).toContain("화상 2");
    expect(forecast?.tails).toContain("방어 7");
  });

  it("keeps authored blood coin health payment in the heads forecast", () => {
    const skill = contentDb.skills.slash as FlipSkillDef;
    const forecast = buildFaceForecast(skill, [coin(contentDb.coins.blood!)]);

    expect(forecast?.heads).toContain("체력 2 지불");
    expect(forecast?.heads).toContain("피해 11");
    expect(forecast?.tails).toContain("출혈 2");
  });

  it("returns null when no coin is loaded", () => {
    expect(
      buildFaceForecast(contentDb.skills.slash as FlipSkillDef, []),
    ).toBeNull();
  });
});
