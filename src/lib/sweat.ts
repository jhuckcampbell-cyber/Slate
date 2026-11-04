/** Display helpers for the sweat view (live chances, graded bets, scores). */
import { formatCents, shortTeam } from "./format";

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
