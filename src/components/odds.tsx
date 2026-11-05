"use client";

import { formatOdds } from "@/lib/plain-english";
import { useOddsFormat } from "@/lib/prefs";

/** A price in the viewer's chosen format (Settings): "-110" or "52%". */
export function Odds({ american, className }: { american: number; className?: string }) {
  const format = useOddsFormat();
  return <span className={className}>{formatOdds(american, format)}</span>;
}
