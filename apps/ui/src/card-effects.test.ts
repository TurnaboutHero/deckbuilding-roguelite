import { contentDb } from "@game/content";
import { deriveUpgradedSkill } from "@game/core";
import { describe, expect, it } from "vitest";

import { skillDisplayName, skillEffectRows, skillSummaryText } from "./card-effects";

const skill = (id: string) => {
  const found = contentDb.skills[id];
  if (found === undefined) throw new Error(`missing skill ${id}`);
  return found;
};

const renderedTexts = (id: string) =>
  skillEffectRows(skill(id)).flatMap((row) => row.segments.map((segment) => segment.text));

describe("skillEffectRows", () => {
  it("renames Blood Offering to Blood Release at Blood Sword stage 5", () => {
    const offering = skill("blood-offering-skill");
    expect(skillDisplayName(offering, 4)).toBe("혈액 공양");
    expect(skillDisplayName(offering, 5)).toBe("혈마해방");
    expect(skillEffectRows(offering, 5)).toMatchObject([
      { kind: "cost", segments: [{ text: "혈액 1~3개 소비" }] },
      { kind: "effect", segments: [{ text: "이번 전투 혈마검술 피해: 소비당 +2" }] },
    ]);
  });

  it("builds D22 failure-floor and success rows for slash", () => {
    expect(skillEffectRows(skill("slash"))).toMatchObject([
      { kind: "tier", badge: "0개", segments: [{ text: "피해 2" }] },
      { kind: "tier", badge: "1개", segments: [{ text: "피해 4" }] },
    ]);
  });

  it("builds D22 failure-floor and success rows for guard", () => {
    expect(skillEffectRows(skill("guard"))).toMatchObject([
      { kind: "tier", badge: "0개", segments: [{ text: "방어 2" }] },
      { kind: "tier", badge: "1개", segments: [{ text: "방어 4" }] },
    ]);
  });

  it.each([
    ["slash", "피해"],
    ["guard", "방어"],
    ["jab", "피해"],
    ["fist-guard", "방어"],
  ])("renders upgraded %s basic rows as 2/5", (id, label) => {
    expect(skillEffectRows(deriveUpgradedSkill(skill(id)))).toMatchObject([
      { kind: "tier", badge: "0개", segments: [{ text: `${label} 2` }] },
      { kind: "tier", badge: "1개", segments: [{ text: `${label} 5` }] },
    ]);
  });

  it("marks burning-strike heads as per coin", () => {
    const heads = skillEffectRows(skill("burning-strike")).find((row) => row.kind === "heads");
    expect(heads?.modeNote).toBe("동전마다");
  });

  // 회귀 (값 잘림): 레거시 면 보너스 행은 값이 먼저 오고 +로 가산임을 명시한다.
  it("puts the bonus magnitude first with a plus sign", () => {
    const strikeHeads = skillEffectRows(skill("burning-strike")).find((row) => row.kind === "heads");
    expect(strikeHeads?.segments[0]?.text).toBe("피해 +3");
  });

  it("builds cost and effect rows for ignite-sword", () => {
    const rows = skillEffectRows(skill("ignite-sword"));
    expect(rows.map((row) => row.kind)).toEqual(["cost", "effect"]);
    expect(rows[0]?.segments).toEqual([{ text: "화염 ×1 소비", term: "consume" }]);
  });

  it("builds all flip rows for flame-rampage", () => {
    expect(skillEffectRows(skill("flame-rampage")).map((row) => row.kind)).toEqual(["base", "heads", "tails"]);
  });

  // P7 신규 원자 문구 — draw / nextTurnDraw / reduceCooldown / enterOverheat
  it("renders the P7 draw and cooldown atoms", () => {
    const focus = skillEffectRows(skill("battle-focus"));
    expect(focus[0]?.segments[0]?.text).toBe("코인 2개 뽑기");
    const focusHeads = focus.find((row) => row.kind === "heads");
    expect(focusHeads?.segments[0]?.text).toBe("다음 턴 뽑기 +1");

    const regroup = skillEffectRows(skill("regroup"));
    expect(regroup[0]?.segments.map((segment) => segment.text)).toEqual(["다른 스킬 쿨다운 -1", "코인 1개 뽑기"]);
  });

  it("tags overheat entry with the overheat keyword", () => {
    const rows = skillEffectRows(skill("inner-passion"));
    expect(rows.find((row) => row.kind === "cost")?.segments).toEqual([{ text: "화염 ×1 걸기" }]);
    expect(rows.find((row) => row.kind === "base")?.segments).toEqual([{ text: "과열 진입", term: "overheat" }]);
  });

  it("renders armor echo effects without generic copy", () => {
    const manaAmplification = skillEffectRows(skill("mana-amplification"));
    expect(manaAmplification[1]?.segments).toEqual([
      { text: "방어 6" },
      { text: "정밀 방어 준비", term: "precisionDefense" },
    ]);

    const armorSmash = skillEffectRows(skill("armor-smash"));
    expect(armorSmash[1]?.segments).toEqual([{ text: "피해 6 + 반향", term: "echoAmplification" }]);

    const arcaneArmorRelease = skillEffectRows(skill("arcane-armor-release"));
    expect(arcaneArmorRelease[1]?.segments).toEqual([
      { text: "방어 8" },
      { text: "모든 적 피해 4 + 반향", term: "echoAmplification" },
    ]);

    const armorCompression = skillEffectRows(skill("armor-compression"));
    expect(armorCompression.find((row) => row.kind === "heads")?.segments).toEqual([
      { text: "반향 예열 +2", term: "echoPreheat" },
    ]);

    for (const id of ["mana-amplification", "armor-smash", "arcane-armor-release", "armor-compression"]) {
      expect(renderedTexts(id)).not.toContain("효과");
    }
  });

  it("renders exact v1.2 Fire Fist tiers and remise atoms without generic copy", () => {
    expect(skillEffectRows(skill("fire-fist"))).toEqual([
      { kind: "tier", badge: "0개", segments: [{ text: "피해 2" }] },
      {
        kind: "tier",
        badge: "1개",
        segments: [{ text: "피해 4" }, { text: "화상 1", term: "burn" }],
      },
      {
        kind: "tier",
        badge: "2개",
        segments: [{ text: "피해 7" }, { text: "화상 2", term: "burn" }],
      },
      {
        kind: "rule",
        badge: "공명",
        segments: [{ text: "화상 1", term: "burn" }],
      },
    ]);

    expect(renderedTexts("redoublement")).toContain("르미즈 +1");
    expect(renderedTexts("fleche")).toContain("반복 시 피해 +4");
    expect(skillEffectRows(skill("fente")).find((row) => row.badge === "르미즈")?.segments).toEqual([
      { text: "반복 후 감전 1", term: "shock" },
    ]);

    for (const id of ["fire-fist", "redoublement", "fleche", "fente"]) {
      expect(renderedTexts(id)).not.toContain("효과");
    }
  });

  it("tags burn segments with the burn keyword", () => {
    const rows = skillEffectRows(skill("ignite-sword"));
    expect(rows.flatMap((row) => row.segments).filter((segment) => segment.text.startsWith("화상"))).toEqual([
      { text: "화상 2", term: "burn" },
    ]);
  });

  it("renders cold status, specified draw, and preservation rules without generic copy", () => {
    const claw = skillEffectRows(skill("ice-claw"));
    expect(claw[0]?.segments.map((segment) => segment.text)).toEqual(["피해 8", "동상 2"]);

    const pickpocket = skillEffectRows(skill("preserved-pickpocket"));
    expect(pickpocket.find((row) => row.kind === "preserved")?.segments[0]?.text).toBe("기본/냉기 중 1개 지정 뽑기");
    expect(pickpocket.find((row) => row.kind === "rule")?.segments[0]?.text).toBe(
      "보존 기본 코인을 냉기 코인으로 취급",
    );

    const loot = skillEffectRows(skill("loot-swap"));
    expect(loot.find((row) => row.kind === "effect")?.segments[1]?.text).toBe("기본/냉기 중 1개 지정 뽑기 후 보존");
    expect(loot.find((row) => row.kind === "preserved")?.segments[0]?.text).toBe("방어 +3");

    const pocket = skillEffectRows(skill("hidden-inner-pocket"));
    expect(pocket.find((row) => row.kind === "base")?.segments[1]?.text).toBe("동전 1개를 보존");

    const raid = skillEffectRows(skill("trackless-raid"));
    expect(raid.find((row) => row.kind === "preserved")?.segments.map((segment) => segment.text)).toEqual([
      "피해 +4",
      "동상 +1",
    ]);
  });

  it("renders variable/all consume costs and complete dynamic damage formulae", () => {
    const incision = skillEffectRows(skill("freezing-incision"));
    expect(incision[0]?.segments[0]?.text).toBe("냉기 1~3개 소비");
    expect(incision[1]?.segments[0]?.text).toBe("피해 5 + 소비당 5");

    const freezeDry = skillEffectRows(skill("freeze-dry"));
    expect(freezeDry[0]?.segments[0]?.text).toBe("냉기 최소 3개·손의 전부 소비");
    expect(freezeDry[1]?.segments[0]?.text).toBe("피해 0 + 소비당 8 (동상 대상이면 소비당 +2)");

    const perfectCrime = skillSummaryText(skill("subzero-perfect-crime"));
    expect(perfectCrime).toContain("피해 6 + 동상 ×3 (최대 24)");
    expect(perfectCrime).toContain("보존: 기본/냉기 중 1개 지정 뽑기 후 보존");
  });
});
