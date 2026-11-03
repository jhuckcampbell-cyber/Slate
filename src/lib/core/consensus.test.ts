import { describe, expect, it } from "vitest";
import { buildConsensus, slipsByPlayer, type RevealLeg, type RevealWager } from "./consensus";

// Four players, three games (g3 gets no action). Expected values below are counted by hand.
function leg(eventId: string, marketKey: string, selection: string, line: number | null, oddsAmerican: number): RevealLeg {
  return { eventId, marketKey, selection, participantName: "", line, oddsAmerican };
}

const wagers: RevealWager[] = [
  // B's single got a moved line (-3.5) and comes first; -3 is still the most common line.
  { id: "b1", participantId: "B", wagerType: "single", amountCents: 1500, potentialPayoutCents: 2928,
    legs: [leg("g1", "spreads", "Chiefs", -3.5, -105)] },
  { id: "a1", participantId: "A", wagerType: "single", amountCents: 2000, potentialPayoutCents: 3818,
    legs: [leg("g1", "spreads", "Chiefs", -3, -110)] },
  { id: "a2", participantId: "A", wagerType: "single", amountCents: 1000, potentialPayoutCents: 1500,
    legs: [leg("g2", "h2h", "Eagles", null, -200)] },
  { id: "b2", participantId: "B", wagerType: "parlay", amountCents: 1000, potentialPayoutCents: 3645,
    legs: [leg("g1", "spreads", "Chiefs", -3, -110), leg("g2", "totals", "Over", 45.5, -110)] },
  { id: "c1", participantId: "C", wagerType: "single", amountCents: 500, potentialPayoutCents: 954,
    legs: [leg("g1", "spreads", "Bills", 3, -110)] },
  { id: "d1", participantId: "D", wagerType: "parlay", amountCents: 500, potentialPayoutCents: 3105,
    legs: [leg("g1", "h2h", "Bills", null, 130), leg("g2", "h2h", "Cowboys", null, 170)] },
];

describe("buildConsensus", () => {
  const games = buildConsensus(wagers, ["g1", "g2", "g3"]);

  it("keeps the slate order and includes games nobody bet", () => {
    expect(games.map((g) => [g.eventId, g.playerCount])).toEqual([
      ["g1", 4],
      ["g2", 3],
      ["g3", 0],
    ]);
    expect(games[2]!.markets).toEqual([]);
  });

  it("orders markets like the board: spread, total, moneyline", () => {
    expect(games[0]!.markets.map((m) => m.marketKey)).toEqual(["spreads", "h2h"]);
    expect(games[1]!.markets.map((m) => m.marketKey)).toEqual(["totals", "h2h"]);
  });

  it("counts each player once per side, however many bets they have on it", () => {
    const spread = games[0]!.markets[0]!;
    expect(spread.playerCount).toBe(3);
    expect(spread.sides.map((s) => [s.selection, s.playerCount, s.stakeCents])).toEqual([
      ["Chiefs", 2, 3500],
      ["Bills", 1, 500],
    ]);
  });

  it("names the majority side and shows its most common line", () => {
    const spread = games[0]!.markets[0]!;
    expect(spread.leader?.selection).toBe("Chiefs");
    expect(spread.leader?.line).toBe(-3); // -3 twice (A's single, B's parlay) vs -3.5 once
  });

  it("aggregates a player's singles and parlay legs on a side into one backer", () => {
    const chiefs = games[0]!.markets[0]!.sides[0]!;
    expect(chiefs.backers).toEqual([
      { participantId: "B", singleStakeCents: 1500, parlays: 1, line: -3.5, oddsAmerican: -105 },
      { participantId: "A", singleStakeCents: 2000, parlays: 0, line: -3, oddsAmerican: -110 },
    ]);
  });

  it("parlay-only picks count as backers with no single stake", () => {
    const moneyline = games[0]!.markets[1]!;
    expect(moneyline.sides).toHaveLength(1);
    expect(moneyline.sides[0]!.backers).toEqual([
      { participantId: "D", singleStakeCents: 0, parlays: 1, line: null, oddsAmerican: 130 },
    ]);
    expect(moneyline.leader?.selection).toBe("Bills");
  });

  it("has no leader when the top sides tie", () => {
    const moneyline = games[1]!.markets[1]!;
    expect(moneyline.playerCount).toBe(2);
    expect(moneyline.leader).toBeNull();
  });
});

describe("slipsByPlayer", () => {
  it("groups wagers per player in the given order, including players with no picks", () => {
    const slips = slipsByPlayer(wagers, ["D", "A", "E"]);
    expect(slips.map((s) => [s.participantId, s.wagers.map((w) => w.id), s.riskedCents, s.potentialPayoutCents])).toEqual([
      ["D", ["d1"], 500, 3105],
      ["A", ["a1", "a2"], 3000, 5318],
      ["E", [], 0, 0],
    ]);
  });
});
