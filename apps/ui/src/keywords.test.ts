import { describe, expect, it } from "vitest";

import { KEYWORD_GLOSSARY } from "./keywords";
import type { KeywordTerm } from "./keywords";

const TERMS: KeywordTerm[] = [
  "burn",
  "wither",
  "block",
  "flip",
  "consume",
  "trigger",
  "temporary",
  "elementCoin",
];

describe("KEYWORD_GLOSSARY", () => {
  it("defines every keyword with non-empty copy", () => {
    for (const term of TERMS) {
      expect(KEYWORD_GLOSSARY[term].label).not.toBe("");
      expect(KEYWORD_GLOSSARY[term].description).not.toBe("");
    }
  });

  it("does not contain replacement characters in descriptions", () => {
    for (const term of TERMS) {
      expect(KEYWORD_GLOSSARY[term].description).not.toContain("\uFFFD");
    }
  });

  it("uses the canonical wither label", () => {
    expect(KEYWORD_GLOSSARY.wither.label).toBe("위축");
  });

  it("defines the turn buff glossary copy", () => {
    expect(KEYWORD_GLOSSARY.trigger).toEqual({
      label: "턴 버프",
      description: "이번 턴 동안만 유지되는 발동 효과. 턴이 끝나면 사라진다.",
    });
  });
});
