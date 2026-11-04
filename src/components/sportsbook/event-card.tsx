"use client";

import { Clock } from "lucide-react";
import { oldestCheck, type BoardRow } from "@/lib/core/board";
import { useServerNow } from "@/lib/hooks/use-server-now";
import {
  MARKET_LABELS,
  formatAmerican,
  formatCheckedAgo,
  formatKickoff,
  formatSpread,
  selectionLabel,
  shortTeam,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export type SportsbookEvent = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  /** Post-lock only (scores sync). */
  status?: string | null;
  home_score?: number | null;
  away_score?: number | null;
};

const COLUMN_ORDER = ["spreads", "totals", "h2h"] as const;

// Static class names so Tailwind can see them.
const GRID: Record<number, string> = {
  1: "grid-cols-[1fr_4.25rem]",
  2: "grid-cols-[1fr_repeat(2,4.25rem)]",
  3: "grid-cols-[1fr_repeat(3,4.25rem)]",
};

type Props = {
  event: SportsbookEvent;
  markets: Map<string, BoardRow[]> | undefined;
  allowedMarkets: readonly string[];
  locked: boolean;
  selected: ReadonlySet<number>;
  onToggle: (row: BoardRow) => void;
};

/** Classic sportsbook card: away row over home row × Spread / Total / Moneyline. */
export function EventCard({ event, markets, allowedMarkets, locked, selected, onToggle }: Props) {
  const columns = COLUMN_ORDER.filter((m) => allowedMarkets.includes(m));
  const grid = GRID[columns.length] ?? GRID[3];
  const hasOdds = columns.some((m) => (markets?.get(m)?.length ?? 0) > 0);
  const sides = [
    { team: event.away_team, totalsSide: "Over" },
    { team: event.home_team, totalsSide: "Under" },
  ];

  return (
    <article className="rounded-2xl bg-card p-3.5 ring-1 ring-border" aria-label={`${event.away_team} at ${event.home_team}`}>
      <header className={cn("mb-1 grid items-end gap-1.5 text-[11px] text-muted-foreground", grid)}>
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {formatKickoff(event.commence_time)}
        </span>
        {columns.map((m) => (
          <span key={m} className="text-center">
            {MARKET_LABELS[m]}
          </span>
        ))}
      </header>

      {sides.map((side) => (
        <div key={side.team} className={cn("grid items-center gap-1.5 py-1", grid)}>
          <span className="truncate font-display text-lg font-bold uppercase" title={side.team}>
            {shortTeam(side.team)}
          </span>
          {columns.map((m) => {
            const row = markets?.get(m)?.find((r) => r.outcomeName === (m === "totals" ? side.totalsSide : side.team));
            return (
              <OddsButton
                key={m}
                row={row}
                selected={row ? selected.has(row.id) : false}
                disabled={locked || !row || row.isStale}
                onClick={() => row && onToggle(row)}
              />
            );
          })}
        </div>
      ))}

      {hasOdds ? (
        <Freshness rows={columns.flatMap((m) => markets?.get(m) ?? [])} />
      ) : (
        <p className="mt-1 text-center text-xs text-muted-foreground">Lines post shortly…</p>
      )}
    </article>
  );
}

/** How old the prices are. Odds refresh on a slow cadence (free API tier), so say so. */
function Freshness({ rows }: { rows: BoardRow[] }) {
  const now = useServerNow();
  const checked = oldestCheck(rows);
  if (rows.some((r) => r.isStale)) {
    return <p className="mt-1.5 text-right text-[11px] text-warn">Updating odds…</p>;
  }
  if (now === null || checked === null) return null;
  return (
    <p className="mt-1.5 text-right text-[11px] text-muted-foreground">Odds checked {formatCheckedAgo(checked, now)}</p>
  );
}

function OddsButton({
  row,
  selected,
  disabled,
  onClick,
}: {
  row: BoardRow | undefined;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  if (!row) {
    return (
      <div className="flex h-13 items-center justify-center rounded-xl bg-muted/40 text-xs text-muted-foreground">
        —
      </div>
    );
  }

  const line =
    row.marketKey === "spreads"
      ? formatSpread(row.point)
      : row.marketKey === "totals"
        ? row.point === null
          ? null
          : String(row.point)
        : null;

  return (
    <button
      type="button"
      data-odds-id={row.id}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${selectionLabel(row)} ${formatAmerican(row.priceAmerican)}${row.isStale ? " (updating)" : ""}`}
      className={cn(
        "num h-13 overflow-hidden rounded-xl border transition-colors active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "border-brand bg-brand text-brand-foreground"
          : "border-border bg-surface-2/60 hover:bg-surface-2",
      )}
    >
      {/* Keyed on updatedAt so the flash replays on every Realtime price move. */}
      <span
        key={row.updatedAt}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center",
          row.movement === "up" && "animate-flash-up",
          row.movement === "down" && "animate-flash-down",
        )}
      >
        {line && (
          <span className="text-base leading-none font-bold">
            {row.marketKey === "totals" && (
              // Body font: in the scoreboard face "O" is indistinguishable from zero.
              <span className="mr-0.5 font-sans text-[11px] font-semibold opacity-70">
                {row.outcomeName === "Over" ? "O" : "U"}
              </span>
            )}
            {line}
          </span>
        )}
        <span
          className={cn(
            line ? "mt-0.5 text-[13px] leading-none" : "text-lg leading-none font-bold",
            line && (selected ? "text-brand-foreground/75" : "text-muted-foreground"),
          )}
        >
          {formatAmerican(row.priceAmerican)}
        </span>
      </span>
    </button>
  );
}
