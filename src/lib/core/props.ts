/**
 * Player-prop catalog. MIRRORS private.prop_markets (migration 0010): the DB is what enforces it;
 * this is what the board and slip show. Pure and runtime-agnostic.
 */

const BASKETBALL = ["player_points", "player_rebounds", "player_assists"] as const;
const FOOTBALL = ["player_pass_yds", "player_rush_yds", "player_reception_yds"] as const;

export function propMarkets(sportKey: string): string[] {
  if (sportKey.startsWith("basketball")) return [...BASKETBALL];
  if (sportKey.startsWith("americanfootball")) return [...FOOTBALL];
  return [];
}

export function isPropMarket(marketKey: string): boolean {
  return marketKey.startsWith("player_");
}

/** Everything bettable in a tournament: the game markets, plus the sport's props if enabled. */
export function tournamentMarkets(sportKey: string, gameMarkets: readonly string[], playerProps: boolean): string[] {
  return [...gameMarkets, ...(playerProps ? propMarkets(sportKey) : [])];
}

/** Prop lines the host still has to grade: pending picks on games that are final, one per line. */
export function propLinesToGrade(
  legs: readonly { eventId: string; marketKey: string; participantName: string; status: string }[],
  finalEventIds: ReadonlySet<string>,
): { eventId: string; marketKey: string; player: string }[] {
  const seen = new Map<string, { eventId: string; marketKey: string; player: string }>();
  for (const l of legs) {
    if (!isPropMarket(l.marketKey) || l.status !== "pending" || !finalEventIds.has(l.eventId)) continue;
    const key = `${l.eventId}|${l.marketKey}|${l.participantName}`;
    if (!seen.has(key)) seen.set(key, { eventId: l.eventId, marketKey: l.marketKey, player: l.participantName });
  }
  return [...seen.values()];
}
