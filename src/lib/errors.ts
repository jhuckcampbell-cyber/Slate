/** Maps stable RPC error codes (raised in SQL) to user-facing copy. */
const MESSAGES: Record<string, string> = {
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
