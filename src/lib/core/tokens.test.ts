import { describe, expect, it } from "vitest";
import { stakesFitTokens, takeTokens, tokenPresets } from "./tokens";

describe("token mode", () => {
  it("presets split a $100 bankroll into whole-dollar tokens that add up", () => {
    const p = tokenPresets(10000);
    expect(p.map((x) => x.tokens)).toEqual([
      [2500, 2500, 5000],
      [2500, 2500, 2500, 2500],
      [5000, 5000],
    ]);
    for (const x of p) expect(x.tokens.reduce((a, b) => a + b, 0)).toBe(10000);
  });
  it("no presets when the bankroll doesn't split into whole dollars", () => {
    expect(tokenPresets(1000 + 50)).toEqual([]);
  });
  it("placed bets use up their tokens (one each)", () => {
    expect(takeTokens([2500, 2500, 5000], [2500])).toEqual([2500, 5000]);
    expect(takeTokens([2500, 2500, 5000], [2500, 2500])).toEqual([5000]);
  });
  it("a slip fits only if each stake is a distinct available token", () => {
    expect(stakesFitTokens([2500, 2500, 5000], [2500, 5000])).toBe(true);
    expect(stakesFitTokens([2500, 5000], [2500, 2500])).toBe(false);
    expect(stakesFitTokens([2500, 5000], [3000])).toBe(false);
  });
});
