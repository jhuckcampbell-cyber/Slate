import { describe, expect, it } from "vitest";
import { matchesQuery, orderPlayers } from "./prop-order";

const r = (participantName: string, priceAmerican: number, outcomeName = "Yes", point: number | null = null) => ({
  participantName,
  priceAmerican,
  outcomeName,
  point,
});

describe("orderPlayers", () => {
  it("puts the likeliest anytime scorer first, not alphabetical", () => {
    const rows = [r("Aaron Zed", 450), r("Bo Mid", 120), r("Cy Fav", -140), r("Di Long", 900)];
    expect(orderPlayers(rows, "player_anytime_td")).toEqual(["Cy Fav", "Bo Mid", "Aaron Zed", "Di Long"]);
  });

  it("orders over/under props by the line, biggest number first", () => {
    const rows = [r("Low", -110, "Over", 45.5), r("High", -115, "Over", 82.5), r("High", -105, "Under", 82.5)];
    expect(orderPlayers(rows, "player_reception_yds")).toEqual(["High", "Low"]);
  });

  it("orders a ladder by its likeliest rung, and breaks ties by name", () => {
    const rows = [
      r("Beta", 200, "Over", 49.5),
      r("Beta", -300, "Over", 19.5),
      r("Alpha", -300, "Over", 19.5),
      r("Gamma", 150, "Over", 29.5),
    ];
    expect(orderPlayers(rows, "player_rush_yds_alternate")).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("matchesQuery", () => {
  it("finds players by any part of the name, ignoring case and extra spaces", () => {
    expect(matchesQuery("Trevor Lawrence", "Jacksonville Jaguars", "  LAW ")).toBe(true);
    expect(matchesQuery("Trevor Lawrence", "Jacksonville Jaguars", "tre law")).toBe(true);
    expect(matchesQuery("Trevor Lawrence", "Jacksonville Jaguars", "mahomes")).toBe(false);
  });

  it("also matches the team, and an empty search matches everyone", () => {
    expect(matchesQuery("Trevor Lawrence", "Jacksonville Jaguars", "jaguars")).toBe(true);
    expect(matchesQuery("Trevor Lawrence", null, "")).toBe(true);
  });
});
