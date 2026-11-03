import { describe, expect, it } from "vitest";
import {
  MAX_PARLAY_DECIMAL_E4,
  americanToDecimalE4,
  decimalE4ToAmerican,
  devig,
  impliedProbability,
  isValidAmerican,
  parlayDecimalE4,
  payoutCents,
} from "./odds";

describe("americanToDecimalE4 (mirrors odds_cache.price_decimal)", () => {
  it.each([
    [-110, 19091],
    [-105, 19524],
    [+150, 25000],
    [-200, 15000],
    [+100, 20000],
    [-100, 20000],
    [+1000, 110000],
    [-128, 17813], // 1 + 100/128 = 1.78125 → half rounds up
  ])("%i → %i", (american, e4) => {
    expect(americanToDecimalE4(american)).toBe(e4);
  });

  it("rejects invalid prices", () => {
    expect(() => americanToDecimalE4(50)).toThrow(RangeError);
    expect(() => americanToDecimalE4(-99)).toThrow(RangeError);
    expect(() => americanToDecimalE4(1.5)).toThrow(RangeError);
    expect(isValidAmerican(0)).toBe(false);
  });
});

describe("decimalE4ToAmerican", () => {
  it.each([
    [19091, -110],
    [25000, 150],
    [20000, 100],
    [15000, -200],
    [69580, 596],
    [13200, -313], // -312.5 rounds away from zero, like Postgres round()
  ])("%i → %i", (e4, american) => {
    expect(decimalE4ToAmerican(e4)).toBe(american);
  });

  it("rejects decimals ≤ 1", () => {
    expect(() => decimalE4ToAmerican(10000)).toThrow(RangeError);
  });
});

describe("parlayDecimalE4 (mirrors round(product, 4))", () => {
  it("single leg is unchanged", () => {
    expect(parlayDecimalE4([19091])).toBe(19091);
  });
  it("two -110 legs", () => {
    // 1.9091² = 3.64466281 → 3.6447
    expect(parlayDecimalE4([19091, 19091])).toBe(36447);
  });
  it("three -110 legs ≈ +596", () => {
    expect(parlayDecimalE4([19091, 19091, 19091])).toBe(69580);
  });
  it("rounds an exact half up", () => {
    // -800 (1.125) × -400 (1.25) = 1.40625 → 1.4063
    expect(parlayDecimalE4([americanToDecimalE4(-800), americanToDecimalE4(-400)])).toBe(14063);
  });
  it("caps longshot parlays at 1000-to-1", () => {
    expect(parlayDecimalE4(Array(10).fill(110000))).toBe(MAX_PARLAY_DECIMAL_E4);
  });
  it("rejects empty or invalid legs", () => {
    expect(() => parlayDecimalE4([])).toThrow(RangeError);
    expect(() => parlayDecimalE4([9000])).toThrow(RangeError);
  });
});

describe("payoutCents (mirrors floor(amount * decimal))", () => {
  it("floors fractional cents", () => {
    expect(payoutCents(1000, 19091)).toBe(1909); // $10 at -110 returns $19.09
  });
  it("is exact where floats would drift", () => {
    expect(payoutCents(100, 23000)).toBe(230); // 100 * 2.3 = 229.99999999999997 in floats
    expect(payoutCents(10_000, 36447)).toBe(36447);
  });
  it("handles the largest bankroll at the parlay cap", () => {
    expect(payoutCents(100_000_000, MAX_PARLAY_DECIMAL_E4)).toBe(100_100_000_000);
  });
});

describe("probabilities", () => {
  it("implied probability includes vig", () => {
    expect(impliedProbability(-110)).toBeCloseTo(0.5238, 4);
    expect(impliedProbability(+150)).toBeCloseTo(0.4, 4);
  });
  it("devig normalizes a two-way market", () => {
    const [a, b] = devig([impliedProbability(-110), impliedProbability(-110)]);
    expect(a).toBeCloseTo(0.5, 10);
    expect(b).toBeCloseTo(0.5, 10);
  });
});
