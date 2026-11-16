/**
 * Team name forms. PURE TS, no deps (importable by Edge Functions).
 * full "Oklahoma City Thunder" · short "Thunder" · place "Oklahoma City" · abbr "OKC".
 * Unknown teams (other sports) fall back to a last-word heuristic.
 */
export type Team = { full: string; short: string; place: string; abbr: string };

import { lookupTeam, TEAMS } from "./teams/registry";
const ABBR: Record<string, string> = Object.fromEntries(TEAMS.map(t => [t.name, t.abbr]));

/** Nicknames that are more than the last word. */
const NICKNAME: Record<string, string> = {
  "Portland Trail Blazers": "Trail Blazers",
  "Toronto Maple Leafs": "Maple Leafs",
  "Detroit Red Wings": "Red Wings",
  "Columbus Blue Jackets": "Blue Jackets",
  "Vegas Golden Knights": "Golden Knights",
  "Chicago White Sox": "White Sox",
  "Boston Red Sox": "Red Sox",
  "Toronto Blue Jays": "Blue Jays",
};

export function getTeam(full: string, sportKey?: string): Team {
  full = lookupTeam(full, sportKey)?.name ?? full;
  const nick = NICKNAME[full] ?? full.split(" ").pop() ?? full;
  const place = full.endsWith(nick) ? full.slice(0, full.length - nick.length).trim() : "";
  const abbr = ABBR[full] ?? (place || full).replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  return { full, short: nick, place: place || full, abbr };
}

export type TeamForm = "full" | "short" | "place" | "abbr";

export function teamLabel(full: string, form: TeamForm = "short"): string {
  return getTeam(full)[form];
}

/** "BOS @ NYK" for tight rows. */
export function compactMatchup(away: string, home: string): string {
  return `${getTeam(away).abbr} @ ${getTeam(home).abbr}`;
}
