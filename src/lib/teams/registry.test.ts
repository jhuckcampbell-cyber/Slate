import { describe, expect, it } from "vitest";
import { lookupTeam, normalizeTeamName, SPORT_LEAGUES, TEAMS } from "./registry";
import { markColors, NEUTRAL_LOOK, teamLook } from "../team-colors";
import { getTeam } from "../team";
import { shortTeam } from "../format";

describe("team registry", () => {
  it("has complete pro and Power 4 coverage, valid hex and unique names", () => {
    for (const [league, count] of Object.entries({ NFL: 32, NBA: 30, NHL: 32, MLB: 30, NCAAF: 68, NCAAB: 68 })) {
      const teams = TEAMS.filter(t => t.league === league);
      expect(teams).toHaveLength(count);
      expect(new Set(teams.map(t => t.abbr)).size).toBe(count);
      expect(new Set(teams.map(t => normalizeTeamName(t.name))).size).toBe(count);
    }
    for (const t of TEAMS) {
      expect(t.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.secondary).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("resolves every full name, alias and abbreviation within its sport", () => {
    for (const t of TEAMS) {
      const sport = Object.keys(SPORT_LEAGUES).find(k => SPORT_LEAGUES[k] === t.league)!;
      for (const name of [t.name, ...t.aliases, t.abbr]) expect(lookupTeam(name, sport)).toBe(t);
    }
    expect(lookupTeam("  L.A. CLIPPERS  ", "basketball_nba")?.name).toBe("Los Angeles Clippers");
    expect(getTeam("LA Clippers").abbr).toBe("LAC");
    expect(shortTeam("Toronto Maple Leafs")).toBe("Maple Leafs");
  });
  it("covers each conference and uses pennants for both college sports", () => {
    for (const [sport, counts] of Object.entries({ americanfootball_ncaaf: { SEC: 16, "Big Ten": 18, "Big 12": 16, ACC: 17, Independent: 1 }, basketball_ncaab: { SEC: 16, "Big Ten": 18, "Big 12": 16, ACC: 18, Independent: 0 } })) {
      for (const [conference, count] of Object.entries(counts)) expect(TEAMS.filter(t => t.league === SPORT_LEAGUES[sport] && t.conference === conference)).toHaveLength(count);
      for (const t of TEAMS.filter(t => t.league === SPORT_LEAGUES[sport])) {
        expect(t.abbr).toMatch(/^[A-Z]{3,4}$/);
        expect(teamLook(t.name, sport).kind).toBe("pennant");
      }
    }
  });
  it("scopes ATL and refuses ambiguous or wrong-league matches", () => {
    expect(lookupTeam("ATL", "americanfootball_nfl")?.name).toBe("Atlanta Falcons");
    expect(lookupTeam("ATL", "basketball_nba")?.name).toBe("Atlanta Hawks");
    expect(lookupTeam("ATL")).toBeUndefined();
    expect(teamLook("Atlanta Falcons", "basketball_nba")).toEqual(NEUTRAL_LOOK);
    expect(teamLook("Atlanta Falcons", "unknown")).toEqual(NEUTRAL_LOOK);
  });
  it("uses a neutral shield for every unknown, including college", () => {
    for (const sport of Object.keys(SPORT_LEAGUES)) expect(teamLook("Unknown Team", sport)).toEqual(NEUTRAL_LOOK);
    expect(teamLook("Boston Celtics", "basketball_ncaab")).toEqual(NEUTRAL_LOOK);
    expect(teamLook("Boston Bruins", "icehockey_nhl").kind).toBe("sweater");
    expect(teamLook("Boston Red Sox", "baseball_mlb").kind).toBe("cap");
  });
  it("swaps light primary fills and uses ink for nearly identical trim", () => {
    expect(markColors({ primary: "#FFFFFF", secondary: "#003087" })).toEqual({ fill: "#003087", trim: "#FFFFFF" });
    expect(markColors({ primary: "#111111", secondary: "#181818" })).toEqual({ fill: "#111111", trim: "#181a21" });
    expect(markColors({ primary: "#003087", secondary: "#FFFFFF" })).toEqual({ fill: "#003087", trim: "#FFFFFF" });
  });
});
