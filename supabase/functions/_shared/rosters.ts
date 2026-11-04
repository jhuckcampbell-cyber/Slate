/**
 * Which team each player is on. The Odds API names players but not their teams, so the props board
 * gets rosters from Sleeper's public player list (GET https://api.sleeper.app/v1/players/nfl, no key,
 * ~5MB, at most once a day per their docs; free for NON-COMMERCIAL use only: replace with a licensed
 * feed before Slate makes money). PURE: the Edge Function fetches, this maps.
 */

export const SLEEPER_NFL_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

/** Sleeper abbreviation → the Odds API's full team name (what events.home_team/away_team use). */
export const NFL_TEAMS: Record<string, string> = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

export type RosterEntry = { name: string; team: string };

/** Sleeper's all-players object → [{ name, team }] for rostered players (no free agents or team defenses). */
export function sleeperToRoster(json: unknown): RosterEntry[] {
  if (!json || typeof json !== "object") return [];
  const out: RosterEntry[] = [];
  for (const p of Object.values(json as Record<string, unknown>)) {
    if (!p || typeof p !== "object") continue;
    const { first_name, last_name, team, position } = p as Record<string, unknown>;
    if (typeof first_name !== "string" || typeof last_name !== "string" || typeof team !== "string") continue;
    if (position === "DEF") continue; // "Ravens D/ST" props are matched by name in the database
    const full = NFL_TEAMS[team];
    if (full) out.push({ name: `${first_name} ${last_name}`.trim(), team: full });
  }
  return out;
}
