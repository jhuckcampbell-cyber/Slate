import { describe, expect, it } from "vitest";
import { pickTeam, teamLook } from "./team-colors";

describe("teamLook: a team's colors and gear for its badge", () => {
  it("NFL teams get a helmet in their colors", () => {
    expect(teamLook("Baltimore Ravens")).toEqual({ kind: "helmet", primary: "#241773", secondary: "#9E7C0C" });
    expect(teamLook("Jacksonville Jaguars")).toEqual({ kind: "helmet", primary: "#006778", secondary: "#D7A22A" });
  });
  it("NBA teams get a jersey", () => {
    expect(teamLook("Boston Celtics")).toEqual({ kind: "jersey", primary: "#007A33", secondary: "#BA9653" });
    expect(teamLook("Los Angeles Lakers").kind).toBe("jersey");
  });
  it("all 62 teams are covered", async () => {
    const { TEAM_COLORS } = await import("./team-colors");
    expect(Object.keys(TEAM_COLORS)).toHaveLength(62);
  });
  it("an unknown team still gets a steady color (same team, same color), gear from the sport", () => {
    const a = teamLook("Mocktown Rockets", "basketball_nba");
    expect(a.kind).toBe("jersey");
    expect(a).toEqual(teamLook("Mocktown Rockets", "basketball_nba"));
    expect(teamLook("Testville Comets", "americanfootball_nfl").kind).toBe("helmet");
    expect(teamLook("Testville Comets").primary).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("pickTeam: whose badge goes next to a pick", () => {
  it("a player's team, or the team picked; totals have none", () => {
    expect(pickTeam({ marketKey: "player_rush_yds", outcomeName: "Over", participantTeam: "Baltimore Ravens" })).toBe("Baltimore Ravens");
    expect(pickTeam({ marketKey: "player_rush_yds", outcomeName: "Over", participantTeam: null })).toBeNull();
    expect(pickTeam({ marketKey: "h2h", outcomeName: "Boston Celtics" })).toBe("Boston Celtics");
    expect(pickTeam({ marketKey: "spreads", outcomeName: "New York Knicks" })).toBe("New York Knicks");
    expect(pickTeam({ marketKey: "totals", outcomeName: "Over" })).toBeNull();
  });
});
