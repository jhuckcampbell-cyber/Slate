import { describe, expect, it } from "vitest";
import { espnBoxToStats, espnDate, gameRemaining, espnScoreboardUrl, espnSummaryUrl, fakeBoxStats, findEspnGame } from "./stats.ts";

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

const summary = (state: "in" | "post", period = 2, displayClock = "8:21") => ({
  header: { competitions: [{ status: { period, displayClock, type: { state, completed: state === "post" } } }] },
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
    expect(espnScoreboardUrl("basketball_nba", "2026-11-05T00:30:00Z")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261104",
    );
    expect(espnSummaryUrl("basketball_nba", "401909922")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909922",
    );
  });
});

describe("box score → stats", () => {
  it("points, rebounds, assists and threes for everyone who played, keyed to our prop markets", () => {
    const { final, stats, remaining } = espnBoxToStats(summary("in"));
    expect(final).toBe(false);
    expect(remaining).toBeCloseTo((8 * 60 + 21 + 2 * 720) / 2880, 4);
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
    expect(espnBoxToStats({})).toEqual({ final: false, stats: [], remaining: null });
    expect(espnBoxToStats(null)).toEqual({ final: false, stats: [], remaining: null });
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

describe("gameRemaining: share of an NBA game left (4 × 12 min)", () => {
  it("from the period and clock", () => {
    expect(gameRemaining({ state: "pre", period: 0, displayClock: "0:00" })).toBe(1);
    expect(gameRemaining({ state: "in", period: 1, displayClock: "12:00" })).toBe(1);
    expect(gameRemaining({ state: "in", period: 3, displayClock: "6:00" })).toBeCloseTo(0.375, 4);
    expect(gameRemaining({ state: "in", period: 4, displayClock: "0:30.4" })).toBeCloseTo(30.4 / 2880, 4);
  });
  it("under a minute the feed drops the minutes (\"45.3\", \"0.0\")", () => {
    expect(gameRemaining({ state: "in", period: 4, displayClock: "45.3" })).toBeCloseTo(45.3 / 2880, 4);
    expect(gameRemaining({ state: "in", period: 2, displayClock: "0.0" })).toBeCloseTo(1440 / 2880, 4);
  });
  it("overtime: just the overtime clock (5 min)", () => {
    expect(gameRemaining({ state: "in", period: 5, displayClock: "2:30" })).toBeCloseTo(150 / 2880, 4);
  });
  it("over: nothing left; unknown: null", () => {
    expect(gameRemaining({ state: "post", period: 4, displayClock: "0:00" })).toBe(0);
    expect(gameRemaining({ state: "in", period: 2, displayClock: "soon" })).toBeNull();
    expect(gameRemaining({})).toBeNull();
  });
});

// Shapes from ESPN's public NFL feed (football/nfl/summary, Bears at Seahawks 2026-11-02), trimmed.
const nflSummary = (state: "in" | "post", period = 3, displayClock = "7:30") => ({
  header: { competitions: [{ status: { period, displayClock, type: { state, completed: state === "post" } } }] },
  boxscore: {
    players: [
      {
        team: { displayName: "Chicago Bears" },
        statistics: [
          {
            name: "passing",
            keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns", "interceptions",
              "sacks-sackYardsLost", "adjQBR", "QBRating"],
            athletes: [{ athlete: { displayName: "Caleb Williams" }, stats: ["24/34", "247", "7.3", "1", "0", "1-10", "68.1", "101.0"] }],
          },
          {
            name: "rushing",
            keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"],
            athletes: [
              { athlete: { displayName: "D'Andre Swift" }, stats: ["27", "69", "2.6", "3", "7"] },
              { athlete: { displayName: "Caleb Williams" }, stats: ["3", "-4", "-1.3", "0", "2"] },
              { athlete: { displayName: "Rome Odunze" }, stats: ["1", "6", "6.0", "0", "6"] },
            ],
          },
          {
            name: "receiving",
            keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception", "receivingTargets"],
            athletes: [
              { athlete: { displayName: "Rome Odunze" }, stats: ["4", "87", "21.8", "1", "24", "6"] },
              { athlete: { displayName: "D'Andre Swift" }, stats: ["2", "11", "5.5", "0", "8", "2"] },
            ],
          },
          {
            name: "interceptions",
            keys: ["interceptions", "interceptionYards", "interceptionTouchdowns"],
            athletes: [{ athlete: { displayName: "James Lynch" }, stats: ["1", "16", "0"] }],
          },
          {
            name: "puntReturns",
            keys: ["puntReturns", "puntReturnYards", "yardsPerPuntReturn", "longPuntReturn", "puntReturnTouchdowns"],
            athletes: [{ athlete: { displayName: "Rome Odunze" }, stats: ["1", "70", "70.0", "70", "1"] }],
          },
        ],
      },
    ],
  },
});

describe("football box score → stats", () => {
  const stat = (box: ReturnType<typeof espnBoxToStats>, name: string, market: string) =>
    box.stats.find((s) => s.name === name && s.market_key === market)?.stat;

  it("passing, rushing and receiving yards, receptions and passing TDs", () => {
    const box = espnBoxToStats(nflSummary("in"), "americanfootball_nfl");
    expect(stat(box, "Caleb Williams", "player_pass_yds")).toBe(247);
    expect(stat(box, "Caleb Williams", "player_pass_tds")).toBe(1);
    expect(stat(box, "D'Andre Swift", "player_rush_yds")).toBe(69);
    expect(stat(box, "Rome Odunze", "player_reception_yds")).toBe(87);
    expect(stat(box, "Rome Odunze", "player_receptions")).toBe(4);
    expect(stat(box, "D'Andre Swift", "player_receptions")).toBe(2);
  });
  it("a QB's lost yards on the ground stay negative (not 0)", () => {
    expect(stat(espnBoxToStats(nflSummary("in"), "americanfootball_nfl"), "Caleb Williams", "player_rush_yds")).toBe(-4);
  });
  it("anytime TD adds rushing, receiving and return touchdowns, never passing ones", () => {
    const box = espnBoxToStats(nflSummary("in"), "americanfootball_nfl");
    expect(stat(box, "D'Andre Swift", "player_anytime_td")).toBe(3);
    expect(stat(box, "Rome Odunze", "player_anytime_td")).toBe(2); // 1 receiving + 1 punt return
    expect(stat(box, "Caleb Williams", "player_anytime_td")).toBe(0);
    expect(stat(box, "James Lynch", "player_anytime_td")).toBeUndefined(); // a defensive "interceptions" column isn't a prop
  });
  it("uses the football clock (4 × 15 min)", () => {
    expect(espnBoxToStats(nflSummary("in"), "americanfootball_nfl").remaining).toBeCloseTo((7.5 * 60 + 900) / 3600, 4);
    expect(gameRemaining({ state: "in", period: 2, displayClock: "15:00" }, "americanfootball_nfl")).toBe(0.75);
    expect(gameRemaining({ state: "in", period: 5, displayClock: "10:00" }, "americanfootball_nfl")).toBeCloseTo(600 / 3600, 4);
    expect(espnBoxToStats(nflSummary("post"), "americanfootball_nfl")).toMatchObject({ final: true, remaining: 0 });
  });
  it("asks the football feed", () => {
    expect(espnScoreboardUrl("americanfootball_nfl", "2026-11-02T01:20:00Z")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261101",
    );
    expect(espnSummaryUrl("americanfootball_nfl", "401873036")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873036",
    );
  });
  it("fake box scores give football-sized numbers locally", () => {
    const tip = Date.parse("2026-11-05T00:00:00Z");
    const end = fakeBoxStats([{ name: "Ripley Stone", market_key: "player_pass_yds" }], tip, tip + 4 * 3_600_000);
    expect(end.stats[0]!.stat).toBeGreaterThan(20);
  });
});
