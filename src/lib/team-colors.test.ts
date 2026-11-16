import { describe, expect, it } from "vitest";
import { contrastOnWhite, helmetMaskColor, MASK_TAN, pickTeam, readableTeamColor, teamLook } from "./team-colors";

describe("helmetMaskColor: facemask in the team's second color, tan when it would vanish", () => {
  it("keeps a readable team color", () => {
    expect(helmetMaskColor("#FFB81C")).toBe("#FFB81C");
    expect(helmetMaskColor("#869397")).toBe("#869397");
  });
  it("falls back to tan for white and black", () => {
    expect(helmetMaskColor("#FFFFFF")).toBe(MASK_TAN);
    expect(helmetMaskColor("#000000")).toBe(MASK_TAN);
    expect(helmetMaskColor("#181a21")).toBe(MASK_TAN);
  });
});

describe("teamLook: a team's colors and gear for its badge", () => {
  it("NFL teams get a helmet in their colors", () => {
    expect(teamLook("Baltimore Ravens")).toEqual({ kind: "helmet", primary: "#241773", secondary: "#9E7C0C" });
    expect(teamLook("Jacksonville Jaguars")).toEqual({ kind: "helmet", primary: "#006778", secondary: "#D7A22A" });
  });
  it("NBA teams get a jersey", () => {
    expect(teamLook("Boston Celtics")).toEqual({ kind: "jersey", primary: "#007A33", secondary: "#BA9653" });
    expect(teamLook("Los Angeles Lakers").kind).toBe("jersey");
  });
  it("all 192 distinct team names are covered", async () => {
    const { TEAM_COLORS } = await import("./team-colors");
    expect(Object.keys(TEAM_COLORS)).toHaveLength(192);
  });
  it("an unknown team still gets a steady color (same team, same color), neutral shield", () => {
    const a = teamLook("Mocktown Rockets", "basketball_nba");
    expect(a.kind).toBe("shield");
    expect(a).toEqual(teamLook("Mocktown Rockets", "basketball_nba"));
    expect(teamLook("Testville Comets", "americanfootball_nfl").kind).toBe("shield");
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

describe("readableTeamColor: team names in team colors, always readable on white", () => {
  it("keeps a dark primary", () => {
    expect(readableTeamColor("Los Angeles Lakers")).toBe("#552583");
    expect(readableTeamColor("Boston Celtics")).toBe(teamLook("Boston Celtics").primary);
  });
  it("falls back to the secondary when the primary is too light", () => {
    const light = ["Cincinnati Bengals", "Denver Broncos"];
    for (const team of light) {
      const { primary, secondary } = teamLook(team);
      expect(contrastOnWhite(primary)).toBeLessThan(4.5);
      expect(readableTeamColor(team)).toBe(contrastOnWhite(secondary) >= 4.5 ? secondary : "#181a21");
    }
  });
  it("every color it returns passes 4.5:1", () => {
    for (const team of ["Golden State Warriors", "Indiana Pacers", "Some New Team", "Miami Dolphins"]) {
      expect(contrastOnWhite(readableTeamColor(team))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("contrast math: black is 21, white is 1", () => {
    expect(contrastOnWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastOnWhite("#ffffff")).toBeCloseTo(1, 5);
  });
});
