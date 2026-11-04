"use client";

import { useSyncExternalStore } from "react";
import { formatKickoff } from "@/lib/format";

const noopSubscribe = () => () => {};

/** Fallback zone for the server render (the viewer's zone is unknown there; most players are US East). */
const SERVER_TZ = "America/New_York";

/**
 * A kickoff/lock time in the VIEWER's time zone. Server-rendered pages run in the server's zone (UTC on
 * Vercel), so they must not format times themselves. The server pass shows Eastern time with its zone
 * label; the browser then swaps in local time without a hydration mismatch.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const text = useSyncExternalStore(
    noopSubscribe,
    () => formatKickoff(iso),
    () => formatKickoff(iso, SERVER_TZ),
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
