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
  });
});
