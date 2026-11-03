import { describe, expect, it } from "vitest";
import { oddsCallCost, usageFromHeaders } from "./budget.ts";

describe("oddsCallCost (The Odds API v4: markets × regions; ≤10 bookmakers = 1 region)", () => {
  it("charges one credit per market for up to 10 bookmakers", () => {
    expect(oddsCallCost(["h2h", "spreads", "totals"], ["draftkings", "fanduel", "betmgm"])).toBe(3);
    expect(oddsCallCost(["h2h"], ["draftkings"])).toBe(1);
  });

  it("charges another region per extra group of 10 bookmakers", () => {
    const books = Array.from({ length: 11 }, (_, i) => `book${i}`);
    expect(oddsCallCost(["h2h", "spreads"], books)).toBe(4);
  });

  it("counts a duplicated market once", () => {
    expect(oddsCallCost(["h2h", "h2h"], ["draftkings"])).toBe(1);
  });

  it("an empty market list or no bookmakers is a bug, not a free call", () => {
    expect(() => oddsCallCost([], ["draftkings"])).toThrow();
    expect(() => oddsCallCost(["h2h"], [])).toThrow();
  });
});

describe("usageFromHeaders", () => {
  it("reads cost and remaining credits", () => {
    const h = new Headers({ "x-requests-last": "3", "x-requests-remaining": "497", "x-requests-used": "3" });
    expect(usageFromHeaders(h)).toEqual({ creditsUsed: 3, creditsRemaining: 497 });
  });

  it("returns nulls when the headers are missing or garbage", () => {
    expect(usageFromHeaders(new Headers())).toEqual({ creditsUsed: null, creditsRemaining: null });
    expect(usageFromHeaders(new Headers({ "x-requests-last": "abc" }))).toEqual({
      creditsUsed: null,
      creditsRemaining: null,
    });
  });

  it("rounds fractional counters conservatively (cost up, remaining down)", () => {
    const h = new Headers({ "x-requests-last": "2.2", "x-requests-remaining": "497.8" });
    expect(usageFromHeaders(h)).toEqual({ creditsUsed: 3, creditsRemaining: 497 });
  });
});
