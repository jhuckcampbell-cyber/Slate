/** Display helpers for the sweat view (live chances, graded bets, scores). */
import { PROP_STAT_LABELS, formatCents, shortTeam } from "./format";

export function formatChance(p: number | null): string {
  if (p === null) return "–";
  const pct = Math.round(p * 100);
  if (pct >= 100) return ">99%";
  if (pct <= 0) return "<1%";
  return `${pct}%`;
}

export type Tone = "win" | "loss" | "muted" | "live";

export function wagerOutcome(w: { status: string; payoutCents: number | null; winProbability: number | null }): {
  label: string;
  tone: Tone;
} {
  switch (w.status) {
    case "won":
      return { label: `Won ${formatCents(w.payoutCents ?? 0)}`, tone: "win" };
    case "lost":
      return { label: "Lost", tone: "loss" };
    case "pushed":
    case "void":
      return { label: `Push · ${formatCents(w.payoutCents ?? 0)} back`, tone: "muted" };
    default:
      return { label: `${formatChance(w.winProbability)} to cash`, tone: "live" };
  }
}

export type ScoredEvent = {
  home_team: string;
  away_team: string;
  commence_time: string;
  status?: string | null;
  home_score?: number | null;
  away_score?: number | null;
};

/**
 * A prop pick's live number during the game (from the box score): "18 Pts · needs 8 more", "28 Pts · went over".
 * Graded picks just show the number. Game lines and picks without a number yet: null.
 */
export function propProgress(leg: {
  marketKey: string;
  selection: string;
  line: number | null;
  status: string;
  liveStat: number | null;
}): { text: string; tone: Tone } | null {
  if (leg.marketKey === "player_anytime_td" && leg.liveStat !== null) {
    const tds = leg.liveStat;
    const now = tds === 1 ? "1 TD" : `${tds} TDs`;
    if (leg.status !== "pending") return { text: now, tone: "muted" };
    return tds >= 1 ? { text: `${now} · scored`, tone: "win" } : { text: "No TD yet", tone: "live" };
  }
  const unit = PROP_STAT_LABELS[leg.marketKey];
  if (leg.liveStat === null || !unit) return null;
  const stat = leg.liveStat;
  const now = `${stat} ${unit}`;
  if (leg.status !== "pending" || leg.line === null) return { text: now, tone: "muted" };
  if (leg.selection === "Over") {
    if (stat > leg.line) return { text: `${now} · cleared`, tone: "win" };
    return { text: `${now} · needs ${Math.floor(leg.line) + 1 - stat} more`, tone: "live" };
  }
  if (leg.selection === "Under") {
    if (stat > leg.line) return { text: `${now} · went over`, tone: "loss" };
    const spare = Math.ceil(leg.line) - 1 - stat; // the most he can still add and stay under
    if (spare < 0) return { text: `${now} · on the line`, tone: "muted" };
    return { text: `${now} · ${spare} to spare`, tone: "live" };
  }
  return null;
}

/**
 * Props with a line (yards, receptions, points…): where the player is against the line, for a yard-marker bar.
 * fill = stat / line (capped at 1); the tick at the bar's end is the line. null before the market has a line
 * (anytime TD) or for non-prop legs. current is null until the box score has the player.
 */
export function propMeter(leg: {
  marketKey: string;
  selection: string;
  line: number | null;
  liveStat: number | null;
}): { current: number | null; line: number; unit: string; fill: number; tone: Tone } | null {
  const unit = PROP_STAT_LABELS[leg.marketKey];
  if (!unit || leg.line === null || leg.line <= 0 || (leg.selection !== "Over" && leg.selection !== "Under")) return null;
  const current = leg.liveStat;
  const fill = current === null ? 0 : Math.min(1, Math.max(0, current / leg.line));
  const over = current !== null && current > leg.line;
  const tone: Tone = !over ? "live" : leg.selection === "Over" ? "win" : "loss";
  return { current, line: leg.line, unit, fill, tone };
}

export type LiveFeed = {
  state: string;
  home_score?: number | null;
  away_score?: number | null;
  detail?: string | null;
  situation?: string | null;
  last_play?: string | null;
};

export type GameView = {
  state: "pre" | "in" | "post";
  away: { name: string; score: number | null; leading: boolean };
  home: { name: string; score: number | null; leading: boolean };
  detail: string | null;
  situation: string | null;
  lastPlay: string | null;
};

/** One game's live card: the free live feed (score, clock, last play) when we have it; the official final wins. */
export function gameView(e: ScoredEvent, live: LiveFeed | null): GameView {
  const official = e.status === "final";
  const useLive = live !== null && !official;
  const home = useLive ? (live.home_score ?? e.home_score ?? null) : (e.home_score ?? null);
  const away = useLive ? (live.away_score ?? e.away_score ?? null) : (e.away_score ?? null);
  const state: GameView["state"] = official
    ? "post"
    : useLive && (live.state === "in" || live.state === "post")
      ? live.state
      : home !== null && away !== null
        ? "in"
        : "pre";
  const both = home !== null && away !== null;
  return {
    state,
    away: { name: shortTeam(e.away_team), score: away, leading: both && away > home },
    home: { name: shortTeam(e.home_team), score: home, leading: both && home > away },
    detail: official ? "Final" : useLive ? (live.detail ?? null) : null,
    situation: useLive && state === "in" ? (live.situation ?? null) : null,
    lastPlay: useLive && state === "in" ? (live.last_play ?? null) : null,
  };
}

/**
 * A totals pick against the line, for the picks dropdown: "120 points · needs 99 more", "120 points · 98 to spare",
 * and once final "Final: 239 points". `fill` is points / line (0…1) for the bar; the line is the bar's end tick.
 */
export function totalProgress(p: {
  selection: string;
  line: number | null;
  home: number | null;
  away: number | null;
  final: boolean;
}): { points: number; text: string; fill: number; tone: Tone } | null {
  if (p.line === null || p.home === null || p.away === null || p.line <= 0) return null;
  if (p.selection !== "Over" && p.selection !== "Under") return null;
  const points = p.home + p.away;
  const fill = Math.min(1, points / p.line);
  const over = points > p.line;
  const won = p.selection === "Over" ? over : !over;
  if (p.final) return { points, text: `Final: ${points} points`, fill, tone: won ? "win" : "loss" };
  if (p.selection === "Over") {
    if (over) return { points, text: `${points} points · cleared`, fill, tone: "win" };
    return { points, text: `${points} points · needs ${Math.floor(p.line) + 1 - points} more`, fill, tone: "live" };
  }
  if (over) return { points, text: `${points} points · went over`, fill, tone: "loss" };
  return { points, text: `${points} points · ${Math.ceil(p.line) - 1 - points} to spare`, fill, tone: "live" };
}
