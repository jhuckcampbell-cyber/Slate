"use client";

import { Lock, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCountdown } from "@/lib/format";
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
}: {
  lockTime: string;
  serverNow?: string;
  /** The server already rendered the locked state: nothing to count down or refresh. */
  isLocked?: boolean;
}) {
  const router = useRouter();
  const target = new Date(lockTime).getTime();
  const now = useServerNow(serverNow);

  const remaining = now === null ? null : target - now;
  const locked = isLocked || (remaining !== null && remaining <= 0);

  useEffect(() => {
    if (locked && !isLocked) router.refresh();
  }, [locked, isLocked, router]);

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
