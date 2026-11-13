/**
 * Player-prop catalog. MIRRORS private.prop_markets (migration 0010): the DB is what enforces it;
 * this is what the board and slip show. Pure and runtime-agnostic.
 */

const BASKETBALL = ["player_points", "player_rebounds", "player_assists"] as const;
const FOOTBALL = [
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
] as const;

/** College football: the main stats only. No receptions, alternate ladders or passing TDs. */
const COLLEGE_FOOTBALL = ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_anytime_td"] as const;

export function propMarkets(sportKey: string): string[] {
  if (sportKey === "basketball_nba") return [...BASKETBALL];
  if (sportKey === "americanfootball_nfl") return [...FOOTBALL];
  if (sportKey === "americanfootball_ncaaf") return [...COLLEGE_FOOTBALL];
  return [];
}

export function isPropMarket(marketKey: string): boolean {
  return marketKey.startsWith("player_");
}

/** Alternate ladders (Over-only, many lines per player). */
export function isAlternateMarket(marketKey: string): boolean {
  return marketKey.endsWith("_alternate");
}

/** The stat a prop is graded on: an alternate ladder shares its main line's stat (one entry grades both). */
export function statMarket(marketKey: string): string {
  return marketKey.replace(/_alternate$/, "");
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
    const marketKey = statMarket(l.marketKey);
    const key = `${l.eventId}|${marketKey}|${l.participantName}`;
    if (!seen.has(key)) seen.set(key, { eventId: l.eventId, marketKey, player: l.participantName });
  }
  return [...seen.values()];
}

/** Box-score handler registry. Unknown sports/markets always require the host. */
export const AUTO_PROP_STATS: Readonly<Record<string, readonly string[]>> = {
  basketball_nba: [...BASKETBALL, "player_threes"],
  americanfootball_nfl: FOOTBALL.map(statMarket),
  americanfootball_ncaaf: [...COLLEGE_FOOTBALL],
};
export const HOST_GRADED_PROP_MARKETS = ["player_team_dst_td"] as const;
export function autoGradesProp(sportKey: string, marketKey: string): boolean {
  return AUTO_PROP_STATS[sportKey]?.includes(statMarket(marketKey)) ?? false;
}
