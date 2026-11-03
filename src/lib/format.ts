/** Display helpers. Money is always integer cents in storage (CLAUDE.md rule 4). */

export function formatCents(cents: number, opts: { showCents?: boolean } = {}): string {
  const showCents = opts.showCents ?? cents % 100 !== 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

/** Whole-dollar input → cents; returns null for invalid input. */
export function dollarsToCents(input: string): number | null {
  const n = Number(input.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

const SPORT_LABELS: Record<string, string> = {
  americanfootball_nfl: "NFL",
  americanfootball_ncaaf: "NCAAF",
  basketball_nba: "NBA",
  basketball_ncaab: "NCAAB",
  baseball_mlb: "MLB",
  icehockey_nhl: "NHL",
};

export function sportLabel(sportKey: string): string {
  return SPORT_LABELS[sportKey] ?? sportKey.split("_").pop()?.toUpperCase() ?? sportKey;
}

export function sportEmoji(sportKey: string): string {
  if (sportKey.startsWith("americanfootball")) return "🏈";
  if (sportKey.startsWith("basketball")) return "🏀";
  if (sportKey.startsWith("baseball")) return "⚾";
  if (sportKey.startsWith("icehockey")) return "🏒";
  return "🏆";
}

/** Kickoff/lock times. Pass timeZone on the server (e.g. OG images) where the viewer TZ is unknown. */
export function formatKickoff(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: timeZone ? "short" : undefined,
  });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** "2d 3h", "3h 14m", "4m 09s" */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function matchupLabel(e: { away_team: string; home_team: string }): string {
  return `${e.away_team} @ ${e.home_team}`;
}

/** "Boston Celtics" → "Celtics"; "San Francisco 49ers" → "49ers". */
export function shortTeam(name: string): string {
  return name.split(" ").pop() ?? name;
}

export function formatAmerican(price: number): string {
  return price > 0 ? `+${price}` : String(price);
}

/** Spread line: -3.5, +7, PK. */
export function formatSpread(point: number | null): string {
  if (point === null) return "";
  if (point === 0) return "PK";
  return point > 0 ? `+${trimPoint(point)}` : trimPoint(point);
}

function trimPoint(point: number): string {
  return String(Number(point.toFixed(2)));
}

export const MARKET_LABELS: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};

/** Human label for a pick: "Celtics -7", "Knicks ML", "Over 230.5". */
export function selectionLabel(sel: {
  marketKey: string;
  outcomeName: string;
  point: number | null;
  participantName?: string;
}): string {
  switch (sel.marketKey) {
    case "h2h":
      return `${shortTeam(sel.outcomeName)} ML`;
    case "spreads":
      return `${shortTeam(sel.outcomeName)} ${formatSpread(sel.point)}`;
    case "totals":
      return `${sel.outcomeName} ${sel.point === null ? "" : trimPoint(sel.point)}`.trim();
    default:
      return [sel.participantName, sel.outcomeName, sel.point === null ? "" : trimPoint(sel.point)]
        .filter(Boolean)
        .join(" ");
  }
}
