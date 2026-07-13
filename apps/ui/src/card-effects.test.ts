import { contentDb } from "@game/content";
import { describe, expect, it } from "vitest";

import { skillEffectRows } from "./card-effects";

const skill = (id: string) => {
  const found = contentDb.skills[id];
  if (found === undefined) throw new Error(`missing skill ${id}`);
  return found;
};

describe("skillEffectRows", () => {
  it("builds base and heads rows for slash", () => {
    expect(skillEffectRows(skill("slash")).map((row) => row.kind)).toEqual([
      "base",
      "heads",
    ]);
  });

  it("builds base and tails rows for guard", () => {
    expect(skillEffectRows(skill("guard")).map((row) => row.kind)).toEqual([
      "base",
      "tails",
    ]);
  });

  it("marks burning-strike heads as per coin", () => {
    const heads = skillEffectRows(skill("burning-strike")).find(
      (row) => row.kind === "heads",
    );
    expect(heads?.modeNote).toBe("동전마다");
  });

  // 회귀 (값 잘림): 면 보너스 행은 값이 먼저 오고 +로 가산임을 명시한다 — 잘려도 수치는 보인다
  // P7 D2 기본기 하향: slash 기본 4 / 앞면 +3 (반복 기본기가 유료 스킬을 지배하지 않게)
  it("puts the bonus magnitude first with a plus sign", () => {
    const slashHeads = skillEffectRows(skill("slash")).find(
      (row) => row.kind === "heads",
    );
    expect(slashHeads?.segments[0]?.text).toBe("피해 +3");
    const strikeHeads = skillEffectRows(skill("burning-strike")).find(
      (row) => row.kind === "heads",
    );
    expect(strikeHeads?.segments[0]?.text).toBe("피해 +3");
  });

  it("builds cost and effect rows for ignite-sword", () => {
    const rows = skillEffectRows(skill("ignite-sword"));
    expect(rows.map((row) => row.kind)).toEqual(["cost", "effect"]);
    expect(rows[0]?.segments).toEqual([
      { text: "화염 ×1 소비", term: "consume" },
    ]);
  });

  it("builds all flip rows for flame-rampage", () => {
    expect(skillEffectRows(skill("flame-rampage")).map((row) => row.kind)).toEqual([
      "base",
      "heads",
      "tails",
    ]);
  });

  // P7 신규 원자 문구 — draw / nextTurnDraw / reduceCooldown / enterOverheat
  it("renders the P7 draw and cooldown atoms", () => {
    const focus = skillEffectRows(skill("battle-focus"));
    expect(focus[0]?.segments[0]?.text).toBe("코인 2개 뽑기");
    const focusHeads = focus.find((row) => row.kind === "heads");
    expect(focusHeads?.segments[0]?.text).toBe("다음 턴 뽑기 +1");

    const regroup = skillEffectRows(skill("regroup"));
    expect(regroup[0]?.segments.map((segment) => segment.text)).toEqual([
      "다른 스킬 쿨다운 -1",
      "코인 1개 뽑기",
    ]);
  });

  it("tags overheat entry with the overheat keyword", () => {
    const rows = skillEffectRows(skill("inner-passion"));
    expect(rows.find((row) => row.kind === "cost")?.segments).toEqual([
      { text: "화염 ×1 장전" },
    ]);
    expect(rows.find((row) => row.kind === "base")?.segments).toEqual([
      { text: "과열 진입", term: "overheat" },
    ]);
  });

  it("renders armor reference and delayed release effects without generic copy", () => {
    expect(skillEffectRows(skill("mana-amplification"))[1]?.segments[0]?.text).toBe(
      "현재 방어만큼 방어 (최대 10)",
    );
    expect(skillEffectRows(skill("armor-smash"))[1]?.segments[0]?.text).toBe(
      "피해 6 + 현재 방어 (최대 +10)",
    );
    expect(
      skillEffectRows(skill("arcane-armor-release"))[1]?.segments.map(
        (segment) => segment.text,
      ),
    ).toEqual([
      "방어 10",
      "소환 행동 후 현재 방어만큼 전체 피해 (최대 18)",
    ]);
  });

  it("tags burn segments with the burn keyword", () => {
    const rows = skillEffectRows(skill("ignite-sword"));
    expect(
      rows
        .flatMap((row) => row.segments)
        .filter((segment) => segment.text.startsWith("화상")),
    ).toEqual([{ text: "화상 2", term: "burn" }]);
  });
});
