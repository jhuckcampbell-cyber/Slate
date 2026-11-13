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

// ---- College football (ESPN) ----
// Sleeper has no college players. ESPN's free site API has each team's roster; the scoreboard gives the team ids.
// Same non-commercial caveat as the rest of the ESPN feeds.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nickname = (team: string) => team.trim().toLowerCase().split(/\s+/).pop() ?? "";

export const espnCollegeRosterUrl = (teamId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${encodeURIComponent(teamId)}/roster`;

/** ESPN team ids for both sides of our game (matched by nickname, like findEspnGame), or null. */
export function espnGameTeamIds(
  scoreboard: unknown,
  game: { home_team: string; away_team: string },
): { home: string; away: string } | null {
  for (const e of arr(obj(scoreboard).events)) {
    const comps = arr(obj(arr(obj(e).competitions)[0]).competitors).map(obj);
    const side = (homeAway: string) => comps.find((c) => c.homeAway === homeAway)?.team;
    const home = obj(side("home")), away = obj(side("away"));
    if (nickname(String(home.displayName ?? "")) === nickname(game.home_team)
      && nickname(String(away.displayName ?? "")) === nickname(game.away_team) && home.id && away.id) {
      return { home: String(home.id), away: String(away.id) };
    }
  }
  return null;
}

/** ESPN team roster (athletes grouped by offense/defense/special teams, or flat) -> [{ name, team }]. */
export function espnRosterToPlayers(json: unknown, team: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const g of arr(obj(json).athletes).map(obj)) {
    for (const a of (Array.isArray(g.items) ? arr(g.items) : [g]).map(obj)) {
      const name = String(a.displayName ?? a.fullName ?? "").trim();
      if (name) out.push({ name, team });
    }
  }
  return out;
}
