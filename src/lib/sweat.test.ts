import { describe, expect, it } from "vitest";
import { formatChance, scoreLine, wagerOutcome } from "./sweat";

describe("formatChance", () => {
  it("rounds to whole percent", () => {
    expect(formatChance(0.6719)).toBe("67%");
    expect(formatChance(0.5)).toBe("50%");
  });
  it("never claims certainty for a bet that is still open", () => {
    expect(formatChance(0.999)).toBe(">99%");
    expect(formatChance(0.001)).toBe("<1%");
  });
  it("shows a dash when unknown", () => {
    expect(formatChance(null)).toBe("–");
  });
});

describe("wagerOutcome", () => {
  it("won shows the return", () => {
    expect(wagerOutcome({ status: "won", payoutCents: 5154, winProbability: 1 })).toEqual({
      label: "Won $51.54",
      tone: "win",
    });
  });
  it("lost and pushed", () => {
    expect(wagerOutcome({ status: "lost", payoutCents: 0, winProbability: 0 })).toEqual({ label: "Lost", tone: "loss" });
    expect(wagerOutcome({ status: "pushed", payoutCents: 1000, winProbability: 1 })).toEqual({
      label: "Push · $10 back",
      tone: "muted",
    });
  });
  it("pending shows the chance to cash", () => {
    expect(wagerOutcome({ status: "pending", payoutCents: null, winProbability: 0.6719 })).toEqual({
      label: "67% to cash",
      tone: "live",
    });
  });
});

describe("scoreLine", () => {
  const ev = { home_team: "Kansas City Chiefs", away_team: "Buffalo Bills", commence_time: "2026-11-05T01:15:00Z" };
  it("away score first, like the matchup", () => {
    expect(scoreLine({ ...ev, status: "final", home_score: 27, away_score: 24 })).toEqual({
      text: "Bills 24 · Chiefs 27",
      state: "Final",
    });
    expect(scoreLine({ ...ev, status: "live", home_score: 7, away_score: 14 })).toEqual({
      text: "Bills 14 · Chiefs 7",
      state: "Live",
    });
  });
  it("no score yet: nothing to show", () => {
    expect(scoreLine({ ...ev, status: "scheduled", home_score: null, away_score: null })).toBeNull();
  });
});
