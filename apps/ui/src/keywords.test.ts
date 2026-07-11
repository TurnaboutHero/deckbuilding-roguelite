import { describe, expect, it } from "vitest";

import { KEYWORD_GLOSSARY } from "./keywords";
import type { KeywordTerm } from "./keywords";

const TERMS: KeywordTerm[] = [
  "burn",
  "wither",
  "block",
  "flip",
  "consume",
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
});
