/**
 * Credit math for The Odds API v4 (pure, runtime-agnostic). The DB enforces the budget
 * (odds_budget_reserve); this only computes what to reserve and reads what was actually charged.
 * Pricing: https://the-odds-api.com/liveapi/guides/v4/#usage-quota-costs
 *   /odds cost = unique markets × regions, where each group of up to 10 bookmakers = 1 region.
 *   /events and /sports are free.
 */

export function oddsCallCost(markets: string[], bookmakers: string[]): number {
  const uniqueMarkets = new Set(markets).size;
  if (uniqueMarkets === 0) throw new Error("oddsCallCost: no markets");
  if (bookmakers.length === 0) throw new Error("oddsCallCost: no bookmakers");
  return uniqueMarkets * Math.ceil(bookmakers.length / 10);
}

export type Usage = { creditsUsed: number | null; creditsRemaining: number | null };

/** Read x-requests-last / x-requests-remaining, rounding against us when fractional. */
export function usageFromHeaders(headers: Headers): Usage {
  const num = (name: string) => {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const last = num("x-requests-last");
  const remaining = num("x-requests-remaining");
  return {
    creditsUsed: last === null ? null : Math.ceil(last),
    creditsRemaining: remaining === null ? null : Math.floor(remaining),
  };
}
