/**
 * Live game updates (score, clock, down & distance, last play) from ESPN's public scoreboard: one free call per sport
 * and date covers every game, no Odds API credits. Display only: grading still comes from the Odds API's scores.
 * Unofficial and not licensed for commercial use (see stats.ts). PURE: the Edge Function fetches, this maps.
 */
import { eventStatus } from "./event-status.ts";
import { espnDate } from "./stats.ts";

const PATHS: Record<string, string> = {
  basketball_nba: "basketball/nba",
  basketball_ncaab: "basketball/mens-college-basketball",
  americanfootball_ncaaf: "football/college-football",
  americanfootball_nfl: "football/nfl",
};

export const LIVE_SPORTS = Object.keys(PATHS);

export function espnLiveUrl(sportKey: string, commenceIso: string): string | null {
  const path = PATHS[sportKey];
  const college = sportKey === "americanfootball_ncaaf" || sportKey === "basketball_ncaab";
  // ESPN otherwise defaults college scoreboards to ranked teams only.
  const coverage = college ? "&groups=80&limit=1000" : "";
  return path ? `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDate(commenceIso)}${coverage}` : null;
}

export type LiveGame = {
  event_id: string;
  status?: string;
  status_reason?: string;
  clock_seconds?: number;
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

const normalizedTeam = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function matchesTeam(team: Obj, name: string, college: boolean): boolean {
  if (!college) return nickname(String(team.displayName ?? "")) === nickname(name);
  const ours = normalizedTeam(name);
  return [team.displayName, team.location, team.shortDisplayName].some((value) => {
    if (typeof value !== "string") return false;
    const theirs = normalizedTeam(value);
    return !!theirs && (ours === theirs || ours.startsWith(`${theirs} `) || theirs.startsWith(`${ours} `));
  });
}

export function liveGamesFromScoreboard(
  scoreboard: unknown,
  ours: { event_id: string; home_team: string; away_team: string }[],
  sportKey = "basketball_nba",
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
        matchesTeam(obj(home.team), g.home_team, sportKey === "basketball_ncaab" || sportKey === "americanfootball_ncaaf") &&
        matchesTeam(obj(away.team), g.away_team, sportKey === "basketball_ncaab" || sportKey === "americanfootball_ncaaf"),
    );
    if (!game) continue;
    const status = obj(c.status);
    const type = obj(status.type);
    const eventState = eventStatus(type.name) ?? eventStatus(type.description) ?? eventStatus(type.shortDetail);
    const displayClock = text(status.displayClock)?.match(/^(\d{1,2}):([0-5]\d)$/);
    const seconds = typeof status.clock === "number" ? status.clock
      : displayClock ? Number(displayClock[1]) * 60 + Number(displayClock[2]) : null;
    const state = type.state === "in" || type.state === "post" ? type.state : "pre";
    const situation = obj(c.situation);
    out.push({
      ...eventState,
      ...(eventState ? { status_reason: text(type.detail) ?? text(type.description) ?? eventState.status_reason } : {}),
      ...(seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? { clock_seconds: seconds } : {}),
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

/** Local dev (fake odds): a deterministic in-game feed with sport-specific game lengths and regulation periods. */
export function fakeLiveGames(
  events: { event_id: string; home_team: string; away_team: string; commence_time: string }[],
  sportKey: string,
  nowMs: number,
): LiveGame[] {
  const collegeBasketball = sportKey === "basketball_ncaab";
  const football = sportKey === "americanfootball_nfl" || sportKey === "americanfootball_ncaaf";
  const periods = collegeBasketball ? 2 : 4;
  const GAME_MS = (collegeBasketball ? 130 : sportKey === "americanfootball_ncaaf" ? 210 : 150) * 60_000;
  const periodMinutes = collegeBasketball ? 20 : football ? 15 : 12;
  return events.map((e) => {
    const t = (nowMs - Date.parse(e.commence_time)) / GAME_MS;
    if (t < 0) return { event_id: e.event_id, state: "pre", home_score: null, away_score: null, period: 0, detail: null, situation: null, last_play: null };
    const p = Math.min(1, t);
    const full = collegeBasketball ? 72 : football ? 27 : 112;
    const score = (side: string) => Math.floor(p * (full * 0.8 + ((side.length * 7) % Math.round(full * 0.4))));
    if (t >= 1) {
      return { event_id: e.event_id, state: "post", home_score: score(e.home_team), away_score: score(e.away_team), period: periods, detail: "Final", situation: null, last_play: null };
    }
    const period = Math.min(periods, Math.floor(p * periods) + 1);
    const left = Math.round((1 - (p * periods - (period - 1))) * periodMinutes * 60);
    const plays = FAKE_PLAYS[football ? "americanfootball_nfl" : "basketball_nba"]!;
    return {
      event_id: e.event_id,
      state: "in",
      home_score: score(e.home_team),
      away_score: score(e.away_team),
      period,
      detail: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} - ${ORDINAL[period - 1]}${collegeBasketball ? " half" : ""}`,
      situation: football ? "1st & 10 at midfield" : null,
      last_play: plays[Math.floor(p * 40) % plays.length]!,
    };
  });
}
