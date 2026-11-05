import { describe, expect, it } from "vitest";
import { fakeOddsResponse, fakeRoster } from "./fake-provider.ts";

const ev = {
  id: "fake-tnf",
  sport_key: "americanfootball_nfl",
  sport_title: "NFL",
  home_team: "Baltimore Ravens",
  away_team: "Jacksonville Jaguars",
  commence_time: "2026-11-06T01:15:00Z",
};
const NFL_PROPS = ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_pass_tds", "player_anytime_td"];

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
