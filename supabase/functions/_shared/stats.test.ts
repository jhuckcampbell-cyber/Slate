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
    expect(stats.filter((s) => s.name === "Bench Guy")).toEqual([
      { name: "Bench Guy", team: "Philadelphia 76ers", market_key: "__participation", stat: null, did_not_play: true },
    ]);
    expect(stats.filter((s) => s.market_key !== "__participation")).toHaveLength(12);
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
    expect(end.stats[0]!.stat).toBeGreaterThanOrEqual(mid.stats[0]!.stat!);
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


describe("participation evidence", () => {
  it("retains DNP at the final without inventing numeric zeroes", () => {
    const box = espnBoxToStats(summary("post"));
    expect(box.stats).toContainEqual({ name: "Bench Guy", team: "Philadelphia 76ers",
      market_key: "__participation", stat: null, did_not_play: true });
    expect(box.stats.filter((s) => s.name === "Bench Guy" && s.stat !== null)).toEqual([]);
  });
  it("keeps missing stat cells absent, while preserving a real zero", () => {
    const box = espnBoxToStats({ boxscore: { players: [{ statistics: [{ keys: ["points", "assists", "rebounds"],
      athletes: [{ athlete: { displayName: "Player" }, stats: ["--", "", "0"] }] }] }] } });
    expect(box.stats.filter((s) => s.market_key !== "__participation")).toEqual([
      { name: "Player", team: null, market_key: "player_rebounds", stat: 0 },
    ]);
  });
  it("participation in any group takes precedence over a DNP marker in another", () => {
    const box = espnBoxToStats({ boxscore: { players: [{ statistics: [
      { keys: ["points"], athletes: [{ athlete: { displayName: "Player" }, stats: ["0"] }] },
      { keys: [], athletes: [{ athlete: { displayName: "Player" }, didNotPlay: true }] },
    ] }] } });
    expect(box.stats.find((s) => s.market_key === "__participation")?.did_not_play).toBe(false);
  });
});


describe("verified automatic grading evidence", () => {
  it("preserves provider player identity and marks only final numeric rows complete", () => {
    const input = summary("post");
    Object.assign(input.boxscore.players[0]!.statistics[0]!.athletes[0]!.athlete, { id: "203954" });
    expect(espnBoxToStats(input).stats.find((r) => r.name === "Joel Embiid" && r.market_key === "player_points"))
      .toMatchObject({ provider_player_id: "203954", complete: true, stat: 8 });
    const live = summary("in");
    Object.assign(live.boxscore.players[0]!.statistics[0]!.athletes[0]!.athlete, { id: "203954" });
    expect(espnBoxToStats(live).stats.find((r) => r.market_key === "player_points"))
      .toMatchObject({ complete: false });
  });
  const swiftTd = (input: ReturnType<typeof nflSummary>) => {
    Object.assign(input.boxscore.players[0]!.statistics[1]!.athletes[0]!.athlete, { id: "swift" });
    Object.assign(input.boxscore.players[0]!.statistics[2]!.athletes[1]!.athlete, { id: "swift" });
    return espnBoxToStats(input, "americanfootball_nfl").stats.find((r) => r.provider_player_id === "swift" && r.market_key === "player_anytime_td");
  };
  it("certifies a final touchdown sum when the player had no returns (ESPN omits him from those tables)", () => {
    // Swift is in rushing + receiving only; there is no kickReturns table at all.
    expect(swiftTd(nflSummary("post"))).toMatchObject({ stat: 3, complete: true });
  });
  it("does not certify a touchdown sum before the final", () => {
    expect(swiftTd(nflSummary("in"))).toMatchObject({ stat: 3, complete: false });
  });
  it("does not certify a touchdown sum with an unreadable touchdown cell", () => {
    const input = nflSummary("post");
    input.boxscore.players[0]!.statistics[2]!.athletes[1]!.stats![3] = "--";
    expect(swiftTd(input)).toMatchObject({ stat: 3, complete: false });
  });
  it("does not certify a touchdown sum when the team's receiving table is missing", () => {
    const input = nflSummary("post");
    input.boxscore.players[0]!.statistics[2]!.name = "unknown";
    expect(swiftTd(input)).toMatchObject({ stat: 3, complete: false });
  });
  it("rejects malformed numeric cells instead of parsing a prefix", () => {
    const input = summary("post");
    input.boxscore.players[0]!.statistics[0]!.athletes[0]!.stats![1] = "8 pending";
    expect(espnBoxToStats(input).stats.some((r) => r.name === "Joel Embiid" && r.market_key === "player_points")).toBe(false);
  });
});


