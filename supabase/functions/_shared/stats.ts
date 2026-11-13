/**
 * Live player stats from ESPN's public game feed (site.api.espn.com: no key, no Odds API credits), NBA and NFL.
 * Unofficial and not licensed for commercial use: fine for the friends beta, replace with a licensed feed
 * before Slate makes money. PURE: the Edge Function fetches, this finds the game and maps the box score.
 */
import { hash } from "./fake-provider.ts";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

export type PlayerStat = { name: string; team: string | null; market_key: string; stat: number | null; did_not_play?: boolean; provider_player_id?: string; complete?: boolean };
/** remaining: share of the game left (1 = kickoff, 0 = over), null when the clock can't be read. */
export type BoxStats = { final: boolean; stats: PlayerStat[]; remaining: number | null };

type Sport = {
  path: string;
  periodSeconds: number;
  /** Box score column (qualified by its group, "rushing.rushingYards", or bare) -> our prop market. Columns that map
   *  to the same market add up (anytime TD = rushing + receiving + return touchdowns). */
  markets: Record<string, string>;
};

const SPORTS: Record<string, Sport> = {
  basketball_nba: {
    path: "basketball/nba",
    periodSeconds: 12 * 60,
    markets: {
      points: "player_points",
      rebounds: "player_rebounds",
      assists: "player_assists",
      "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "player_threes",
    },
  },
  americanfootball_nfl: {
    path: "football/nfl",
    periodSeconds: 15 * 60,
    markets: {
      "passing.passingYards": "player_pass_yds",
      "passing.passingTouchdowns": "player_pass_tds",
      "rushing.rushingYards": "player_rush_yds",
      "rushing.rushingTouchdowns": "player_anytime_td",
      "receiving.receptions": "player_receptions",
      "receiving.receivingYards": "player_reception_yds",
      "receiving.receivingTouchdowns": "player_anytime_td",
      "kickReturns.kickReturnTouchdowns": "player_anytime_td",
      "puntReturns.puntReturnTouchdowns": "player_anytime_td",
    },
  },
};

export const STATS_SPORTS = Object.keys(SPORTS);
const sport = (sportKey: string): Sport => SPORTS[sportKey] ?? SPORTS.basketball_nba;

/**
 * Share of a game left, from the feed's period and clock ("8:21", "0:30.4"). Four periods (12 min NBA, 15 min NFL);
 * overtime counts only its own clock.
 */
export function gameRemaining(
  status: { state?: unknown; period?: unknown; displayClock?: unknown },
  sportKey = "basketball_nba",
): number | null {
  if (status.state === "post") return 0;
  if (status.state === "pre") return 1;
  const len = sport(sportKey).periodSeconds;
  const period = Number(status.period);
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(status.displayClock ?? "")); // "8:21", or "45.3" under a minute
  if (!Number.isInteger(period) || period < 1 || !m) return null;
  const clock = Number(m[1] ?? 0) * 60 + Number(m[2]);
  const left = period <= 4 ? (4 - period) * len + clock : clock;
  return Math.min(1, Math.max(0, left / (4 * len)));
}

