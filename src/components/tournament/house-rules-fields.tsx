"use client";

import { Minus, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";

/** Host rules shared by Create and Edit rules: "bet the whole bankroll" and "at least N bets". */
export function HouseRulesFields({
  allIn,
  onAllIn,
  minBets,
  onMinBets,
}: {
  allIn: boolean;
  onAllIn: (v: boolean) => void;
  minBets: number;
  onMinBets: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">House rules</p>
      <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border p-3">
        <span>
          <span className="block text-sm font-medium">Bet the whole bankroll</span>
          <span className="text-xs text-muted-foreground">No sitting on cash: everyone has to bet it all.</span>
        </span>
        <Switch aria-label="Bet the whole bankroll" checked={allIn} onCheckedChange={onAllIn} />
      </label>
      <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border p-3">
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
            className="flex size-10 items-center justify-center rounded-full bg-muted disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <output aria-label="Minimum bets" className="num w-7 text-center text-xl font-bold">
            {minBets}
          </output>
          <button
            type="button"
            aria-label="More minimum bets"
            disabled={minBets >= 20}
            onClick={() => onMinBets(Math.min(20, minBets + 1))}
            className="flex size-10 items-center justify-center rounded-full bg-muted disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground">Anyone who misses a house rule finishes below everyone who followed them.</p>
    </div>
  );
}
