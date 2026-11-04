import { describe, expect, it } from "vitest";
import { MARKET_LABELS, formatCheckedAgo, selectionLabel } from "./format";

describe("formatCheckedAgo", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("says just now under a minute", () => {
    expect(formatCheckedAgo(ago(30_000), now)).toBe("just now");
    expect(formatCheckedAgo(ago(-5_000), now)).toBe("just now"); // small clock skew
  });

  it("counts whole minutes under an hour", () => {
    expect(formatCheckedAgo(ago(60_000), now)).toBe("1 min ago");
    expect(formatCheckedAgo(ago(59 * 60_000 + 59_000), now)).toBe("59 min ago");
  });

  it("counts whole hours after that", () => {
    expect(formatCheckedAgo(ago(60 * 60_000), now)).toBe("1 hr ago");
    expect(formatCheckedAgo(ago(11 * 60 * 60_000 + 59 * 60_000), now)).toBe("11 hr ago");
  });
});

describe("prop labels", () => {
  it("names the player, side, line and stat", () => {
    expect(
      selectionLabel({ marketKey: "player_points", outcomeName: "Over", point: 27.5, participantName: "Jayson Tatum" }),
    ).toBe("Jayson Tatum Over 27.5 Pts");
    expect(
      selectionLabel({ marketKey: "player_reception_yds", outcomeName: "Under", point: 64.5, participantName: "Travis Kelce" }),
    ).toBe("Travis Kelce Under 64.5 Rec Yds");
  });
  it("market labels for the board", () => {
    expect(MARKET_LABELS.player_points).toBe("Points");
    expect(MARKET_LABELS.player_pass_yds).toBe("Passing yards");
    expect(MARKET_LABELS.player_rush_yds_alternate).toBe("Alt rushing yards");
    expect(MARKET_LABELS.player_pass_tds).toBe("Passing TDs");
    expect(MARKET_LABELS.player_anytime_td).toBe("Anytime TD");
  });
  it("an alternate line reads as a milestone (Over 99.5 = 100+)", () => {
    expect(
      selectionLabel({ marketKey: "player_rush_yds_alternate", outcomeName: "Over", point: 99.5, participantName: "Derrick Henry" }),
    ).toBe("Derrick Henry 100+ Rush Yds");
  });
  it("names the player's team when known, so it's clear who plays for whom", () => {
    expect(
      selectionLabel({ marketKey: "player_rush_yds_alternate", outcomeName: "Over", point: 49.5, participantName: "Derrick Henry", participantTeam: "Baltimore Ravens" }),
    ).toBe("Derrick Henry (Ravens) 50+ Rush Yds");
    expect(
      selectionLabel({ marketKey: "player_anytime_td", outcomeName: "Yes", point: null, participantName: "Derrick Henry", participantTeam: "Baltimore Ravens" }),
    ).toBe("Derrick Henry (Ravens) Anytime TD");
    expect(
      selectionLabel({ marketKey: "player_points", outcomeName: "Over", point: 27.5, participantName: "Jayson Tatum", participantTeam: null }),
    ).toBe("Jayson Tatum Over 27.5 Pts");
  });
  it("anytime TD and passing TDs", () => {
    expect(
      selectionLabel({ marketKey: "player_anytime_td", outcomeName: "Yes", point: null, participantName: "Derrick Henry" }),
    ).toBe("Derrick Henry Anytime TD");
    expect(
      selectionLabel({ marketKey: "player_pass_tds", outcomeName: "Over", point: 1.5, participantName: "Trevor Lawrence" }),
    ).toBe("Trevor Lawrence Over 1.5 Pass TDs");
  });
});
