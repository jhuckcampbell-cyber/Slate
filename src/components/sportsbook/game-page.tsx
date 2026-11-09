"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { TeamMark } from "@/components/team-mark";
import type { BoardRow } from "@/lib/core/board";
import { MARKET_LABELS, PROP_TAB_LABELS, shortTeam } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GameLines, PlayerList, propTabs, type SportsbookEvent } from "./event-card";

type Props = {
  event: SportsbookEvent;
  markets: Map<string, BoardRow[]> | undefined;
  allowedMarkets: readonly string[];
  locked: boolean;
  selected: ReadonlySet<number>;
  onToggle: (row: BoardRow) => void;
  onBack: () => void;
};

/** How many players each stat shows on the Popular tab. */
const POPULAR_PLAYERS = 3;

/**
 * One game, everything you can bet on it (like a sportsbook's game page): Popular (the game lines + the top players
 * for each stat), Game lines, then one tab per stat with its milestones folded in. Opened from the board's
 * "Player props & more"; the slip bar stays underneath so picks from here and the board build one slip.
 */
export function GamePage({ event, markets, allowedMarkets, locked, selected, onToggle, onBack }: Props) {
  const stats = propTabs(allowedMarkets, markets);
  const [tab, setTab] = useState<string>("popular");
  const current = tab === "popular" || tab === "lines" || stats.includes(tab) ? tab : "popular";
  const [query, setQuery] = useState("");
  // Opened from deep in the board: start at the game page, not at the top of the lobby.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    const y = (top.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, y) });
  }, [event.id]);
  const matchup = `${shortTeam(event.away_team)} @ ${shortTeam(event.home_team)}`;
  const shared = { event, markets, allowedMarkets, locked, selected, onToggle };
  const tabs = [
    { key: "popular", label: "Popular", name: "Popular" },
    { key: "lines", label: "Game lines", name: "Game lines" },
    ...stats.map((k) => ({ key: k, label: PROP_TAB_LABELS[k] ?? MARKET_LABELS[k] ?? k, name: MARKET_LABELS[k] ?? k })),
  ];

  return (
    <section ref={top} className="scroll-mt-3" aria-label={`${event.away_team} at ${event.home_team}, all bets`}>
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 flex h-11 items-center gap-0.5 px-2 text-sm font-medium text-muted-foreground"
      >
        <ChevronLeft className="size-4" /> All games
      </button>

      <header className="mt-1 flex items-center gap-3">
        <TeamMark team={event.away_team} sportKey={event.sport_key} className="size-9" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-3xl leading-none font-bold">{matchup}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <LocalTime iso={event.commence_time} />
          </p>
        </div>
        <TeamMark team={event.home_team} sportKey={event.sport_key} className="size-9" />
      </header>

      {/* Wraps instead of scrolling sideways: every tab is visible at once. */}
      <nav aria-label="Bet types" className="mt-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={t.key === current}
            aria-label={t.name}
            onClick={() => {
              setTab(t.key);
              setQuery("");
            }}
            className={cn(
              "h-11 shrink-0 rounded-full border-2 border-foreground px-4 text-xs font-semibold",
              t.key === current ? "bg-foreground text-background" : "bg-card text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-3 space-y-3">
        {current === "popular" && (
          <>
            <Panel>
              <GameLines {...shared} />
            </Panel>
            {stats.map((k) => (
              <Panel key={k}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{MARKET_LABELS[k] ?? k}</h3>
                  <button
                    type="button"
                    onClick={() => setTab(k)}
                    aria-label={`All ${(MARKET_LABELS[k] ?? k).toLowerCase()}`}
                    className="-mr-1 flex h-11 items-center px-1 text-xs font-semibold text-brand"
                  >
                    See all <ChevronRight className="size-3.5" />
                  </button>
                </div>
                <PlayerList {...shared} base={k} limit={POPULAR_PLAYERS} />
              </Panel>
            ))}
            {stats.length === 0 && allowedMarkets.some((m) => m.startsWith("player_")) && <NoProps />}
          </>
        )}

        {current === "lines" && (
          <Panel>
            <GameLines {...shared} />
          </Panel>
        )}

        {stats.includes(current) && (
          <Panel>
            <div className="relative pb-1">
              <Search aria-hidden className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players"
                aria-label={`Search players, ${matchup}`}
                autoComplete="off"
                className="h-11 w-full rounded-xl border-2 border-foreground bg-card pr-11 pl-9 text-base outline-none focus-visible:border-brand [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute top-0 right-0 flex size-11 items-center justify-center text-muted-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <PlayerList {...shared} base={current} query={query} />
          </Panel>
        )}
      </div>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-card p-3.5 ring-1 ring-border">{children}</div>;
}

function NoProps() {
  return (
    <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground ring-1 ring-border">
      No player props posted for this game yet. Sportsbooks usually post them a day or two before kickoff.
    </p>
  );
}
