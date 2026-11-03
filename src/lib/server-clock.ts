/**
 * A clock that follows the database's time (CLAUDE.md rule 5), corrected for this device's skew.
 * `serverNowIso` is the DB's now() as of the page render; network latency only makes the clock run
 * slightly behind, so a countdown refreshes at or just after the real lock, never early.
 */
export function createServerClock(serverNowIso: string, deviceNow: () => number = Date.now): () => number {
  const offset = Date.parse(serverNowIso) - deviceNow();
  return () => deviceNow() + offset;
}
