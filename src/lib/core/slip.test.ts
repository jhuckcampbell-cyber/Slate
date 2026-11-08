import { describe, expect, it } from "vitest";
import {
  buildWagers,
  houseRuleShortfall,
  splitEvenly,
  parlayEligibility,
  slipTotals,
  validateSlip,
  wagerAmerican,
  type Rules,
  type Selection,
} from "./slip";

const rules: Rules = {
  markets: ["h2h", "spreads", "totals"],
  parlays: true,
  maxParlayLegs: 3,
  maxBetCents: null,
  sameGameParlays: false,
};

function sel(oddsId: number, eventId: string, priceAmerican = -110, marketKey = "spreads"): Selection {
  return {
    oddsId,
    eventId,
    marketKey,
    outcomeName: `team-${oddsId}`,
    participantName: "",
    priceAmerican,
    point: marketKey === "h2h" ? null : -3.5,
  };
}

describe("parlayEligibility", () => {
  it("accepts distinct events within the leg limit", () => {
    expect(parlayEligibility([sel(1, "a"), sel(2, "b")], rules)).toEqual({ ok: true });
  });
  it("needs two legs", () => {
    expect(parlayEligibility([sel(1, "a")], rules)).toEqual({ ok: false, reason: "TOO_FEW_LEGS" });
  });
  it("rejects two legs from the same game", () => {
    expect(parlayEligibility([sel(1, "a"), sel(2, "a", -110, "totals")], rules)).toEqual({
      ok: false,
      reason: "SAME_EVENT_PARLAY",
    });
  });
  it("same-game parlays (host switch on): different bets on one game are fine", () => {
    const sgp = { ...rules, sameGameParlays: true, markets: [...rules.markets, "player_rush_yds", "player_rush_yds_alternate", "player_anytime_td"] };
    const prop = (id: number, market: string, outcome: string, player: string, point: number | null = null): Selection => ({
      oddsId: id, eventId: "a", marketKey: market, outcomeName: outcome, participantName: player, priceAmerican: 120, point,
    });
    expect(parlayEligibility([sel(1, "a", -110, "h2h"), sel(2, "a", -110, "totals"), prop(3, "player_anytime_td", "Yes", "Derrick Henry")], sgp))
      .toEqual({ ok: true });
    // Overlapping picks: two on one game line, or two on one player's stat (a ladder counts as that stat).
    expect(parlayEligibility([sel(1, "a", -110, "totals"), sel(2, "a", -110, "totals")], sgp))
      .toEqual({ ok: false, reason: "CONFLICTING_LEGS" });
    expect(parlayEligibility([prop(1, "player_rush_yds_alternate", "Over", "Derrick Henry", 49.5), prop(2, "player_rush_yds_alternate", "Over", "Derrick Henry", 99.5)], sgp))
      .toEqual({ ok: false, reason: "CONFLICTING_LEGS" });
    expect(parlayEligibility([prop(1, "player_rush_yds", "Under", "Derrick Henry", 84.5), prop(2, "player_rush_yds_alternate", "Over", "Derrick Henry", 99.5)], sgp))
      .toEqual({ ok: false, reason: "CONFLICTING_LEGS" });
    // Different players' stats on one game are separate bets.
    expect(parlayEligibility([prop(1, "player_rush_yds", "Over", "Derrick Henry", 84.5), prop(2, "player_rush_yds", "Over", "Travis Etienne", 60.5)], sgp))
      .toEqual({ ok: true });
  });
  it("respects the host's leg limit and parlay switch", () => {
    const four = [sel(1, "a"), sel(2, "b"), sel(3, "c"), sel(4, "d")];
    expect(parlayEligibility(four, rules)).toEqual({ ok: false, reason: "TOO_MANY_LEGS" });
    expect(parlayEligibility(four.slice(0, 2), { ...rules, parlays: false })).toEqual({
      ok: false,
      reason: "PARLAYS_DISABLED",
    });
  });
});

describe("buildWagers + totals", () => {
  const picks = [sel(1, "a"), sel(2, "b", +150, "h2h")];

  it("singles: one wager per selection with its own stake", () => {
    const drafts = buildWagers("singles", picks, { 1: 1000, 2: 500 }, undefined);
    expect(drafts.map((d) => d.amountCents)).toEqual([1000, 500]);
    // $10 at -110 returns $19.09; $5 at +150 returns $12.50
    expect(slipTotals(drafts)).toEqual({ stakeCents: 1500, returnCents: 3159, profitCents: 1659 });
  });

  it("parlay: one wager with every leg", () => {
    const [draft] = buildWagers("parlay", picks, {}, 1000);
    expect(draft!.legs).toHaveLength(2);
    // 1.9091 × 2.5 = 4.77275 → 4.7728 → $47.72 return
    expect(slipTotals([draft!]).returnCents).toBe(4772);
    expect(wagerAmerican(draft!.legs)).toBe(377);
  });
});

