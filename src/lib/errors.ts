/** Maps stable error codes (raised in SQL, mirrored by src/lib/core/slip.ts) to user-facing copy. */
const MESSAGES: Record<string, string> = {
  // auth / tournaments
  NOT_AUTHENTICATED: "Your session expired. Refresh and try again.",
  RATE_LIMITED: "Slow down! You've created a lot of tournaments this hour.",
  INVALID_EVENTS: "One of those games already started or isn't available anymore.",
  MIXED_SPORTS: "Pick games from a single sport.",
  INVALID_LOCK_TIME: "Lock time must be before the first kickoff.",
  CODE_GENERATION_FAILED: "Couldn't create an invite code. Try again.",
  TOURNAMENT_NOT_FOUND: "No tournament with that code. Double-check the link.",
  TOURNAMENT_LOCKED: "Picks are locked. This tournament already started.",
  TOURNAMENT_FULL: "This tournament is full.",
  NOT_A_PARTICIPANT: "You're not in this tournament yet.",
  // slip
  INVALID_SLIP: "Your slip is empty.",
  MISSING_STAKE: "Enter a stake for every pick.",
  INVALID_AMOUNT: "Minimum bet is $1.",
  OVER_MAX_BET: "That's over this tournament's max bet.",
  INSUFFICIENT_BANKROLL: "Not enough bankroll for that slip.",
  MARKET_NOT_ALLOWED: "The host turned that bet type off.",
  PARLAYS_DISABLED: "The host turned parlays off.",
  TOO_FEW_LEGS: "A parlay needs at least 2 picks.",
  TOO_MANY_LEGS: "Too many legs for this tournament's parlay limit.",
  SAME_EVENT_PARLAY: "Parlays can only have one pick per game.",
  ODDS_UNAVAILABLE: "That line was pulled. Remove it and pick again.",
  INVALID_SELECTION: "That game isn't part of this tournament.",
  EVENT_STARTED: "That game already started.",
  ODDS_STALE: "Odds are refreshing. Try again in a minute.",
  ODDS_CHANGED: "Odds moved. Review the new prices and accept to continue.",
  WAGER_NOT_FOUND: "That bet no longer exists.",
};

export function errorCode(error: unknown): string | null {
  const msg =
    typeof error === "object" && error && "message" in error ? String(error.message) : null;
  return msg && msg in MESSAGES ? msg : null;
}

export function friendlyError(error: unknown): string {
  const code = errorCode(error);
  if (code) return MESSAGES[code]!;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? code;
}

/** ODDS_CHANGED carries the current prices in `details` (JSON) so the slip can show them. */
export type PriceUpdate = { odds_id: number; price_american: number; point: number | null };

export function priceUpdatesFrom(error: unknown): PriceUpdate[] {
  if (errorCode(error) !== "ODDS_CHANGED") return [];
  const details = typeof error === "object" && error && "details" in error ? error.details : null;
  try {
    const parsed = JSON.parse(String(details)) as PriceUpdate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
