import { describe, expect, it } from "vitest";
import { NFL_TEAMS, sleeperToRoster } from "./rosters.ts";

// Shape from Sleeper's docs (GET /v1/players/nfl): an object keyed by player_id.
const sample = {
  "4199": { player_id: "4199", first_name: "Derrick", last_name: "Henry", team: "BAL", position: "RB", status: "Active" },
  "4984": { player_id: "4984", first_name: "Trevor", last_name: "Lawrence", team: "JAX", position: "QB", status: "Active" },
  "9001": { player_id: "9001", first_name: "Chris", last_name: "Rodriguez Jr.", team: "WAS", position: "RB", status: "Active" },
  "9002": { player_id: "9002", first_name: "Free", last_name: "Agent", team: null, position: "WR", status: "Active" },
  BAL: { player_id: "BAL", first_name: "Baltimore", last_name: "Ravens", team: "BAL", position: "DEF", status: "Active" },
  "9003": { player_id: "9003", first_name: "Old", last_name: "Team", team: "OAK", position: "WR", status: "Active" },
};

describe("sleeperToRoster", () => {
  it("maps players to the Odds API's full team names, skipping free agents, defenses and unknown teams", () => {
    expect(sleeperToRoster(sample)).toEqual([
      { name: "Derrick Henry", team: "Baltimore Ravens" },
      { name: "Trevor Lawrence", team: "Jacksonville Jaguars" },
      { name: "Chris Rodriguez Jr.", team: "Washington Commanders" },
    ]);
  });

  it("tolerates junk without throwing", () => {
    expect(sleeperToRoster(null)).toEqual([]);
    expect(sleeperToRoster({ x: { first_name: "No" } })).toEqual([]);
  });

  it("knows all 32 teams", () => {
    expect(new Set(Object.values(NFL_TEAMS)).size).toBe(32);
  });
});

import { espnGameTeamIds, espnRosterToPlayers } from "./rosters.ts";

describe("college rosters (ESPN)", () => {
  const scoreboard = { events: [{ competitions: [{ competitors: [
    { homeAway: "home", team: { id: "333", displayName: "Alabama Crimson Tide" } },
    { homeAway: "away", team: { id: "2", displayName: "Auburn Tigers" } },
  ] }] }] };
  it("finds both team ids by school identity", () => {
    expect(espnGameTeamIds(scoreboard, { home_team: "Alabama Crimson Tide", away_team: "Auburn Tigers" })).toEqual({ home: "333", away: "2" });
    expect(espnGameTeamIds(scoreboard, { home_team: "Texas Longhorns", away_team: "Auburn Tigers" })).toBeNull();
  });
  it("reads grouped and flat rosters, labelled with our team name", () => {
    expect(espnRosterToPlayers({ athletes: [{ position: "offense", items: [{ displayName: "A One" }, { fullName: "B Two" }] }] }, "Alabama Crimson Tide"))
      .toEqual([{ name: "A One", team: "Alabama Crimson Tide" }, { name: "B Two", team: "Alabama Crimson Tide" }]);
    expect(espnRosterToPlayers({ athletes: [{ displayName: "C Three" }] }, "T")).toEqual([{ name: "C Three", team: "T" }]);
    expect(espnRosterToPlayers(null, "T")).toEqual([]);
  });
});

it("matches school identity and refuses ambiguous college games", () => {
  const event = (id: string, home: string, away: string) => ({ id, competitions: [{ competitors: [
    { homeAway: "home", team: { id: `${id}-h`, displayName: home } },
    { homeAway: "away", team: { id: `${id}-a`, displayName: away } },
  ] }] });
  const wrong = event("wrong", "LSU Tigers", "Fresno State Bulldogs");
  const right = event("right", "Clemson Tigers", "Georgia Bulldogs");
  const game = { home_team: "Clemson Tigers", away_team: "Georgia Bulldogs" };
  expect(espnGameTeamIds({ events: [wrong, right] }, game)).toEqual({ home: "right-h", away: "right-a" });
  expect(espnGameTeamIds({ events: [wrong] }, game)).toBeNull();
  expect(espnGameTeamIds({ events: [right, right] }, game)).toBeNull();
  expect(espnGameTeamIds({ events: [wrong, right] }, { home_team: "Tigers", away_team: "Bulldogs" })).toBeNull();
});
