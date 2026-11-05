/**
 * Live game updates (score, clock, down & distance, last play) from ESPN's public scoreboard: one free call per sport
 * and date covers every game, no Odds API credits. Display only: grading still comes from the Odds API's scores.
 * Unofficial and not licensed for commercial use (see stats.ts). PURE: the Edge Function fetches, this maps.
 */
import { espnDate } from "./stats.ts";

const PATHS: Record<string, string> = {
  basketball_nba: "basketball/nba",
  americanfootball_nfl: "football/nfl",
};

export const LIVE_SPORTS = Object.keys(PATHS);

export function espnLiveUrl(sportKey: string, commenceIso: string): string | null {
  const path = PATHS[sportKey];
  return path ? `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDate(commenceIso)}` : null;
}

export type LiveGame = {
  event_id: string;
  state: "pre" | "in" | "post";
  home_score: number | null;
  away_score: number | null;
  period: number | null;
  detail: string | null;
  situation: string | null;
  last_play: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : null;
};
/** "Los Angeles Clippers" and "LA Clippers" are the same team: compare nicknames. */
export const nickname = (team: string) => team.trim().toLowerCase().split(/\s+/).pop() ?? "";

export function liveGamesFromScoreboard(
  scoreboard: unknown,
  ours: { event_id: string; home_team: string; away_team: string }[],
): LiveGame[] {
  const out: LiveGame[] = [];
  for (const e of arr(obj(scoreboard).events)) {
    const c = obj(arr(obj(e).competitions)[0]);
    const competitors = arr(c.competitors).map(obj);
    const side = (homeAway: string) => competitors.find((x) => x.homeAway === homeAway) ?? {};
    const home = side("home");
    const away = side("away");
    const game = ours.find(
      (g) =>
        nickname(String(obj(home.team).displayName ?? "")) === nickname(g.home_team) &&
        nickname(String(obj(away.team).displayName ?? "")) === nickname(g.away_team),
    );
    if (!game) continue;
    const status = obj(c.status);
    const type = obj(status.type);
    const state = type.state === "in" || type.state === "post" ? type.state : "pre";
    const situation = obj(c.situation);
    out.push({
      event_id: game.event_id,
      state,
      home_score: state === "pre" ? null : int(home.score),
      away_score: state === "pre" ? null : int(away.score),
      period: int(status.period),
      detail: text(type.shortDetail),
      situation: state === "in" ? text(situation.downDistanceText) : null,
      last_play: state === "in" ? text(obj(situation.lastPlay).text) : null,
    });
  }
  return out;
}

const ORDINAL = ["1st", "2nd", "3rd", "4th"];
const FAKE_PLAYS = {
  basketball_nba: ["Step-back three from the wing", "Driving layup, and one!", "Defensive rebound, pushing in transition", "Alley-oop slam"],
  americanfootball_nfl: ["Pass complete over the middle for 14 yards", "Run up the gut for 6 yards", "Sacked at the 38", "Field goal is good from 41"],
} as Record<string, string[]>;

/** Local dev (fake odds): a deterministic in-game feed over a 2.5h game, 4 periods. */
export function fakeLiveGames(
  events: { event_id: string; home_team: string; away_team: string; commence_time: string }[],
  sportKey: string,
  nowMs: number,
): LiveGame[] {
  const GAME_MS = 2.5 * 3_600_000;
  const periodMinutes = sportKey === "basketball_nba" ? 12 : 15;
  return events.map((e) => {
    const t = (nowMs - Date.parse(e.commence_time)) / GAME_MS;
    if (t < 0) return { event_id: e.event_id, state: "pre", home_score: null, away_score: null, period: 0, detail: null, situation: null, last_play: null };
    const p = Math.min(1, t);
    const full = sportKey === "basketball_nba" ? 112 : 24;
    const score = (side: string) => Math.floor(p * (full * 0.8 + ((side.length * 7) % Math.round(full * 0.4))));
    if (t >= 1) {
      return { event_id: e.event_id, state: "post", home_score: score(e.home_team), away_score: score(e.away_team), period: 4, detail: "Final", situation: null, last_play: null };
    }
    const period = Math.min(4, Math.floor(p * 4) + 1);
    const left = Math.round((1 - (p * 4 - (period - 1))) * periodMinutes * 60);
    const plays = FAKE_PLAYS[sportKey] ?? ["Big play"];
    return {
      event_id: e.event_id,
      state: "in",
      home_score: score(e.home_team),
      away_score: score(e.away_team),
      period,
      detail: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} - ${ORDINAL[period - 1]}`,
      situation: sportKey === "americanfootball_nfl" ? "1st & 10 at midfield" : null,
      last_play: plays[Math.floor(p * 40) % plays.length]!,
    };
  });
}
