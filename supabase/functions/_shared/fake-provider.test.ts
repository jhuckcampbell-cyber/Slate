import { describe, expect, it } from "vitest";
import { COLLEGE_TEAMS, fakeCatalog, fakeOddsResponse, fakeRoster } from "./fake-provider.ts";

const ev = {
  id: "fake-tnf",
  sport_key: "americanfootball_nfl",
  sport_title: "NFL",
  home_team: "Baltimore Ravens",
  away_team: "Jacksonville Jaguars",
  commence_time: "2026-11-06T01:15:00Z",
};
const NFL_PROPS = ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_receptions", "player_pass_tds", "player_anytime_td"];

function playersFor(market: string) {
  const book = fakeOddsResponse([ev], [market], { nowMs: Date.parse("2026-11-05T12:00:00Z") })[0]!.bookmakers![0]!;
  return new Set(book.markets.flatMap((m) => m.outcomes.map((o) => o.description!)));
}

describe("fake props look like a real game (local dev)", () => {
  it("quarterbacks pass, other players don't", () => {
    const passers = playersFor("player_pass_yds");
    expect(passers.size).toBe(2); // one per team
    for (const qb of passers) {
      expect(playersFor("player_reception_yds").has(qb)).toBe(false);
      expect(playersFor("player_rush_yds").has(qb)).toBe(false);
    }
    expect([...playersFor("player_pass_tds")].sort()).toEqual([...passers].sort());
  });
  it("receptions go to the pass catchers, never the quarterback", () => {
    const catchers = playersFor("player_receptions");
    expect(catchers.size).toBeGreaterThan(2);
    for (const qb of playersFor("player_pass_yds")) expect(catchers.has(qb)).toBe(false);
    expect([...catchers].sort()).toEqual([...playersFor("player_reception_yds")].sort());
  });
  it("every prop player is on a team's roster, so the board can say who plays for whom", () => {
    const roster = new Map(fakeRoster([ev.away_team, ev.home_team]).map((p) => [p.name, p.team]));
    for (const m of NFL_PROPS) {
      for (const player of playersFor(m)) expect(roster.get(player), `${m}: ${player}`).toMatch(/Ravens|Jaguars/);
    }
  });
  it("one name per team and slot (no player on both teams)", () => {
    const roster = fakeRoster([ev.away_team, ev.home_team]);
    expect(new Set(roster.map((p) => p.name)).size).toBe(roster.length);
  });
});

describe("fake names are unique across the league", () => {
  it("no two real teams share a fake player, whoever they play", async () => {
    const { NFL_TEAMS } = await import("./rosters.ts");
    const teams = Object.values(NFL_TEAMS);
    const names = teams.flatMap((t) => fakeRoster([t]).map((p) => p.name));
    expect(new Set(names).size).toBe(names.length);
    // Same team, same names, whatever the matchup.
    const a = fakeRoster(["Jacksonville Jaguars", "Baltimore Ravens"]).filter((p) => p.team === "Baltimore Ravens");
    const b = fakeRoster(["Cincinnati Bengals", "Baltimore Ravens"]).filter((p) => p.team === "Baltimore Ravens");
    expect(a).toEqual(b);
  });
});


describe("college fake pipeline", () => {
  it.each(["americanfootball_ncaaf", "basketball_ncaab"])("catalog, game lines and scores for %s", async (key) => {
    const { normalizeOddsResponse } = await import("./normalize.ts");
    const { fakeScoresResponse, normalizeScores } = await import("./scores.ts");
    const { fakeLiveGames } = await import("./live.ts");
    const now = Date.parse("2026-11-10T12:00:00Z");
    const catalog = fakeCatalog(key, now);
    expect(catalog).toHaveLength(6);
    expect(new Set(catalog.flatMap(e => [e.home_team, e.away_team])).size).toBe(12);
    expect(COLLEGE_TEAMS[key]).toContain(catalog[0]!.home_team);
    expect(normalizeOddsResponse(catalog, { markets: [], bookmakers: [] }).events).toHaveLength(6);
    const markets = ["h2h", "spreads", "totals"];
    const odds = fakeOddsResponse(catalog, [...markets, "player_points"], { nowMs: now });
    expect(odds[0]!.bookmakers![0]!.markets.map(m => m.key)).toEqual(markets);
    const normalized = normalizeOddsResponse(odds, { markets, bookmakers: [] });
    expect(normalized.outcomes).toHaveLength(36);
    expect(normalized.skippedMarkets).toBe(0);
    expect(normalized.outcomes.every(o => o.participant_name === "")).toBe(true);
    const event = catalog[0]!;
    const start = Date.parse(event.commence_time);
    expect(normalizeScores(fakeScoresResponse([event], { nowMs: start - 1 }))).toEqual([]);
    const mid = start + (key === "basketball_ncaab" ? 65 : 105) * 60_000;
    expect(normalizeScores(fakeScoresResponse([event], { nowMs: mid }))[0]).toMatchObject({ completed: false });
    expect(fakeLiveGames([{ ...event, event_id: event.id }], key, mid)[0]!.state).toBe("in");
    const final = normalizeScores(fakeScoresResponse([event], { nowMs: start + 4 * 3_600_000 }))[0]!;
    expect(final.completed).toBe(true);
    expect(final.home_score).not.toBe(final.away_score);
    expect(final.home_score).toBeGreaterThan(key === "basketball_ncaab" ? 50 : 10);
  });
});