describe("validateSlip", () => {
  const picks = [sel(1, "a"), sel(2, "b")];

  it("passes a clean slip", () => {
    const drafts = buildWagers("singles", picks, { 1: 2000, 2: 3000 }, undefined);
    expect(validateSlip(drafts, { rules, bankrollCents: 10_000 })).toEqual([]);
  });

  it("flags missing, tiny, and oversized stakes per selection", () => {
    const drafts = buildWagers("singles", [...picks, sel(3, "c")], { 1: 0, 2: 50, 3: 6000 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, maxBetCents: 5000 }, bankrollCents: 10_000 })).toEqual([
      { code: "MISSING_STAKE", oddsId: 1 },
      { code: "INVALID_AMOUNT", oddsId: 2 },
      { code: "OVER_MAX_BET", oddsId: 3 },
    ]);
  });

  it("flags total stake over the bankroll", () => {
    const drafts = buildWagers("singles", picks, { 1: 6000, 2: 6000 }, undefined);
    expect(validateSlip(drafts, { rules, bankrollCents: 10_000 })).toEqual([
      { code: "INSUFFICIENT_BANKROLL" },
    ]);
  });

  it("flags markets the host disallowed", () => {
    const drafts = buildWagers("singles", [sel(1, "a", -110, "totals")], { 1: 1000 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, markets: ["h2h"] }, bankrollCents: 10_000 })).toEqual([
      { code: "MARKET_NOT_ALLOWED", oddsId: 1 },
    ]);
  });

  it("flags same-game parlays", () => {
    const drafts = buildWagers("parlay", [sel(1, "a"), sel(2, "a", -110, "totals")], {}, 1000);
    expect(validateSlip(drafts, { rules, bankrollCents: 10_000 })).toEqual([
      { code: "SAME_EVENT_PARLAY" },
    ]);
  });
});

describe("house rules on submit (mirrors place_wagers, migration 0022)", () => {
  const picks3 = [sel(1, "a"), sel(2, "b"), sel(3, "c")];

  it("a slip short of the minimum number of bets can't be placed", () => {
    const drafts = buildWagers("singles", [sel(1, "a")], { 1: 1_000 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, minBets: 3 }, bankrollCents: 10_000, betsPlaced: 0 })).toEqual([
      { code: "HOUSE_RULE_MIN_BETS" },
    ]);
  });

  it("counts bets already placed", () => {
    const drafts = buildWagers("singles", [sel(1, "a")], { 1: 1_000 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, minBets: 3 }, bankrollCents: 8_000, betsPlaced: 2 })).toEqual([]);
  });

  it("all in: money left unbet blocks the slip", () => {
    const drafts = buildWagers("singles", picks3, { 1: 3_000, 2: 3_000, 3: 3_000 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, allIn: true }, bankrollCents: 10_000 })).toEqual([
      { code: "HOUSE_RULE_ALL_IN" },
    ]);
    expect(houseRuleShortfall({ allIn: true, minBets: 4 }, { bankrollCents: 10_000, betsPlaced: 0 }, drafts)).toEqual({
      betsShort: 1,
      leftCents: 1_000,
    });
  });

  it("all in and enough bets: fine", () => {
    const drafts = buildWagers("singles", picks3, { 1: 3_400, 2: 3_300, 3: 3_300 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, allIn: true, minBets: 3 }, bankrollCents: 10_000 })).toEqual([]);
  });

  it("does nothing when there are no house rules", () => {
    const drafts = buildWagers("singles", [sel(1, "a")], { 1: 10_000 }, undefined);
    expect(validateSlip(drafts, { rules, bankrollCents: 10_000 })).toEqual([]);
  });

  it("reports only the bankroll problem when the slip is already too big", () => {
    const drafts = buildWagers("singles", [sel(1, "a")], { 1: 12_000 }, undefined);
    expect(validateSlip(drafts, { rules: { ...rules, minBets: 3 }, bankrollCents: 10_000, betsPlaced: 0 })).toEqual([
      { code: "INSUFFICIENT_BANKROLL" },
    ]);
  });
});

describe("splitEvenly", () => {
  it("splits to the cent, whole dollars first", () => {
    expect(splitEvenly(10_000, 3)).toEqual([3_400, 3_300, 3_300]);
    expect(splitEvenly(10_050, 2)).toEqual([5_000, 5_050]);
    expect(splitEvenly(10_000, 1)).toEqual([10_000]);
    expect(splitEvenly(0, 3)).toEqual([]);
  });

  it("respects the host's max bet", () => {
    expect(splitEvenly(10_000, 2, 2_500)).toEqual([2_500, 2_500]);
  });
});
