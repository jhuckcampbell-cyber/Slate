/**
 * Bet-slip model + validation. PURE. Mirrors the checks in public.place_wagers so the slip can
 * explain problems before submitting; the server stays the authority (CLAUDE.md rule 3).
 * Issue codes match the SQL error codes, so src/lib/errors.ts covers both.
 */
import { americanToDecimalE4, decimalE4ToAmerican, parlayDecimalE4, payoutCents } from "./odds";
import { isPropMarket, statMarket } from "./props";

export const MIN_WAGER_CENTS = 100;
export const MAX_SLIP_SELECTIONS = 20;

export type Rules = {
  markets: readonly string[];
  parlays: boolean;
  maxParlayLegs: number;
  maxBetCents: number | null;
  /** Host switch: several picks from one game in a parlay (never two on the same line or player stat). */
  sameGameParlays: boolean;
  /** House rule: everyone makes at least this many bets (0 or missing = no minimum). */
  minBets?: number;
  /** House rule: everyone bets their whole bankroll. */
  allIn?: boolean;
  /** Token mode: every bet is exactly one of these amounts (cents), each used once; all must be used. */
  tokens?: readonly number[] | null;
};

export type Selection = {
  oddsId: number;
  eventId: string;
  marketKey: string;
  outcomeName: string;
  participantName: string;
  /** The price/line the player accepted; sent to the server as the expected price. */
  priceAmerican: number;
  point: number | null;
};

/** "mixed" (token mode): the picks in `parlayIds` make one parlay, every other pick is a single. */
export type SlipMode = "singles" | "parlay" | "mixed";

export type WagerDraft = { amountCents: number; legs: Selection[] };

export type SlipIssueCode =
  | "MISSING_STAKE"
  | "INVALID_AMOUNT"
  | "OVER_MAX_BET"
  | "HOUSE_RULE_MIN_BETS"
  | "HOUSE_RULE_ALL_IN"
  | "INSUFFICIENT_BANKROLL"
  | "MARKET_NOT_ALLOWED"
  | "PARLAYS_DISABLED"
  | "TOO_FEW_LEGS"
  | "TOO_MANY_LEGS"
  | "SAME_EVENT_PARLAY"
  | "CONFLICTING_LEGS";

export type SlipIssue = { code: SlipIssueCode; oddsId?: number };

export function parlayEligibility(
  selections: readonly Selection[],
  rules: Rules,
): { ok: true } | { ok: false; reason: SlipIssueCode } {
  if (!rules.parlays) return { ok: false, reason: "PARLAYS_DISABLED" };
  if (selections.length < 2) return { ok: false, reason: "TOO_FEW_LEGS" };
  if (selections.length > rules.maxParlayLegs) return { ok: false, reason: "TOO_MANY_LEGS" };
  if (!rules.sameGameParlays && new Set(selections.map((s) => s.eventId)).size !== selections.length) {
    return { ok: false, reason: "SAME_EVENT_PARLAY" };
  }
  if (new Set(selections.map(legSlot)).size !== selections.length) return { ok: false, reason: "CONFLICTING_LEGS" };
  return { ok: true };
}

/**
 * What a parlay leg occupies (mirrors place_wagers): one pick per game line (moneyline, spread, total) and one per
 * player stat per game. An alternate ladder is the same stat as its main line, so "50+" and "100+" on one player
 * (or Over/Under) can't be stacked.
 */
export function legSlot(s: Pick<Selection, "eventId" | "marketKey" | "participantName">): string {
  return isPropMarket(s.marketKey) ? `${s.eventId}|${statMarket(s.marketKey)}|${s.participantName}` : `${s.eventId}|${s.marketKey}`;
}

export function buildWagers(
  mode: SlipMode,
  selections: readonly Selection[],
  stakes: Readonly<Record<number, number | undefined>>,
  parlayStakeCents: number | undefined,
  parlayIds: readonly number[] = [],
): WagerDraft[] {
  if (selections.length === 0) return [];
  if (mode === "parlay") return [{ amountCents: parlayStakeCents ?? 0, legs: [...selections] }];
  const singles = (list: readonly Selection[]) => list.map((s) => ({ amountCents: stakes[s.oddsId] ?? 0, legs: [s] }));
  if (mode === "mixed") {
    const grouped = selections.filter((s) => parlayIds.includes(s.oddsId));
    // A "parlay" of one pick is just a single.
    if (grouped.length < 2) return singles(selections);
    const rest = selections.filter((s) => !parlayIds.includes(s.oddsId));
    return [{ amountCents: parlayStakeCents ?? 0, legs: grouped }, ...singles(rest)];
  }
  return singles(selections);
}

