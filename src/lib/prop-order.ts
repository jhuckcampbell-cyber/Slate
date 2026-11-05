/**
 * Player-prop list order and search. Pure.
 * Order: the likeliest first. Anytime scorers and alternate ladders go by their best price's chance (favorite at the
 * top, long shots at the bottom); over/under props go by the line, so the stars (biggest numbers) lead.
 * Ties fall back to the name so the list never jumps around.
 */
import { isAlternateMarket } from "./core/props";
import { impliedChance } from "./plain-english";

type PropRow = { participantName: string; outcomeName: string; point: number | null; priceAmerican: number };

export function orderPlayers(rows: readonly PropRow[], marketKey: string): string[] {
  const byChance = marketKey === "player_anytime_td" || isAlternateMarket(marketKey);
  const best = new Map<string, number>();
  for (const row of rows) {
    const score = byChance ? impliedChance(row.priceAmerican) : (row.point ?? 0);
    best.set(row.participantName, Math.max(best.get(row.participantName) ?? Number.NEGATIVE_INFINITY, score));
  }
  return [...best.keys()].sort((a, b) => best.get(b)! - best.get(a)! || a.localeCompare(b));
}

/** Every word typed must appear in the player's name or team, in any order. */
export function matchesQuery(player: string, team: string | null, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${player} ${team ?? ""}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}
