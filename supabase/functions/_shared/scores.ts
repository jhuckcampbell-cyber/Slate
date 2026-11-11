/**
 * Scores: The Odds API v4 /scores shape → what public.scores_ingest takes, plus a deterministic
 * fake provider for local dev/CI (ODDS_PROVIDER=fake). PURE and runtime-agnostic.
 * Docs: https://the-odds-api.com/liveapi/guides/v4/#get-scores
 */
import { hash, type FakeEventInput } from "./fake-provider.ts";

export type ApiScoreEvent = {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
};

export type ScoreRow = { event_id: string; completed: boolean; home_score: number; away_score: number; provider_updated_at?: string | null };

export function normalizeScores(events: readonly ApiScoreEvent[], onlyIds?: readonly string[]): ScoreRow[] {
  const keep = onlyIds ? new Set(onlyIds) : null;
  const out: ScoreRow[] = [];
  for (const e of events) {
    if (keep && !keep.has(e.id)) continue;
    const score = (team: string) => {
      const raw = e.scores?.find((s) => s.name === team)?.score;
      if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
      return Number(raw);
    };
    const home = score(e.home_team);
    const away = score(e.away_team);
    if (home === null || away === null) continue;
    out.push({ event_id: e.id, completed: e.completed, home_score: home, away_score: away, ...(e.last_update ? { provider_updated_at: e.last_update } : {}) });
  }
  return out;
}

// Game length (minutes) and typical points per team, matching private.sport_model.
const GAME: Record<string, { minutes: number; points: number; spread: number }> = {
  americanfootball_nfl: { minutes: 190, points: 22, spread: 10 },
  americanfootball_ncaaf: { minutes: 210, points: 27, spread: 14 },
  basketball_nba: { minutes: 150, points: 112, spread: 12 },
  basketball_ncaab: { minutes: 130, points: 72, spread: 12 },
};
const DEFAULT_GAME = { minutes: 180, points: 20, spread: 8 };

/** Deterministic fake /scores: final scores hashed from the event id, revealed linearly over the game. */
export function fakeScoresResponse(events: readonly FakeEventInput[], opts: { nowMs: number }): ApiScoreEvent[] {
  return events.map((e) => {
    const g = GAME[e.sport_key] ?? DEFAULT_GAME;
    const startMs = Date.parse(e.commence_time);
    const progress = (opts.nowMs - startMs) / (g.minutes * 60_000);
    const base = { ...e, sport_title: e.sport_title ?? undefined, last_update: null };
    if (progress < 0) return { ...base, completed: false, scores: null };

    const h = hash(e.id);
    const homeFinal = g.points + ((h % (2 * g.spread + 1)) - g.spread);
    let awayFinal = g.points + (((h >>> 8) % (2 * g.spread + 1)) - g.spread);
    if (awayFinal === homeFinal) awayFinal += 3; // no ties
    const share = Math.min(progress, 1);
    return {
      ...base,
      completed: progress >= 1,
      last_update: new Date(opts.nowMs).toISOString(),
      scores: [
        { name: e.home_team, score: String(Math.floor(homeFinal * share)) },
        { name: e.away_team, score: String(Math.floor(awayFinal * share)) },
      ],
    };
  });
}

/** /scores?daysFrom=N costs 2 credits (1 without daysFrom, which omits finished games). */
export const SCORES_CALL_COST = 2;
