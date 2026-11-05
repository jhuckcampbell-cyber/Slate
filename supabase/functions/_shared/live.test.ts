import { describe, expect, it } from "vitest";
import { espnLiveUrl, fakeLiveGames, liveGamesFromScoreboard } from "./live.ts";

// Shapes from ESPN's public scoreboards (site.api.espn.com/apis/site/v2/sports/{basketball/nba|football/nfl}/scoreboard).
const competition = (o: {
  home: [string, string];
  away: [string, string];
  state: "pre" | "in" | "post";
  period?: number;
  shortDetail: string;
  situation?: unknown;
}) => ({
  competitions: [
    {
      status: { period: o.period ?? 0, type: { state: o.state, shortDetail: o.shortDetail } },
      situation: o.situation,
      competitors: [
        { homeAway: "home", score: o.home[1], team: { displayName: o.home[0] } },
        { homeAway: "away", score: o.away[1], team: { displayName: o.away[0] } },
      ],
    },
  ],
});

const nfl = {
  events: [
    competition({
      home: ["Baltimore Ravens", "17"],
      away: ["Jacksonville Jaguars", "10"],
      state: "in",
      period: 3,
      shortDetail: "8:21 - 3rd",
      situation: {
        downDistanceText: "2nd & 7 at JAX 34",
        lastPlay: { text: "Derrick Henry rush up the middle for 12 yards" },
      },
    }),
  ],
};

const nba = {
  events: [
    competition({ home: ["LA Clippers", "54"], away: ["Miami Heat", "61"], state: "in", period: 2, shortDetail: "Halftime" }),
    competition({ home: ["Detroit Pistons", "106"], away: ["Philadelphia 76ers", "112"], state: "post", period: 4, shortDetail: "Final" }),
  ],
};

describe("live games from the scoreboard", () => {
  it("score, clock and the last play for each of our games", () => {
    expect(
      liveGamesFromScoreboard(nfl, [{ event_id: "tnf", home_team: "Baltimore Ravens", away_team: "Jacksonville Jaguars" }]),
    ).toEqual([
      {
        event_id: "tnf",
        state: "in",
        home_score: 17,
        away_score: 10,
        period: 3,
        detail: "8:21 - 3rd",
        situation: "2nd & 7 at JAX 34",
        last_play: "Derrick Henry rush up the middle for 12 yards",
      },
    ]);
  });
  it("matches team names across spellings, skips games that aren't ours", () => {
    const games = liveGamesFromScoreboard(nba, [
      { event_id: "a", home_team: "Los Angeles Clippers", away_team: "Miami Heat" },
      { event_id: "b", home_team: "Detroit Pistons", away_team: "Philadelphia 76ers" },
      { event_id: "c", home_team: "Boston Celtics", away_team: "New York Knicks" },
    ]);
    expect(games.map((g) => [g.event_id, g.state, g.home_score, g.away_score, g.detail, g.last_play])).toEqual([
      ["a", "in", 54, 61, "Halftime", null],
      ["b", "post", 106, 112, "Final", null],
    ]);
  });
  it("an odd reply gives nothing instead of throwing", () => {
    expect(liveGamesFromScoreboard(null, [{ event_id: "a", home_team: "X", away_team: "Y" }])).toEqual([]);
  });
});

describe("espnLiveUrl", () => {
  it("NBA and NFL by the game's US Eastern date; other sports aren't covered", () => {
    expect(espnLiveUrl("americanfootball_nfl", "2026-11-06T01:15:00Z")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261105",
    );
    expect(espnLiveUrl("basketball_nba", "2026-11-05T00:30:00Z")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261104",
    );
    expect(espnLiveUrl("icehockey_nhl", "2026-11-05T00:30:00Z")).toBeNull();
  });
});

describe("fake live feed (local dev)", () => {
  it("clock and score follow the game's progress; over after the game", () => {
    const tip = Date.parse("2026-11-05T00:00:00Z");
    const ev = { event_id: "e1", home_team: "Rockets", away_team: "Comets", commence_time: "2026-11-05T00:00:00Z" };
    const mid = fakeLiveGames([ev], "basketball_nba", tip + 75 * 60_000)[0]!;
    expect(mid.state).toBe("in");
    expect(mid.period).toBe(3);
    expect(mid.detail).toMatch(/^\d+:\d\d - 3rd$/);
    expect(mid.last_play).toBeTruthy();
    expect(mid.home_score! + mid.away_score!).toBeGreaterThan(0);
    expect(fakeLiveGames([ev], "basketball_nba", tip + 75 * 60_000)).toEqual([mid]);
    expect(fakeLiveGames([ev], "basketball_nba", tip + 4 * 3_600_000)[0]!.state).toBe("post");
    expect(fakeLiveGames([ev], "basketball_nba", tip - 60_000)[0]!.state).toBe("pre");
  });
});
