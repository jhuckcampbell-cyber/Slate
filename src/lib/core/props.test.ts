import { describe, expect, it } from "vitest";
import { isPropMarket, propLinesToGrade, propMarkets, statMarket, tournamentMarkets } from "./props";

describe("propMarkets (mirrors private.prop_markets)", () => {
  it("basketball: points, rebounds, assists", () => {
    expect(propMarkets("basketball_nba")).toEqual(["player_points", "player_rebounds", "player_assists"]);
    expect(propMarkets("basketball_ncaab")).toEqual(["player_points", "player_rebounds", "player_assists"]);
  });
  it("football: yards and receptions (main + alternate ladders), passing TDs, anytime TD", () => {
    expect(propMarkets("americanfootball_nfl")).toEqual([
      "player_pass_yds",
      "player_rush_yds",
      "player_reception_yds",
      "player_receptions",
      "player_pass_yds_alternate",
      "player_rush_yds_alternate",
      "player_reception_yds_alternate",
      "player_receptions_alternate",
      "player_pass_tds",
      "player_anytime_td",
    ]);
  });
  it("nothing for other sports", () => {
    expect(propMarkets("icehockey_nhl")).toEqual([]);
  });
});

describe("tournamentMarkets", () => {
  it("adds the sport's props only when the host turned them on", () => {
    expect(tournamentMarkets("basketball_nba", ["h2h"], true)).toEqual([
      "h2h",
      "player_points",
      "player_rebounds",
      "player_assists",
    ]);
    expect(tournamentMarkets("basketball_nba", ["h2h"], false)).toEqual(["h2h"]);
    expect(tournamentMarkets("icehockey_nhl", ["h2h"], true)).toEqual(["h2h"]);
  });
});

describe("isPropMarket", () => {
  it("spots player markets", () => {
    expect(isPropMarket("player_points")).toBe(true);
    expect(isPropMarket("totals")).toBe(false);
  });
});

describe("propLinesToGrade", () => {
  const leg = (eventId: string, marketKey: string, participantName: string, status = "pending") => ({
    eventId,
    marketKey,
    participantName,
    status,
  });

  it("one entry per (game, market, player) with pending picks on a final game", () => {
    const lines = propLinesToGrade(
      [
        leg("g1", "player_points", "Jayson Tatum"),
        leg("g1", "player_points", "Jayson Tatum"), // second bettor, same line
        leg("g1", "player_rebounds", "Jayson Tatum", "push"), // already graded
        leg("g1", "h2h", ""), // not a prop
        leg("g2", "player_points", "Nikola Jokic"), // game not final
      ],
      new Set(["g1"]),
    );
    expect(lines).toEqual([{ eventId: "g1", marketKey: "player_points", player: "Jayson Tatum" }]);
  });

  it("an alternate ladder is graded by the same stat as its main line: one entry", () => {
    const lines = propLinesToGrade(
      [leg("g1", "player_rush_yds_alternate", "Derrick Henry"), leg("g1", "player_rush_yds", "Derrick Henry")],
      new Set(["g1"]),
    );
    expect(lines).toEqual([{ eventId: "g1", marketKey: "player_rush_yds", player: "Derrick Henry" }]);
  });
});

describe("statMarket", () => {
  it("maps an alternate ladder to the stat it's graded on", () => {
    expect(statMarket("player_rush_yds_alternate")).toBe("player_rush_yds");
    expect(statMarket("player_anytime_td")).toBe("player_anytime_td");
    expect(statMarket("player_points")).toBe("player_points");
  });
});