/** The feed files games by US Eastern date (a 7:30 PM ET tip is already "tomorrow" in UTC). */
export function espnDate(commenceIso: string): string {
  return new Date(commenceIso)
    .toLocaleDateString("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .replaceAll("-", "");
}

export const espnScoreboardUrl = (sportKey: string, commenceIso: string) =>
  `${ESPN}/${sport(sportKey).path}/scoreboard?dates=${espnDate(commenceIso)}`;
export const espnSummaryUrl = (sportKey: string, gameId: string) =>
  `${ESPN}/${sport(sportKey).path}/summary?event=${encodeURIComponent(gameId)}`;

/** "Los Angeles Clippers" and "LA Clippers" are the same team: compare nicknames. */
const nickname = (team: string) => team.trim().toLowerCase().split(/\s+/).pop() ?? "";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The feed's game id for our game (both teams must match), or null. */
export function findEspnGame(scoreboard: unknown, game: { home_team: string; away_team: string }): string | null {
  for (const e of arr(obj(scoreboard).events)) {
    const competitors = arr(obj(arr(obj(e).competitions)[0]).competitors).map(obj);
    const side = (homeAway: string) =>
      nickname(String(obj(competitors.find((c) => c.homeAway === homeAway)?.team).displayName ?? ""));
    if (side("home") === nickname(game.home_team) && side("away") === nickname(game.away_team)) {
      return String(obj(e).id);
    }
  }
  return null;
}

/** A game summary's box score -> one row per player per stat we offer props on. */
export function espnBoxToStats(summary: unknown, sportKey = "basketball_nba"): BoxStats {
  const { markets } = sport(sportKey);
  const clock = obj(obj(arr(obj(obj(summary).header).competitions)[0]).status);
  const status = obj(clock.type);
  const final = status.state === "post" || status.completed === true;
  const rows = new Map<string, PlayerStat>();
  const participation = new Map<string, PlayerStat>();
  const components = new Map<string, Set<string>>();
  for (const teamBox of arr(obj(obj(summary).boxscore).players).map(obj)) {
    const team = String(obj(teamBox.team).displayName ?? "") || null;
    for (const group of arr(teamBox.statistics).map(obj)) {
      const keys = arr(group.keys).map(String);
      for (const a of arr(group.athletes).map(obj)) {
        const name = String(obj(a.athlete).displayName ?? "");
        const values = arr(a.stats).map(String);
        const provider_player_id = String(obj(a.athlete).id ?? "");
        const identity = provider_player_id ? { provider_player_id } : {};
        const playerKey = provider_player_id || `${team}|${name}`;
        if (!name) continue;
        if (a.didNotPlay === true || values.length > 0) {
          const prior = participation.get(playerKey);
          participation.set(playerKey, { name, team, ...identity, market_key: "__participation", stat: null,
            did_not_play: prior?.did_not_play === false ? false : a.didNotPlay === true });
        }
        if (a.didNotPlay === true || values.length === 0) continue;
        keys.forEach((key, i) => {
          const market = markets[`${String(group.name ?? "")}.${key}`] ?? markets[key];
          const cell = values[i] ?? "";
          const numeric = key === "threePointFieldGoalsMade-threePointFieldGoalsAttempted"
            ? /^\d+-\d+$/.test(cell) : /^-?\d+$/.test(cell);
          const stat = numeric ? parseInt(cell, 10) : NaN; // "2-3" (made-attempted) -> 2; "-4" rushing yards stays -4
          if (!market || !Number.isFinite(stat)) return;
          const rowKey = `${playerKey}|${market}`;
          const seen = components.get(rowKey) ?? new Set<string>();
          const column = `${String(group.name ?? "")}.${key}`;
          if (seen.has(column)) return;
          seen.add(column);
          components.set(rowKey, seen);
          const row = rows.get(rowKey);
          if (row && row.stat !== null) row.stat += stat;
          else rows.set(rowKey, { name, team, ...identity, market_key: market, stat });
        });
      }
    }
  }
  for (const [rowKey, row] of rows) {
    // A composite TD count is only complete with all four explicit components.
    // Missing categories/cells never silently contribute zero.
    if (row.provider_player_id) row.complete = final &&
      (row.market_key !== "player_anytime_td" || components.get(rowKey)?.size === 4);
  }
  const remaining = final
    ? 0
    : gameRemaining({ state: status.state, period: clock.period, displayClock: clock.displayClock }, sportKey);
  return { final, stats: [...rows.values(), ...participation.values()], remaining };
}

const GAME_MS = 2.5 * 3_600_000;

/** Local dev (fake odds): a deterministic box score that grows through a 2.5h game for the players picked. */
export function fakeBoxStats(players: { name: string; market_key: string }[], tipMs: number, nowMs: number): BoxStats {
  const progress = Math.min(1, Math.max(0, (nowMs - tipMs) / GAME_MS));
  const full: Record<string, number> = {
    player_points: 34, player_rebounds: 14, player_assists: 11, player_threes: 6,
    player_pass_yds: 320, player_rush_yds: 110, player_reception_yds: 110, player_receptions: 9,
    player_pass_tds: 4, player_anytime_td: 2,
  };
  return {
    final: nowMs - tipMs >= GAME_MS,
    remaining: 1 - progress,
    stats: players.map((p) => ({
      name: p.name,
      team: null,
      market_key: p.market_key,
      stat: Math.floor(progress * (4 + (hash(`${p.name}|${p.market_key}`) % (full[p.market_key] ?? 10)))),
    })),
  };
}
