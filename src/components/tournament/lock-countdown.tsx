"use client";

import { Lock, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCountdown } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";

/**
 * Display-only countdown. The DB decides when picks lock/reveal (CLAUDE.md rule 5);
 * at zero we just refresh so server components re-read under RLS.
 */
export function LockCountdown({ lockTime }: { lockTime: string }) {
  const router = useRouter();
  const target = new Date(lockTime).getTime();
  const now = useNow();

  const remaining = now === null ? null : target - now;
  const locked = remaining !== null && remaining <= 0;

  useEffect(() => {
    if (locked) router.refresh();
  }, [locked, router]);

  if (locked) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
        <Lock className="size-4" /> Picks locked
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <Timer className="size-4 text-emerald-400" />
      Locks in <strong>{remaining === null ? "…" : formatCountdown(remaining)}</strong>
    </span>
  );
}
