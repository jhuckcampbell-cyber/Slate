import { describe, expect, it } from "vitest";
import { compactMatchup, getTeam, teamLabel } from "./team";

describe("getTeam", () => {
  it("handles long and special names", () => {
    expect(getTeam("Oklahoma City Thunder")).toEqual({
      full: "Oklahoma City Thunder", short: "Thunder", place: "Oklahoma City", abbr: "OKC",
    });
    expect(getTeam("Portland Trail Blazers").short).toBe("Trail Blazers");
    expect(getTeam("Portland Trail Blazers").place).toBe("Portland");
    expect(teamLabel("Washington Commanders")).toBe("Commanders");
    expect(teamLabel("San Francisco 49ers")).toBe("49ers");
  });
  it("keeps same-city teams distinct", () => {
    expect(teamLabel("Los Angeles Clippers", "abbr")).toBe("LAC");
    expect(teamLabel("Los Angeles Lakers", "abbr")).toBe("LAL");
  });
  it("falls back for unknown teams", () => {
    const t = getTeam("Ohio State Buckeyes");
    expect(t.short).toBe("Ohio St");
    expect(t.abbr).toBe("OHI");
  });
  it("uses school names for college mascots", () => {
    expect(getTeam("Alabama Crimson Tide")).toEqual({ full: "Alabama Crimson Tide", short: "Alabama", place: "Alabama", abbr: "ALA" });
    expect(teamLabel("Michigan St Spartans")).toBe("Michigan St");
    expect(teamLabel("Duke Blue Devils")).toBe("Duke");
    expect(teamLabel("UConn Huskies", "abbr")).toBe("UCO");
    expect(teamLabel("Duke")).toBe("Duke");
  });
  it("builds compact matchups", () => {
    expect(compactMatchup("Boston Celtics", "New York Knicks")).toBe("BOS @ NYK");
  });
});