export function wagerDecimalE4(legs: readonly Selection[]): number {
  return parlayDecimalE4(legs.map((l) => americanToDecimalE4(l.priceAmerican)));
}

export function wagerAmerican(legs: readonly Selection[]): number {
  return legs.length === 1 ? legs[0]!.priceAmerican : decimalE4ToAmerican(wagerDecimalE4(legs));
}

export function wagerPayoutCents(draft: WagerDraft): number {
  return draft.amountCents > 0 ? payoutCents(draft.amountCents, wagerDecimalE4(draft.legs)) : 0;
}

export function slipTotals(drafts: readonly WagerDraft[]) {
  let stakeCents = 0;
  let returnCents = 0;
  for (const d of drafts) {
    stakeCents += Math.max(d.amountCents, 0);
    returnCents += wagerPayoutCents(d);
  }
  return { stakeCents, returnCents, profitCents: returnCents - stakeCents };
}

/**
 * What this slip still misses of the house rules, counting bets already placed (mirrors place_wagers, migration 0022:
 * a slip only goes through if, once placed, the player meets every rule).
 */
export function houseRuleShortfall(
  rules: Pick<Rules, "minBets" | "allIn">,
  ctx: { bankrollCents: number; betsPlaced: number },
  drafts: readonly WagerDraft[],
): { betsShort: number; leftCents: number } {
  const stake = drafts.reduce((sum, d) => sum + Math.max(d.amountCents, 0), 0);
  return {
    betsShort: Math.max(0, (rules.minBets ?? 0) - ctx.betsPlaced - drafts.length),
    leftCents: rules.allIn ? Math.max(0, ctx.bankrollCents - stake) : 0,
  };
}

/** Split a bankroll across n bets to the cent (whole dollars where possible, so all-in adds up exactly). */
export function splitEvenly(totalCents: number, n: number, capCents: number | null = null): number[] {
  if (n <= 0 || totalCents <= 0) return [];
  const dollars = Math.floor(totalCents / 100);
  const base = Math.floor(dollars / n);
  const extra = dollars - base * n;
  const out = Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * 100);
  out[n - 1]! += totalCents - dollars * 100; // leftover cents ride on the last bet
  return capCents === null ? out : out.map((c) => Math.min(c, capCents));
}

export function validateSlip(
  drafts: readonly WagerDraft[],
  ctx: { rules: Rules; bankrollCents: number; betsPlaced?: number },
): SlipIssue[] {
  const issues: SlipIssue[] = [];
  let total = 0;

  for (const d of drafts) {
    const single = d.legs.length === 1 ? d.legs[0]!.oddsId : undefined;
    if (d.amountCents <= 0) issues.push({ code: "MISSING_STAKE", oddsId: single });
    else if (!Number.isInteger(d.amountCents) || d.amountCents < MIN_WAGER_CENTS)
      issues.push({ code: "INVALID_AMOUNT", oddsId: single });
    else if (ctx.rules.maxBetCents !== null && d.amountCents > ctx.rules.maxBetCents)
      issues.push({ code: "OVER_MAX_BET", oddsId: single });

    for (const leg of d.legs) {
      if (!ctx.rules.markets.includes(leg.marketKey)) {
        issues.push({ code: "MARKET_NOT_ALLOWED", oddsId: leg.oddsId });
      }
    }

    if (d.legs.length > 1) {
      const eligibility = parlayEligibility(d.legs, ctx.rules);
      if (!eligibility.ok) issues.push({ code: eligibility.reason });
    }
    total += Math.max(d.amountCents, 0);
  }

  if (total > ctx.bankrollCents) issues.push({ code: "INSUFFICIENT_BANKROLL" });
  else if (drafts.length > 0) {
    const short = houseRuleShortfall(ctx.rules, { bankrollCents: ctx.bankrollCents, betsPlaced: ctx.betsPlaced ?? 0 }, drafts);
    if (short.betsShort > 0) issues.push({ code: "HOUSE_RULE_MIN_BETS" });
    if (short.leftCents > 0) issues.push({ code: "HOUSE_RULE_ALL_IN" });
  }
  return issues;
}
