"use client";

import { Odds } from "@/components/odds";
import { TeamMark } from "@/components/team-mark";
import { LocalTime } from "@/components/local-time";
import { ChevronRight, Clock } from "lucide-react";
import { Fragment, useState } from "react";
import { isAlternateMarket, isPropMarket, statMarket } from "@/lib/core/props";
import { matchesQuery, orderPlayers } from "@/lib/prop-order";
import { oldestCheck, type BoardRow } from "@/lib/core/board";
import { useServerNow } from "@/lib/hooks/use-server-now";
import {
  MARKET_LABELS,
  formatAmerican,
  formatCheckedAgo,
  formatSpread,
  selectionLabel,
  shortTeam,
} from "@/lib/format";
import { flyToSlip } from "@/lib/fly";
import { cn } from "@/lib/utils";

export type SportsbookEvent = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  sport_key?: string;
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
  /** Open this game's page (props, ladders, every line). */
  onOpen?: () => void;
};

/** Classic sportsbook card: away row over home row × Spread / Total / Winner. Tap "More bets" for the game page. */
export function EventCard({ event, markets, allowedMarkets, locked, selected, onToggle, onOpen }: Props) {
  const hasProps = allowedMarkets.some(isPropMarket);
  const propCount = propTabs(allowedMarkets, markets).length;
  const matchup = `${shortTeam(event.away_team)} @ ${shortTeam(event.home_team)}`;
  return (
    <article className="rounded-2xl bg-card p-3.5 ring-1 ring-border" aria-label={`${event.away_team} at ${event.home_team}`}>
      <GameLines
        event={event}
        markets={markets}
        allowedMarkets={allowedMarkets}
        locked={locked}
        selected={selected}
        onToggle={onToggle}
      />
      {hasProps && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`More bets, ${matchup}`}
          className="mt-2 flex h-11 w-full items-center justify-between rounded-xl bg-surface-2/60 px-3 text-sm font-semibold"
        >
          <span>
            Player props &amp; more
            <span className="ml-1.5 font-normal text-muted-foreground">
              {propCount > 0 ? `${propCount} ${propCount === 1 ? "stat" : "stats"}` : "not posted yet"}
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      )}
    </article>
  );
}

