/**
 * Live NBA player stats from ESPN's public game feed (site.api.espn.com: no key, no Odds API credits).
 * Unofficial and not licensed for commercial use: fine for the friends beta, replace with a licensed feed
 * before Slate makes money. PURE: the Edge Function fetches, this finds the game and maps the box score.
 */
import { hash } from "./fake-provider.ts";

const ESPN_NBA = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export type PlayerStat = { name: string; team: string | null; market_key: string; stat: number };
export type BoxStats = { final: boolean; stats: PlayerStat[] };

/** ESPN box score column → our prop market. */
const MARKETS: Record<string, string> = {
  points: "player_points",
  rebounds: "player_rebounds",
  assists: "player_assists",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "player_threes",
};

/** The feed files games by US Eastern date (a 7:30 PM ET tip is already "tomorrow" in UTC). */
export function espnDate(commenceIso: string): string {
  return new Date(commenceIso)
    .toLocaleDateString("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .replaceAll("-", "");
}

export const espnScoreboardUrl = (commenceIso: string) => `${ESPN_NBA}/scoreboard?dates=${espnDate(commenceIso)}`;
export const espnSummaryUrl = (gameId: string) => `${ESPN_NBA}/summary?event=${encodeURIComponent(gameId)}`;

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

/** A game summary's box score → one row per player per stat we offer props on. */
export function espnBoxToStats(summary: unknown): BoxStats {
  const status = obj(obj(obj(arr(obj(obj(summary).header).competitions)[0]).status).type);
  const final = status.state === "post" || status.completed === true;
  const stats: PlayerStat[] = [];
  for (const teamBox of arr(obj(obj(summary).boxscore).players).map(obj)) {
    const team = String(obj(teamBox.team).displayName ?? "") || null;
    for (const group of arr(teamBox.statistics).map(obj)) {
      const keys = arr(group.keys).map(String);
      for (const a of arr(group.athletes).map(obj)) {
        const name = String(obj(a.athlete).displayName ?? "");
        const values = arr(a.stats).map(String);
        if (!name || a.didNotPlay === true || values.length === 0) continue;
        keys.forEach((key, i) => {
          const market = MARKETS[key];
          const stat = parseInt(values[i] ?? "", 10); // "2-3" (made-attempted) → 2
          if (market && Number.isFinite(stat) && stat >= 0) stats.push({ name, team, market_key: market, stat });
        });
      }
    }
  }
  return { final, stats };
}

const GAME_MS = 2.5 * 3_600_000;

/** Local dev (fake odds): a deterministic box score that grows through a 2.5h game for the players picked. */
export function fakeBoxStats(players: { name: string; market_key: string }[], tipMs: number, nowMs: number): BoxStats {
  const progress = Math.min(1, Math.max(0, (nowMs - tipMs) / GAME_MS));
  const full: Record<string, number> = { player_points: 34, player_rebounds: 14, player_assists: 11, player_threes: 6 };
  return {
    final: nowMs - tipMs >= GAME_MS,
    stats: players.map((p) => ({
      name: p.name,
      team: null,
      market_key: p.market_key,
      stat: Math.floor(progress * (4 + (hash(`${p.name}|${p.market_key}`) % (full[p.market_key] ?? 10)))),
    })),
  };
}
