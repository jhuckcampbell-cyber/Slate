/** Maps stable error codes (raised in SQL, mirrored by src/lib/core/slip.ts) to user-facing copy. */
const MESSAGES: Record<string, string> = {
  // auth / tournaments
  CAPTCHA_FAILED: "Security verification didn't finish. Please try again. If it keeps failing, refresh the page.",
  NOT_AUTHENTICATED: "Your session expired. Refresh and try again.",
  RATE_LIMITED: "Slow down! You've created a lot of tournaments this hour.",
  INVALID_EVENTS: "One of those games already started or isn't available anymore.",
  MIXED_SPORTS: "Pick games from a single sport.",
  INVALID_LOCK_TIME: "Lock time must be in the future and no later than the first kickoff.",
  CODE_GENERATION_FAILED: "Couldn't create an invite code. Try again.",
  TOURNAMENT_NOT_FOUND: "No tournament with that code. Double-check the link.",
  TOURNAMENT_LOCKED: "Picks are locked. This tournament already started.",
  TOURNAMENT_FULL: "This tournament is full.",
  NOT_A_PARTICIPANT: "You're not in this tournament yet.",
  REMOVED_BY_HOST: "The host removed you from this tournament.",
  // host controls
  NOT_HOST: "Only the host can do that.",
  // player props
  GAME_NOT_FINAL: "Enter stats once the game is final.",
  INVALID_STAT: "Enter the stat as a number, 0 or more.",
  ALREADY_GRADED: "That stat was already entered.",
  NOTHING_TO_GRADE: "Nobody has a pick on that line.",
  INVALID_CHANGES: "Those changes aren't allowed.",
  INVALID_TITLE: "Give the tournament a name (up to 60 characters).",
  INVALID_MAX_BET: "Max bet must be at least $1 and no more than the bankroll.",
  INVALID_BANKROLL: "Bankroll must be between $1 and $1,000,000.",
  BANKROLL_LOCKED: "The bankroll can't change once friends have joined.",
  INVALID_RULES: "Allow at least one bet type.",
  CANNOT_REMOVE_HOST: "The host can't be removed.",
  PLAYER_NOT_FOUND: "That player already left.",
  INVALID_MIN_BETS: "Minimum bets must be between 0 and 20.",
  HOST_CANNOT_LEAVE: "You're the host. Delete the tournament instead.",
  TOKENS_LOCKED: "Tokens can't change once someone has placed a bet.",
  INVALID_TOKENS:
    "Tokens must be 2 to 10 whole-dollar amounts that add up to the bankroll, with no more bets required than tokens and no token over the max bet.",
  INVALID_STATUS_CHANGE: "That tournament can't move to that stage.",
  // slip
  INVALID_SLIP: "Your slip is empty.",
  MISSING_STAKE: "Enter a stake for every pick.",
  INVALID_AMOUNT: "Minimum bet is $1.",
  OVER_MAX_BET: "That's over this tournament's max bet.",
  HOUSE_RULE_MIN_BETS: "House rules: this tournament needs more bets. Add picks until you reach the minimum.",
  TOKEN_NOT_AVAILABLE: "Token mode: each bet has to be one of your tokens, and each token only once.",
  HOUSE_RULE_ALL_IN: "House rules: bet your whole bankroll. Raise your stakes until nothing is left.",
  LEAVES_TOO_LITTLE:
    "That leaves too little to make the minimum number of bets this tournament requires. Bet a bit less.",
  INSUFFICIENT_BANKROLL: "Not enough bankroll for that slip.",
  MARKET_NOT_ALLOWED: "The host turned that bet type off.",
  PARLAYS_DISABLED: "The host turned parlays off.",
  TOO_FEW_LEGS: "A parlay needs at least 2 picks.",
  TOO_MANY_LEGS: "Too many legs for this tournament's parlay limit.",
  SAME_EVENT_PARLAY: "This tournament allows one pick per game in a parlay.",
  CONFLICTING_LEGS: "Those picks overlap. A parlay gets one pick per game line and per player stat.",
  ODDS_UNAVAILABLE: "That line was pulled. Remove it and pick again.",
  INVALID_SELECTION: "That game isn't part of this tournament.",
  EVENT_STARTED: "That game already started.",
  ODDS_STALE: "Odds are refreshing. Try again in a minute.",
  ODDS_CHANGED: "Odds moved. Review the new prices and accept to continue.",
  WAGER_NOT_FOUND: "That bet no longer exists.",
  WAGER_SETTLED: "That bet is already settled, so it can't be cancelled.",
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
