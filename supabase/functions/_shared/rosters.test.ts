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
