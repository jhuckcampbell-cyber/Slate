"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Crown, RotateCcw, Trophy } from "lucide-react";
import { StubTear, stub } from "@/components/brand";
import { Ticker } from "@/components/ticker";
import { buttonVariants } from "@/components/ui/button";
import { CopyResult } from "@/components/leaderboard/copy-result";
import { formatCents } from "@/lib/format";
import { formatNet } from "@/lib/plain-english";
import { cn } from "@/lib/utils";

export type LeaderRow = {
  participantId: string;
  name: string;
  isYou: boolean;
  cashCents: number;
  evCents: number;
  maxCents: number;
  rank: number;
  standing: "alive" | "eliminated" | "busted" | "disqualified";
};

/** Top 3 (still in it) get a metal tear-off on the left: gold, silver, bronze. */
const MEDALS = [
  { label: "1st", className: "bg-gold text-foreground" },
  { label: "2nd", className: "bg-silver text-foreground" },
  { label: "3rd", className: "bg-bronze text-bronze-foreground" },
] as const;

/** Money needs a wider tear-off than a place does ("$1,049.65"). */
const WIDE_TEAR = "[--tear:6.75rem]";

/**
 * The sweat board. Rows come from the `leaderboard` view (RLS: everyone after lock). While games
 * are on, players rank by projected value (cash + each open bet's chance × return); once settled,
 * that is just cash. Each row is a ticket stub that drops down that player's bets (`bets`, keyed by participant).
 * When a refresh reorders players, rows glide to their new places and climbers get a "▲2" chip for a few seconds;
 * money counts to its new value.
 */
