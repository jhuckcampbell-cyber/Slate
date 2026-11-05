import Link from "next/link";
import { ChevronDown, RotateCcw, Trophy } from "lucide-react";
import { Eyebrow } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LeaderRow = {
  participantId: string;
  name: string;
  isYou: boolean;
  cashCents: number;
  evCents: number;
  maxCents: number;
  rank: number;
  standing: "alive" | "eliminated" | "busted";
};

/**
 * The sweat board. Rows come from the `leaderboard` view (RLS: everyone after lock). While games
 * are on, players rank by projected value (cash + each open bet's chance × return); once settled,
 * that is just cash. Each row drops down that player's bets (`bets`, keyed by participant).
 */
export function Leaderboard({
  rows,
  settled,
  bets = {},
}: {
  rows: LeaderRow[];
  settled: boolean;
  bets?: Record<string, React.ReactNode>;
}) {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const winners = settled ? sorted.filter((r) => r.rank === 1) : [];

  return (
    <section className="mt-6" aria-labelledby="leaderboard-heading">
      {winners.length > 0 && (
        <div className="from-hype/30 via-card to-card ring-hype/40 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 mb-4 rounded-2xl bg-gradient-to-br p-4 ring-1">
          <Trophy className="text-hype size-7" />
          <p className="font-display mt-2 text-3xl/[1] font-extrabold uppercase">
            {winners.map((w) => (w.isYou ? "You" : w.name)).join(" & ")}{" "}
            {winners.length === 1 && !winners[0]!.isYou ? "wins" : "win"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Finished with{" "}
            <span className="num text-foreground font-bold">
              {formatCents(winners[0]!.cashCents)}
            </span>
          </p>
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <h2 id="leaderboard-heading" className="font-display text-2xl font-extrabold uppercase">
          {settled ? "Final standings" : "Leaderboard"}
        </h2>
        {!settled && <Eyebrow>Projected · live</Eyebrow>}
      </div>

      <ol className="mt-2 space-y-2">
        {sorted.map((r) => {
          const out = r.standing !== "alive";
          return (
            <li
              key={r.participantId}
              aria-label={`${r.rank}. ${r.name}`}
              className={cn(
                "bg-card rounded-2xl ring-1",
                r.isYou ? "ring-brand/40" : "ring-border",
              )}
            >
              <details className="group">
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden",
                    out && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "num w-6 shrink-0 text-center text-2xl font-extrabold",
                      r.rank === 1 ? "text-hype" : "text-muted-foreground",
                    )}
                  >
                    {r.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display truncate text-lg leading-tight font-bold uppercase">
                      {r.name}
                      {r.isYou && (
                        <span className="text-muted-foreground font-normal normal-case">
                          {" "}
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {settled ? (
                        r.standing === "busted" ? (
                          "Busted"
                        ) : (
                          "Final"
                        )
                      ) : (
                        <>
                          Cash{" "}
                          <span className="num text-foreground">{formatCents(r.cashCents)}</span> ·
                          Max <span className="num text-foreground">{formatCents(r.maxCents)}</span>
                          {out && (
                            <span
                              className={cn(
                                "ml-1.5 font-semibold",
                                r.standing === "busted" ? "text-loss" : "text-warn",
                              )}
                            >
                              · {r.standing === "busted" ? "Busted" : "Eliminated"}
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "num text-2xl font-bold",
                      r.rank === 1 && !out ? "text-brand" : "text-foreground",
                    )}
                  >
                    {formatCents(settled ? r.cashCents : r.evCents)}
                  </span>
                  <ChevronDown
                    aria-label="Show bets"
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-border border-t px-3 pt-2.5 pb-3">
                  {bets[r.participantId] ?? (
                    <p className="text-muted-foreground text-sm">No picks.</p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      {settled && (
        <Link
          href="/create"
          className={cn(buttonVariants(), "mt-4 h-14 w-full text-base font-semibold")}
        >
          <RotateCcw /> Run it back
        </Link>
      )}
    </section>
  );
}
