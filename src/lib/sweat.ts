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

export function scoreLine(e: ScoredEvent): { text: string; state: "Final" | "Live" } | null {
  if (e.home_score == null || e.away_score == null) return null;
  return {
    text: `${shortTeam(e.away_team)} ${e.away_score} · ${shortTeam(e.home_team)} ${e.home_score}`,
    state: e.status === "final" ? "Final" : "Live",
  };
}

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

/** Tension at a glance for an open bet or leg: Safe (80%+), Danger (20% or less), else Sweating. */
export function sweatTag(p: number | null): { label: "Safe" | "Sweating" | "Danger"; tone: Tone } | null {
  if (p === null) return null;
  if (p >= 0.8) return { label: "Safe", tone: "win" };
  if (p <= 0.2) return { label: "Danger", tone: "loss" };
  return { label: "Sweating", tone: "live" };
}