/** The game's own lines (Spread / Total / Winner) for the two teams, with how fresh the prices are. */
export function GameLines({ event, markets, allowedMarkets, locked, selected, onToggle }: Omit<Props, "onOpen">) {
  const columns = COLUMN_ORDER.filter((m) => allowedMarkets.includes(m));
  const grid = GRID[columns.length] ?? GRID[3];
  const hasOdds = columns.some((m) => (markets?.get(m)?.length ?? 0) > 0);
  const sides = [
    { team: event.away_team, totalsSide: "Over" },
    { team: event.home_team, totalsSide: "Under" },
  ];
  return (
    <div>
      <header className={cn("mb-1 grid items-end gap-1.5 text-[11px] text-muted-foreground", grid)}>
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          <LocalTime iso={event.commence_time} />
        </span>
        {columns.map((m) => (
          <span key={m} className="text-center">
            {MARKET_LABELS[m]}
          </span>
        ))}
      </header>
      {sides.map((side) => (
        <div key={side.team} className={cn("grid items-center gap-1.5 py-1", grid)}>
          <span className="flex min-w-0 items-center gap-1.5" title={side.team}>
            <TeamMark team={side.team} sportKey={event.sport_key} />
            <span className="truncate font-display text-lg font-bold">{shortTeam(side.team)}</span>
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
    </div>
  );
}

/**
 * The prop stats a game page gets a tab for: one per stat, its alternate ladder folded in ("Rushing yards" holds the
 * over/under and the 50+ / 75+ / 100+ milestones). Only stats the books have priced: an empty tab reads as broken.
 */
export function propTabs(allowedMarkets: readonly string[], markets: Map<string, BoardRow[]> | undefined): string[] {
  const posted = new Set(
    allowedMarkets.filter((k) => isPropMarket(k) && (markets?.get(k)?.length ?? 0) > 0).map(statMarket),
  );
  return [...new Set(allowedMarkets.filter(isPropMarket).map(statMarket))].filter((b) => posted.has(b));
}

/**
 * Everyone with a line for one stat, likeliest first, grouped by team: the main over/under (or anytime-TD price) on
 * the right and their milestones underneath. `limit` keeps the top few, without teams or milestones (Popular tab).
 */
export function PlayerList({
  event,
  base,
  markets,
  allowedMarkets,
  locked,
  selected,
  onToggle,
  query = "",
  limit,
}: Omit<Props, "onOpen"> & { base: string; query?: string; limit?: number }) {
  const alt = `${base}_alternate`;
  const mainRows = markets?.get(base) ?? [];
  const altRows = allowedMarkets.includes(alt) ? (markets?.get(alt) ?? []) : [];
  const all = [...mainRows, ...altRows];
  const teamOf = (player: string) => all.find((r) => r.participantName === player)?.participantTeam ?? null;
  const ordered = [...new Set([...orderPlayers(mainRows, base), ...orderPlayers(altRows, alt)])];
  const matching = ordered.filter((p) => matchesQuery(p, teamOf(p), query));
  const players =
    limit === undefined ? matching : matching.filter((p) => mainRows.some((r) => r.participantName === p)).slice(0, limit);
  if (players.length === 0) {
    return query.trim() && ordered.length > 0 ? (
      <p className="py-2 text-center text-xs text-muted-foreground">No players match &ldquo;{query.trim()}&rdquo;.</p>
    ) : null;
  }
  // Group by team (away, home, then unknown) so it's clear who plays for whom. No headings if no team is known.
  const groups: { team: string | null; players: string[] }[] =
    limit !== undefined
      ? [{ team: null, players }]
      : [event.away_team, event.home_team, null]
          .map((team) => ({ team, players: players.filter((p) => teamOf(p) === team) }))
          .filter((g) => g.players.length > 0);
  const showTeams = limit === undefined && groups.some((g) => g.team !== null);
  const sides = base === "player_anytime_td" ? ["Yes"] : ["Over", "Under"];
  const button = (row: BoardRow | undefined, key: string) => (
    <OddsButton
      key={key}
      row={row}
      selected={row ? selected.has(row.id) : false}
      disabled={locked || !row || row.isStale}
      onClick={() => row && onToggle(row)}
    />
  );
  return (
    <ul>
      {groups.map((g) => (
        <Fragment key={g.team ?? "other"}>
          {showTeams && (
            <li className="flex items-center gap-1.5 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {g.team && <TeamMark team={g.team} sportKey={event.sport_key} className="size-5" />}
              {g.team ? shortTeam(g.team) : "Other"}
            </li>
          )}
          {g.players.map((player) => {
            const team = teamOf(player);
            const main = mainRows.filter((r) => r.participantName === player);
            const ladder = limit === undefined ? altRows.filter((r) => r.participantName === player) : [];
            return (
              <li key={player} className="py-1">
                <div
                  className={cn(
                    "grid items-center gap-1.5",
                    main.length === 0
                      ? "grid-cols-1"
                      : sides.length === 1
                        ? "grid-cols-[1fr_4.25rem]"
                        : "grid-cols-[1fr_4.25rem_4.25rem]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5" title={team ? `${player} (${team})` : player}>
                    {team && <TeamMark team={team} sportKey={event.sport_key} />}
                    <span className="truncate text-sm font-medium">{player}</span>
                  </span>
                  {main.length > 0 && sides.map((name) => button(main.find((r) => r.outcomeName === name), name))}
                </div>
                {ladder.length > 0 && <Ladder rows={ladder} selected={selected} render={(r) => button(r, String(r.id))} />}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}

/** Ladder lines outside this price band (near-locks and long shots) start hidden behind "Show all". */
const LADDER_BAND = 500;

/** One player's alternate ladder: milestone buttons ("50+", "75+", "100+"), lowest first. */
function Ladder({
  rows,
  selected,
  render,
}: {
  rows: BoardRow[];
  selected: ReadonlySet<number>;
  render: (row: BoardRow) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const ladder = [...rows].sort((a, b) => (a.point ?? 0) - (b.point ?? 0));
  const inBand = ladder.filter((r) => Math.abs(r.priceAmerican) <= LADDER_BAND || selected.has(r.id));
  const trimmed = inBand.length > 0 && inBand.length < ladder.length;
  const shown = all || !trimmed ? ladder : inBand;
  return (
    <div className="mt-1.5">
      <div className="grid grid-cols-4 gap-1.5">{shown.map(render)}</div>
      {trimmed && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 h-11 px-1 text-xs font-semibold text-brand underline underline-offset-2">
          {all ? "Fewer lines" : `Show all ${ladder.length} lines`}
        </button>
      )}
    </div>
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

export function OddsButton({
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

  const ladder = isAlternateMarket(row.marketKey) && row.point !== null;
  const overUnder = !ladder && (row.marketKey === "totals" || isPropMarket(row.marketKey));
  const line =
    row.marketKey === "spreads"
      ? formatSpread(row.point)
      : ladder
        ? `${Math.ceil(row.point!)}+`
        : overUnder
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
      onClick={(e) => {
        if (!selected) flyToSlip(e.currentTarget, formatAmerican(row.priceAmerican));
        onClick();
      }}
      aria-label={`${selectionLabel(row)} ${formatAmerican(row.priceAmerican)}${row.isStale ? " (updating)" : ""}`}
      className={cn(
        "num h-13 overflow-hidden rounded-xl border-2 border-foreground transition-[background-color,transform] duration-150 motion-safe:active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-40",
        selected ? "bg-foreground text-background" : "bg-card hover:bg-surface-2",
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
            {overUnder && (
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
          <Odds american={row.priceAmerican} />
        </span>
      </span>
    </button>
  );
}
