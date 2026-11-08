import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, RotateCcw, Trophy } from "lucide-react";
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
  standing: "alive" | "eliminated" | "busted" | "disqualified";
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
  startCents,
}: {
  rows: LeaderRow[];
  settled: boolean;
  bets?: Record<string, React.ReactNode>;
  /** Starting bankroll: each row shows how far up or down from it the player is. */
  startCents?: number;
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
      {!settled && (
        <p className="text-muted-foreground mt-0.5 text-xs">
          What each player ends with if their open bets go the way the odds say. Tap a name for their bets.
        </p>
      )}

      <ol className="mt-2 space-y-2">
        {sorted.map((r) => {
          const out = r.standing !== "alive";
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
            <li
              key={r.participantId}
              aria-label={`${r.rank}. ${r.name}`}
              className={cn("bg-card rounded-2xl ring-1", r.isYou ? "ring-brand/40" : "ring-border")}
            >
              <details className="group">
                <summary
                  className={cn(
                    "flex min-h-16 cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden",
                    out && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "num w-6 shrink-0 text-center text-2xl font-extrabold",
                      r.rank === 1 && !out ? "text-hype" : "text-muted-foreground",
                    )}
                  >
                    {r.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display truncate text-xl leading-tight font-bold uppercase">
                      {r.name}
                      {r.isYou && <span className="text-muted-foreground font-normal normal-case"> (you)</span>}
                    </p>
                    {note && <p className={cn("text-xs font-semibold", note.tone)}>{note.text}</p>}
                  </div>
                  <div className="text-right">
                    <p className={cn("num text-3xl leading-none font-bold", r.rank === 1 && !out && "text-brand")}>
                      {formatCents(score)}
                    </p>
                    {change !== null && <Change cents={change} />}
                  </div>
                  <ChevronDown
                    aria-label="Show bets"
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-border border-t px-3 pt-2.5 pb-3">
                  {bets[r.participantId] ?? <p className="text-muted-foreground text-sm">No picks.</p>}
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

/** Up or down from the starting bankroll: "▲ $49.65", "▼ $12", "Even". */
function Change({ cents }: { cents: number }) {
  if (cents === 0) return <p className="text-muted-foreground mt-1 text-xs font-semibold">Even</p>;
  const up = cents > 0;
  return (
    <p className={cn("num mt-1 flex items-center justify-end gap-0.5 text-sm font-bold", up ? "text-win" : "text-loss")}>
      {up ? <ArrowUp className="size-3.5" aria-label="Up" /> : <ArrowDown className="size-3.5" aria-label="Down" />}
      {formatCents(Math.abs(cents))}
    </p>
  );
}
