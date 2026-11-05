import { describe, expect, it } from "vitest";
import { formatChance, propProgress, scoreLine, sweatTag, wagerOutcome } from "./sweat";

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

describe("propProgress: a prop pick's live number", () => {
  const leg = { marketKey: "player_points", selection: "Over", line: 25.5, status: "pending" };
  it("no number yet: nothing to show", () => {
    expect(propProgress({ ...leg, liveStat: null })).toBeNull();
  });
  it("Over: how many more he needs, then cleared", () => {
    expect(propProgress({ ...leg, liveStat: 18 })).toEqual({ text: "18 Pts · needs 8 more", tone: "live" });
    expect(propProgress({ ...leg, liveStat: 26 })).toEqual({ text: "26 Pts · cleared", tone: "win" });
    expect(propProgress({ ...leg, line: 8, marketKey: "player_rebounds", liveStat: 8 })).toEqual({
      text: "8 Reb · needs 1 more",
      tone: "live",
    });
  });
  it("Under: how much room is left, then busted", () => {
    const under = { ...leg, selection: "Under", line: 27.5 };
    expect(propProgress({ ...under, liveStat: 18 })).toEqual({ text: "18 Pts · 9 to spare", tone: "live" });
    expect(propProgress({ ...under, liveStat: 27 })).toEqual({ text: "27 Pts · 0 to spare", tone: "live" });
    expect(propProgress({ ...under, liveStat: 28 })).toEqual({ text: "28 Pts · went over", tone: "loss" });
    expect(propProgress({ ...under, line: 8, marketKey: "player_assists", liveStat: 8 })).toEqual({
      text: "8 Ast · on the line",
      tone: "muted",
    });
  });
  it("a ladder pick uses its stat's name", () => {
    expect(propProgress({ ...leg, marketKey: "player_rush_yds_alternate", line: 49.5, liveStat: 50 })).toEqual({
      text: "50 Rush Yds · cleared",
      tone: "win",
    });
  });
  it("graded pick: just the number", () => {
    expect(propProgress({ ...leg, status: "hit", liveStat: 31 })).toEqual({ text: "31 Pts", tone: "muted" });
  });
  it("game lines have no player number", () => {
    expect(propProgress({ marketKey: "h2h", selection: "Boston Celtics", line: null, status: "pending", liveStat: 3 })).toBeNull();
  });
});

describe("sweatTag: tension at a glance", () => {
  it("Safe at 80%+, Danger at 20% or less, Sweating in between", () => {
    expect(sweatTag(0.84)).toEqual({ label: "Safe", tone: "win" });
    expect(sweatTag(0.8)).toEqual({ label: "Safe", tone: "win" });
    expect(sweatTag(0.5)).toEqual({ label: "Sweating", tone: "live" });
    expect(sweatTag(0.2)).toEqual({ label: "Danger", tone: "loss" });
    expect(sweatTag(0.03)).toEqual({ label: "Danger", tone: "loss" });
  });
  it("no chance known: no tag", () => {
    expect(sweatTag(null)).toBeNull();
  });
});