it("keeps same-name provider athletes separate", () => {
  const box = espnBoxToStats({
    header: { competitions: [{ status: { type: { completed: true } } }] },
    boxscore: { players: [{ statistics: [{ keys: ["points"], athletes: [
      { athlete: { id: "one", displayName: "Same Name" }, stats: ["3"] },
      { athlete: { id: "two", displayName: "Same Name" }, stats: ["7"] },
    ] }] }] },
  });
  expect(box.stats.filter((r) => r.market_key === "player_points")).toEqual([
    { name: "Same Name", team: null, provider_player_id: "one", market_key: "player_points", stat: 3, complete: true },
    { name: "Same Name", team: null, provider_player_id: "two", market_key: "player_points", stat: 7, complete: true },
  ]);
});


it("certifies a touchdown sum only after all explicit component rows arrive", () => {
  const components = [
    ["rushing", "rushingTouchdowns", "1"],
    ["receiving", "receivingTouchdowns", "0"],
    ["kickReturns", "kickReturnTouchdowns", "0"],
    ["puntReturns", "puntReturnTouchdowns", "0"],
  ];
  const box = espnBoxToStats({
    header: { competitions: [{ status: { type: { completed: true } } }] },
    boxscore: { players: [{ statistics: components.map(([name, key, value]) => ({
      name, keys: [key], athletes: [{ athlete: { id: "td", displayName: "Runner" }, stats: [value] }],
    })) }] },
  }, "americanfootball_nfl");
  expect(box.stats.find((r) => r.market_key === "player_anytime_td"))
    .toMatchObject({ stat: 1, complete: true, provider_player_id: "td" });
});

it("college football grades the main stats only, with anytime TD = rushing + receiving + return", () => {
  const box = espnBoxToStats(nflSummary("post"), "americanfootball_ncaaf");
  const markets = new Set(box.stats.map((r) => r.market_key).filter((m) => m !== "__participation"));
  expect([...markets].sort()).toEqual(["player_anytime_td", "player_pass_yds", "player_reception_yds", "player_rush_yds"]);
  expect(box).toMatchObject({ final: true, remaining: 0 });
  expect(espnScoreboardUrl("americanfootball_ncaaf", "2026-11-02T01:20:00Z")).toBe(
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261101",
  );
  expect(gameRemaining({ state: "in", period: 2, displayClock: "15:00" }, "americanfootball_ncaaf")).toBe(0.75);
});

it("college basketball box scores stay unsupported", () => {
  expect(espnBoxToStats({ header: { competitions: [{ status: { type: { completed: true } } }] } }, "basketball_ncaab")).toEqual({ final: false, stats: [], remaining: null });
});

it("matches school identity and refuses ambiguous college games", () => {
  const event = (id: string, home: string, away: string) => ({ id, competitions: [{ competitors: [
    { homeAway: "home", team: { id: `${id}-h`, displayName: home } },
    { homeAway: "away", team: { id: `${id}-a`, displayName: away } },
  ] }] });
  const wrong = event("wrong", "LSU Tigers", "Fresno State Bulldogs");
  const right = event("right", "Clemson Tigers", "Georgia Bulldogs");
  const game = { home_team: "Clemson Tigers", away_team: "Georgia Bulldogs" };
  expect(findEspnGame({ events: [wrong, right] }, game)).toEqual("right");
  expect(findEspnGame({ events: [wrong] }, game)).toBeNull();
  expect(findEspnGame({ events: [right, right] }, game)).toBeNull();
  expect(findEspnGame({ events: [wrong, right] }, { home_team: "Tigers", away_team: "Bulldogs" })).toBeNull();
});
