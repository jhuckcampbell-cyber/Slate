"use client";

import { Lock, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useServerNow } from "@/lib/hooks/use-server-now";

/**
 * Display-only countdown. The DB decides when picks lock/reveal (CLAUDE.md rule 5); at zero we
 * refresh so server components re-read under RLS. Pass `serverNow` (the DB's now() at render) so a
 * phone with a wrong clock still flips at the real lock moment.
 */
export function LockCountdown({
  lockTime,
  serverNow,
  isLocked = false,
  variant = "chip",
}: {
  lockTime: string;
  serverNow?: string;
  /** The server already rendered the locked state: nothing to count down or refresh. */
  isLocked?: boolean;
  /** "band": text for the open StatusBand ("Open · Locks in 18h 13m"), no icons. */
  variant?: "chip" | "band";
}) {
  const router = useRouter();
  const target = new Date(lockTime).getTime();
  const now = useServerNow(serverNow);

  const remaining = now === null ? null : target - now;
  const locked = isLocked || (remaining !== null && remaining <= 0);

  useEffect(() => {
    if (locked && !isLocked) router.refresh();
  }, [locked, isLocked, router]);

  if (variant === "band") {
    // The last three seconds take over the lobby; at zero the lock snaps shut until the reveal re-render arrives.
    const finalSeconds = !locked && remaining !== null && remaining <= 3000 ? Math.max(1, Math.ceil(remaining / 1000)) : null;
    return (
      <span className="tabular-nums">
        {locked ? (
          "Picks locked"
        ) : (
          <>
            ● Open · Locks in <strong className="font-bold">{remaining === null ? "…" : formatCountdown(remaining)}</strong>
          </>
        )}
        {finalSeconds !== null && <FinalCount n={finalSeconds} />}
        {locked && !isLocked && <FinalCount n={0} />}
      </span>
    );
  }

  if (locked) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-warn">
        <Lock className="size-4" /> Picks locked
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <Timer className="size-4 text-brand" />
      Locks in <strong>{remaining === null ? "…" : formatCountdown(remaining)}</strong>
    </span>
  );
}

/**
 * The final 3-2-1 before lock: a big Barlow digit stamps down in the middle of the screen each second (the 1 in
 * coral), then a padlock snaps shut (n = 0) while the reveal loads. Decoration only (the band text says the same).
 */
function FinalCount({ n }: { n: number }) {
  return (
    <span aria-hidden className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/75">
      {n > 0 ? (
        <span key={n} className="relative grid place-items-center">
          <span className="count-ring absolute size-44 rounded-full border-[3px] border-foreground" />
          <span className={cn("count-stamp num text-[9rem]/none font-extrabold", n === 1 ? "text-hype" : "text-foreground")}>
            {n}
          </span>
        </span>
      ) : (
        <span className="stamp-in flex flex-col items-center gap-2">
          <span className="grid size-24 place-items-center rounded-3xl border-[3px] border-foreground bg-status-locked ink-shadow">
            <Lock className="lock-snap size-12" strokeWidth={2.5} />
          </span>
          <span className="font-display text-3xl font-extrabold">Picks locked</span>
        </span>
      )}
    </span>
  );
}
