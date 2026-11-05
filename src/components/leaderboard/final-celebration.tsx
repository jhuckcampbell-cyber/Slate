"use client";

import { useState, useSyncExternalStore } from "react";
import { Crown, Trophy } from "lucide-react";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

type Finisher = { name: string; isYou: boolean; cashCents: number; rank: number };

const seenKey = (id: string) => `slate:final-seen:${id}`;
const noop = () => () => {};

function wasSeen(id: string) {
  try {
    return localStorage.getItem(seenKey(id)) === "1";
  } catch {
    return false;
  }
}

const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 9) * 0.18,
  duration: 2.6 + ((i * 13) % 10) / 10,
  color: ["bg-brand", "bg-hype", "bg-warn", "bg-chart-2", "bg-chart-4"][i % 5],
  rotate: (i * 47) % 360,
}));

/**
 * When a tournament ends: the champion, a podium and confetti, once per tournament per phone. "See final standings"
 * closes it onto the leaderboard.
 */
export function FinalCelebration({ tournamentId, finishers }: { tournamentId: string; finishers: Finisher[] }) {
  const seen = useSyncExternalStore(noop, () => wasSeen(tournamentId), () => true);
  const [closed, setClosed] = useState(false);
  const open = !seen && !closed && finishers.length > 0;

  // Seen only once closed (a live re-render must not close it on its own).
  function close() {
    try {
      localStorage.setItem(seenKey(tournamentId), "1");
    } catch {
      // storage blocked: it shows again next time, which is fine
    }
    setClosed(true);
  }

  if (!open) return null;
  const top = [...finishers].sort((a, b) => a.rank - b.rank);
  const champs = top.filter((f) => f.rank === 1);
  const podium = top.slice(0, 3);
  const you = top.find((f) => f.isYou);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tournament over"
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-background/90 px-6 backdrop-blur-md motion-safe:animate-in motion-safe:fade-in"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className={cn("confetti absolute -top-4 h-3 w-1.5 rounded-sm", c.color)}
            style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.duration}s`, rotate: `${c.rotate}deg` }}
          />
        ))}
      </div>

      <div className="relative w-full max-w-sm text-center">
        <Trophy className="mx-auto size-16 text-warn drop-shadow-[0_0_24px_var(--warn)] motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-700" />
        <p className="mt-3 text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase">Champion</p>
        <p className="mt-1 font-display text-5xl/[1] font-extrabold text-balance motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in motion-safe:delay-300 motion-safe:fill-mode-both">
          {champs.map((c) => (c.isYou ? "You!" : c.name)).join(" & ")}
        </p>
        <p className="mt-2 text-muted-foreground">
          Finished with <span className="num font-bold text-foreground">{formatCents(champs[0]!.cashCents)}</span>
        </p>

        <ol className="mt-8 flex items-end justify-center gap-2" aria-label="Podium">
          {[podium[1], podium[0], podium[2]].map((f, i) =>
            f ? (
              <li
                key={`${f.name}-${f.rank}`}
                className="flex w-24 flex-col items-center motion-safe:animate-in motion-safe:slide-in-from-bottom-8 motion-safe:fade-in motion-safe:fill-mode-both"
                style={{ animationDelay: `${500 + i * 150}ms` }}
              >
                {f.rank === 1 && <Crown className="mb-1 size-5 text-warn" />}
                <span className={cn("max-w-full truncate text-sm font-semibold", f.isYou && "text-brand")}>
                  {f.isYou ? "You" : f.name}
                </span>
                <span className="num text-xs text-muted-foreground">{formatCents(f.cashCents)}</span>
                <span
                  className={cn(
                    "mt-1 flex w-full items-start justify-center rounded-t-xl pt-2 font-display text-2xl font-extrabold",
                    f.rank === 1 ? "h-24 bg-warn/25 text-warn" : f.rank === 2 ? "h-16 bg-muted text-foreground" : "h-12 bg-muted/60 text-muted-foreground",
                  )}
                >
                  {f.rank}
                </span>
              </li>
            ) : null,
          )}
        </ol>

        {you && you.rank > 3 && (
          <p className="mt-4 text-sm text-muted-foreground">
            You finished #{you.rank} of {top.length}.
          </p>
        )}

        <button
          type="button"
          autoFocus
          onClick={close}
          className="mt-8 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
        >
          See final standings
        </button>
      </div>
    </div>
  );
}
