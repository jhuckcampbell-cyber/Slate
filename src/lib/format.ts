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

/** ISO → `<input type="datetime-local">` value in the viewer's time zone ("2026-11-03T18:05"). */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value (viewer's time zone) → ISO, or null if it isn't one. */
export function fromDateTimeLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value); // no offset in the string → parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
  h2h: "Winner",
  spreads: "Spread",
  totals: "Total",
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_pass_yds: "Passing yards",
  player_rush_yds: "Rushing yards",
  player_reception_yds: "Receiving yards",
  player_receptions: "Receptions",
  player_pass_yds_alternate: "Alt passing yards",
  player_rush_yds_alternate: "Alt rushing yards",
  player_reception_yds_alternate: "Alt receiving yards",
  player_receptions_alternate: "Alt receptions",
  player_pass_tds: "Passing TDs",
  player_anytime_td: "Anytime TD",
};

/** Short names for the props tabs (all tabs fit on screen, no hidden sideways scroll). */
export const PROP_TAB_LABELS: Record<string, string> = {
  player_pass_yds: "Pass yds",
  player_rush_yds: "Rush yds",
  player_reception_yds: "Rec yds",
  player_receptions: "Receptions",
  player_pass_yds_alternate: "Alt pass",
  player_rush_yds_alternate: "Alt rush",
  player_reception_yds_alternate: "Alt rec",
  player_receptions_alternate: "Alt receptions",
  player_pass_tds: "Pass TDs",
  player_anytime_td: "Anytime TD",
};

/** Short stat suffix for prop selections ("Over 27.5 Pts"). */
export const PROP_STAT_LABELS: Record<string, string> = {
  player_points: "Pts",
  player_rebounds: "Reb",
  player_assists: "Ast",
  player_pass_yds: "Pass Yds",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Rec",
  player_pass_yds_alternate: "Pass Yds",
  player_rush_yds_alternate: "Rush Yds",
  player_reception_yds_alternate: "Rec Yds",
  player_receptions_alternate: "Rec",
  player_pass_tds: "Pass TDs",
};

/** Human label for a pick: "Celtics -7", "Knicks to win", "Over 230.5". */
export function selectionLabel(sel: {
  marketKey: string;
  outcomeName: string;
  point: number | null;
  participantName?: string;
  /** Props: the player's team in this game, shown as "Derrick Henry (Ravens)". */
  participantTeam?: string | null;
}): string {
  const who = sel.participantName && sel.participantTeam ? `${sel.participantName} (${shortTeam(sel.participantTeam)})` : sel.participantName;
  switch (sel.marketKey) {
    case "h2h":
      return `${shortTeam(sel.outcomeName)} to win`;
    case "spreads":
      return `${shortTeam(sel.outcomeName)} ${formatSpread(sel.point)}`;
    case "totals":
      return `${sel.outcomeName} ${sel.point === null ? "" : trimPoint(sel.point)}`.trim();
    case "player_anytime_td":
      return [who, "Anytime TD"].filter(Boolean).join(" ");
    default:
      if (sel.marketKey.endsWith("_alternate") && sel.outcomeName === "Over" && sel.point !== null) {
        // Ladders are milestones: Over 99.5 yards = "100+".
        return [who, `${Math.ceil(sel.point)}+`, PROP_STAT_LABELS[sel.marketKey] ?? ""]
          .filter(Boolean)
          .join(" ");
      }
      return [
        who,
        sel.outcomeName,
        sel.point === null ? "" : trimPoint(sel.point),
        PROP_STAT_LABELS[sel.marketKey] ?? "",
      ]
        .filter(Boolean)
        .join(" ");
  }
}

/** "just now" · "12 min ago" · "3 hr ago" (display only; never used for bet acceptance). */
export function formatCheckedAgo(iso: string, nowMs: number): string {
  const mins = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
}
