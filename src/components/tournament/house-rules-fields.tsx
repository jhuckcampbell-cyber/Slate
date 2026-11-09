"use client";

import { Minus, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";

/** Host rules shared by Create and Edit rules: "bet the whole bankroll" and "at least N bets". */
export function HouseRulesFields({
  allIn,
  onAllIn,
  minBets,
  onMinBets,
  tokenCount = null,
}: {
  allIn: boolean;
  onAllIn: (v: boolean) => void;
  minBets: number;
  onMinBets: (v: number) => void;
  /** Token mode: every token must be used already (no all-in switch), and no more bets than tokens. */
  tokenCount?: number | null;
}) {
  const maxBets = tokenCount ?? 20;
  return (
    <div className="space-y-2">
      <p className="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">House rules</p>
      {tokenCount === null && (
        <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-foreground bg-card p-3">
          <span>
            <span className="block text-sm font-medium">Bet the whole bankroll</span>
            <span className="text-xs text-muted-foreground">No sitting on cash: everyone has to bet it all.</span>
          </span>
          <Switch aria-label="Bet the whole bankroll" checked={allIn} onCheckedChange={onAllIn} />
        </label>
      )}
      <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-foreground bg-card p-3">
        <span>
          <span className="block text-sm font-medium" id="min-bets-label">
            Minimum bets
          </span>
          <span className="text-xs text-muted-foreground">
            {minBets === 0 ? "None: one big bet is fine." : `Everyone makes at least ${minBets}.`}
          </span>
        </span>
        <div className="flex items-center gap-1" role="group" aria-labelledby="min-bets-label">
          <button
            type="button"
            aria-label="Fewer minimum bets"
            disabled={minBets <= 0}
            onClick={() => onMinBets(Math.max(0, minBets - 1))}
            className="flex size-11 items-center justify-center rounded-full border-2 border-foreground bg-card disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <output aria-label="Minimum bets" className="num w-7 text-center text-xl font-bold">
            {minBets}
          </output>
          <button
            type="button"
            aria-label="More minimum bets"
            disabled={minBets >= maxBets}
            onClick={() => onMinBets(Math.min(maxBets, minBets + 1))}
            className="flex size-11 items-center justify-center rounded-full border-2 border-foreground bg-card disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground">Anyone who misses a house rule finishes below everyone who followed them.</p>
    </div>
  );
}
