import { describe, expect, it } from "vitest";
import { autoGradesProp, HOST_GRADED_PROP_MARKETS } from "./props";
describe("automatic prop registry", () => {
  it("supports exact sports and shares ladder handlers", () => {
    expect(autoGradesProp("americanfootball_nfl", "player_rush_yds_alternate")).toBe(true);
    expect(autoGradesProp("americanfootball_ncaaf", "player_rush_yds")).toBe(true);
    expect(autoGradesProp("americanfootball_ncaaf", "player_anytime_td")).toBe(true);
    expect(autoGradesProp("americanfootball_ncaaf", "player_pass_tds")).toBe(false);
    expect(autoGradesProp("americanfootball_ncaaf", "player_rush_yds_alternate")).toBe(true); // shares the main stat
    expect(autoGradesProp("basketball_nba", "player_points")).toBe(true);
    expect(autoGradesProp("basketball_unknown", "player_points")).toBe(false);
    expect(autoGradesProp("americanfootball_nfl", HOST_GRADED_PROP_MARKETS[0])).toBe(false);
  });
});
