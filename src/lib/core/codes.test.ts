import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  codePrefix,
  generateCode,
  isValidCode,
  normalizeCode,
} from "./codes";

describe("codePrefix", () => {
  it("uses initials for multi-word titles", () => {
    expect(codePrefix("Thursday Night Football")).toBe("TNF");
  });
  it("drops stop words", () => {
    expect(codePrefix("The Battle of the Bay")).toBe("BB");
  });
  it("truncates single words to 5 chars", () => {
    expect(codePrefix("Lakers")).toBe("LAKER");
  });
  it("falls back to SB when too short or empty", () => {
    expect(codePrefix("!")).toBe("SB");
    expect(codePrefix("X")).toBe("SB");
  });
  it("caps initials at 5", () => {
    expect(codePrefix("a b c d e f g h")).toBe("BCDEF");
  });
});

describe("generateCode", () => {
  it("produces a valid code", () => {
    for (let i = 0; i < 200; i++) expect(isValidCode(generateCode("Sunday Slate"))).toBe(true);
  });
  it("is deterministic with injected rng", () => {
    expect(generateCode("Thursday Night Football", () => 0)).toBe("TNF-2222");
  });
  it("never emits ambiguous characters", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01ILOU]/);
  });
});

describe("normalizeCode", () => {
  it("uppercases and inserts the dash", () => {
    expect(normalizeCode(" tnf 8x29 ")).toBe("TNF-8X29");
    expect(normalizeCode("tnf-8x29")).toBe("TNF-8X29");
  });
  it("leaves too-short input alone", () => {
    expect(normalizeCode("ab")).toBe("AB");
  });
});

describe("isValidCode", () => {
  it("rejects ambiguous suffix characters", () => {
    expect(isValidCode("TNF-8X2O")).toBe(false);
    expect(isValidCode("TNF-8X21")).toBe(false);
    expect(isValidCode("TNF-8X29")).toBe(true);
  });
});