export function Leaderboard({
  rows,
  settled,
  bets = {},
  startCents,
  result,
}: {
  rows: LeaderRow[];
  settled: boolean;
  bets?: Record<string, React.ReactNode>;
  /** Starting bankroll: each row shows how far up or down from it the player is. */
  startCents?: number;
  /** Final only: the viewer's plain-text result for "Copy result" (resultText). */
  result?: string;
}) {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const winners = settled ? sorted.filter((r) => r.rank === 1 && r.standing !== "disqualified") : [];
  const { listRef, climbs } = useRowGlide(sorted);

  return (
    <section className="mt-6" aria-labelledby="leaderboard-heading">
      {winners.length > 0 && (
        <div
          className={stub(
            "default",
            cn(WIDE_TEAR, "mb-5 min-h-24 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"),
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-hype/12 text-hype ring-1 ring-hype/30">
              <Trophy className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="font-display truncate text-[1.9rem]/[1] font-extrabold tracking-tight">
                {winners.map((w) => (w.isYou ? "You" : w.name)).join(" & ")}{" "}
                {winners.length === 1 && !winners[0]!.isYou ? "wins" : "win"}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Finished with <span className="num text-foreground font-bold">{formatCents(winners[0]!.cashCents)}</span>
              </p>
            </div>
          </div>
          <StubTear winner>
            <span className="num text-[2rem]/none font-extrabold">1st</span>
            <span className="text-hype-foreground/85 mt-0.5 text-[11px] font-medium">of {sorted.length}</span>
          </StubTear>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 id="leaderboard-heading" className="font-display text-[1.75rem]/none font-extrabold tracking-tight">
          {settled ? "Final standings" : "Leaderboard"}
        </h2>
        {!settled && (
          <span className="border-border bg-card inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold">
            <span className="live-dot" aria-hidden /> Live
          </span>
        )}
      </div>
      {!settled && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Where everyone ends up if open bets go the way the odds say. Tap a name for their bets.
        </p>
      )}

      <ol ref={listRef} className="relative mt-3 space-y-2">
        {sorted.map((r) => {
          const out = r.standing !== "alive";
          const leading = r.rank === 1 && !out;
          const medal = !out && r.rank <= 3 ? MEDALS[r.rank - 1] : null;
          const score = settled ? r.cashCents : r.evCents;
          const change = startCents === undefined ? null : score - startCents;
          const note =
            r.standing === "disqualified"
              ? { text: "Broke a house rule · ranked last", tone: "text-loss" }
              : r.standing === "busted"
                ? { text: "Busted", tone: "text-loss" }
                : r.standing === "eliminated" && !settled
                  ? { text: "Can't catch the lead", tone: "text-warn" }
                  : null;
          return (
            <li key={r.participantId} data-row={r.participantId} aria-label={`${r.rank}. ${r.name}`}>
              <details className="group">
                <summary
                  className={stub(
                    r.isYou ? "you" : "default",
                    cn(
                      WIDE_TEAR,
                      "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
                      leading && "min-h-[4.5rem] border-[3px]",
                    ),
                  )}
                >
                  {medal && (
                    <span
                      aria-hidden
                      className={cn(
                        "flex w-14 shrink-0 flex-col items-center justify-center rounded-l-[calc(var(--radius-2xl)-3px)] border-r-2 border-dashed border-foreground",
                        medal.className,
                      )}
                    >
                      {leading && <Crown className="size-4" strokeWidth={2.5} />}
                      <span className={cn("num font-extrabold uppercase", leading ? "text-[1.6rem]/none" : "text-[1.3rem]/none")}>
                        {medal.label}
                      </span>
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3">
                    {!medal && (
                      <span
                        className={cn(
                          "num w-7 shrink-0 text-center text-[1.75rem]/none font-extrabold",
                          out ? "text-muted-foreground/60" : "text-foreground",
                        )}
                      >
                        {r.rank}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={cn("flex items-center gap-1.5 font-semibold", leading && "text-lg", out && "text-muted-foreground")}>
                        <span className="truncate">{r.name}</span>
                        {climbs[r.participantId] && (
                          <span
                            aria-label={`Up ${climbs[r.participantId]}`}
                            className="num shrink-0 rounded-full border-2 border-foreground bg-tab px-1.5 text-xs leading-4 font-bold motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in"
                          >
                            ▲{climbs[r.participantId]}
                          </span>
                        )}
                        {r.isYou && (
                          <span className="bg-foreground text-background shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold tracking-wide uppercase">
                            You
                          </span>
                        )}
                      </p>
                      {settled && change !== null && startCents !== undefined && (
                        <p className="num text-muted-foreground text-sm">
                          {formatCents(startCents)} → {formatCents(score)} ·{" "}
                          <span className={cn("font-bold", change > 0 ? "text-win" : change < 0 ? "text-loss" : "")}>
                            {formatNet(change)}
                          </span>
                        </p>
                      )}
                      {note && <p className={cn("text-xs font-semibold", note.tone)}>{note.text}</p>}
                    </div>
                    <ChevronDown
                      aria-label="Show bets"
                      className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                    />
                  </div>
                  <StubTear className="items-end pr-3">
                    <Ticker cents={score} className={cn("num text-[1.6rem]/none font-bold", out && "text-muted-foreground")} />
                    {change !== null && !settled && <Change cents={change} />}
                  </StubTear>
                </summary>
                {/* The back of the ticket: slides out from under the stub. */}
                <div className="border-foreground bg-surface-2 mx-2.5 rounded-b-xl border-2 border-t-0 px-2.5 pt-2.5 pb-3 motion-safe:group-open:animate-in motion-safe:group-open:fade-in motion-safe:group-open:slide-in-from-top-1">
                  {bets[r.participantId] ?? <p className="text-muted-foreground text-sm">No picks.</p>}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      {settled && result && <CopyResult text={result} className="mt-5 h-12 w-full rounded-2xl text-base font-semibold" />}
      {settled && (
        <Link href="/create" className={cn(buttonVariants(), result ? "mt-2" : "mt-5", "h-14 w-full rounded-2xl text-base font-semibold")}>
          <RotateCcw /> Run it back
        </Link>
      )}
    </section>
  );
}

/** Up or down from the starting bankroll: "▲ $49.65", "▼ $12", "Even". */
function Change({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-muted-foreground mt-1 text-xs font-semibold">Even</span>;
  const up = cents > 0;
  return (
    <span className={cn("num mt-1 flex items-center justify-end gap-0.5 text-sm font-bold", up ? "text-win" : "text-loss")}>
      {up ? <ArrowUp className="size-3.5" aria-label="Up" /> : <ArrowDown className="size-3.5" aria-label="Down" />}
      <Ticker cents={Math.abs(cents)} />
    </span>
  );
}

const GLIDE_MS = 450;
const CLIMB_MS = 4000;

/**
 * FLIP: after a re-render that moves rows, each row starts where it was and glides to its new place. Players who
 * moved up get a climb count (shown as "▲2") for a few seconds. Instant (no glide) for reduced motion.
 */
function useRowGlide(rows: LeaderRow[]) {
  const listRef = useRef<HTMLOListElement>(null);
  const tops = useRef(new Map<string, number>());
  const order = rows.map((r) => `${r.participantId}:${r.rank}`).join(",");

  // Climbs are derived while rendering when the order changes (React's "adjust state on prop change" pattern).
  const [seen, setSeen] = useState({ order, ranks: new Map(rows.map((r) => [r.participantId, r.rank])) });
  const [climbs, setClimbs] = useState<Record<string, number>>({});
  if (seen.order !== order) {
    const up: Record<string, number> = {};
    for (const r of rows) {
      const before = seen.ranks.get(r.participantId);
      if (before !== undefined && r.rank < before) up[r.participantId] = before - r.rank;
    }
    setSeen({ order, ranks: new Map(rows.map((r) => [r.participantId, r.rank])) });
    setClimbs(up);
  }

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (list.offsetParent === null) {
      tops.current.clear(); // hidden (Games tab): measure fresh next time it shows
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const li of Array.from(list.querySelectorAll<HTMLLIElement>("li[data-row]"))) {
      const id = li.dataset.row!;
      const before = tops.current.get(id);
      const dy = before === undefined ? 0 : before - li.offsetTop;
      if (dy !== 0 && !still) {
        li.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
          duration: GLIDE_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
      next.set(id, li.offsetTop);
    }
    tops.current = next;
  }, [order]);

  useEffect(() => {
    if (Object.keys(climbs).length === 0) return;
    const t = setTimeout(() => setClimbs({}), CLIMB_MS);
    return () => clearTimeout(t);
  }, [climbs]);

  return { listRef, climbs };
}
