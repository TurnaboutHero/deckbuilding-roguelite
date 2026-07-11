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
  it("puts the bonus magnitude first with a plus sign", () => {
    const slashHeads = skillEffectRows(skill("slash")).find(
      (row) => row.kind === "heads",
    );
    expect(slashHeads?.segments[0]?.text).toBe("피해 +4");
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

  it("tags burn segments with the burn keyword", () => {
    const rows = skillEffectRows(skill("ignite-sword"));
    expect(
      rows
        .flatMap((row) => row.segments)
        .filter((segment) => segment.text.startsWith("화상")),
    ).toEqual([{ text: "화상 2", term: "burn" }]);
  });
});
