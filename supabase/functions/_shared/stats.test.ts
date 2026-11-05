import { describe, expect, it } from "vitest";
import { espnBoxToStats, espnDate, espnScoreboardUrl, espnSummaryUrl, fakeBoxStats, findEspnGame } from "./stats.ts";

// Shapes from ESPN's public NBA feed (site.api.espn.com/apis/site/v2/sports/basketball/nba/...), trimmed.
const scoreboard = {
  events: [
    {
      id: "401909922",
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { displayName: "Detroit Pistons" } },
            { homeAway: "away", team: { displayName: "Philadelphia 76ers" } },
          ],
        },
      ],
    },
    {
      id: "401909935",
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { displayName: "LA Clippers" } },
            { homeAway: "away", team: { displayName: "Miami Heat" } },
          ],
        },
      ],
    },
  ],
};

const KEYS = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers"];

const summary = (state: "in" | "post") => ({
  header: { competitions: [{ status: { type: { state, completed: state === "post" } } }] },
  boxscore: {
    players: [
      {
        team: { displayName: "Philadelphia 76ers" },
        statistics: [
          {
            keys: KEYS,
            athletes: [
              { athlete: { displayName: "Joel Embiid" }, stats: ["10", "8", "2-7", "0-1", "4-4", "5", "1", "0"] },
              { athlete: { displayName: "Kelly Oubre Jr." }, stats: ["12", "14", "6-8", "2-3", "0-0", "2", "3", "1"] },
              { athlete: { displayName: "Bench Guy" }, didNotPlay: true, stats: [] },
            ],
          },
        ],
      },
      {
        team: { displayName: "Detroit Pistons" },
        statistics: [
          { keys: KEYS, athletes: [{ athlete: { displayName: "Cade Cunningham" }, stats: ["11", "9", "4-9", "1-2", "0-0", "1", "6", "2"] }] },
        ],
      },
    ],
  },
});

describe("finding the game in the feed", () => {
  it("matches by both teams' nicknames (the feed says 'LA Clippers', the odds say 'Los Angeles Clippers')", () => {
    expect(findEspnGame(scoreboard, { home_team: "Detroit Pistons", away_team: "Philadelphia 76ers" })).toBe("401909922");
    expect(findEspnGame(scoreboard, { home_team: "Los Angeles Clippers", away_team: "Miami Heat" })).toBe("401909935");
  });
  it("no match: null, never a guess", () => {
    expect(findEspnGame(scoreboard, { home_team: "Boston Celtics", away_team: "Miami Heat" })).toBeNull();
    expect(findEspnGame({}, { home_team: "Detroit Pistons", away_team: "Philadelphia 76ers" })).toBeNull();
  });
  it("asks for the game's US Eastern date (a 7:30 PM ET tip is 00:30 UTC the next day)", () => {
    expect(espnDate("2026-11-05T00:30:00Z")).toBe("20261104");
    expect(espnScoreboardUrl("2026-11-05T00:30:00Z")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261104",
    );
    expect(espnSummaryUrl("401909922")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909922",
    );
  });
});

describe("box score → stats", () => {
  it("points, rebounds, assists and threes for everyone who played, keyed to our prop markets", () => {
    const { final, stats } = espnBoxToStats(summary("in"));
    expect(final).toBe(false);
    expect(stats).toContainEqual({ name: "Joel Embiid", team: "Philadelphia 76ers", market_key: "player_points", stat: 8 });
    expect(stats).toContainEqual({ name: "Joel Embiid", team: "Philadelphia 76ers", market_key: "player_rebounds", stat: 5 });
    expect(stats).toContainEqual({ name: "Joel Embiid", team: "Philadelphia 76ers", market_key: "player_assists", stat: 1 });
    expect(stats).toContainEqual({ name: "Kelly Oubre Jr.", team: "Philadelphia 76ers", market_key: "player_threes", stat: 2 });
    expect(stats).toContainEqual({ name: "Cade Cunningham", team: "Detroit Pistons", market_key: "player_assists", stat: 6 });
    expect(stats.filter((s) => s.name === "Bench Guy")).toEqual([]);
    expect(stats).toHaveLength(12);
  });
  it("knows when the game is over", () => {
    expect(espnBoxToStats(summary("post")).final).toBe(true);
  });
  it("an empty or odd reply gives no stats instead of throwing", () => {
    expect(espnBoxToStats({})).toEqual({ final: false, stats: [] });
    expect(espnBoxToStats(null)).toEqual({ final: false, stats: [] });
  });
});

describe("fake box score (local dev, no network)", () => {
  it("grows from zero at tip-off, is deterministic, and finishes after the game", () => {
    const tip = Date.parse("2026-11-05T00:00:00Z");
    const players = [{ name: "Ripley Stone", market_key: "player_points" }];
    expect(fakeBoxStats(players, tip, tip).stats[0]!.stat).toBe(0);
    const mid = fakeBoxStats(players, tip, tip + 60 * 60_000);
    expect(mid.final).toBe(false);
    expect(mid.stats[0]!.stat).toBeGreaterThan(0);
    expect(fakeBoxStats(players, tip, tip + 60 * 60_000)).toEqual(mid);
    const end = fakeBoxStats(players, tip, tip + 4 * 3_600_000);
    expect(end.final).toBe(true);
    expect(end.stats[0]!.stat).toBeGreaterThanOrEqual(mid.stats[0]!.stat);
  });
});
