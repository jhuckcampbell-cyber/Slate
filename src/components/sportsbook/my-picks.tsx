"use client";

import { Odds } from "@/components/odds";
import { EyeOff, Loader2, Ticket, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/errors";
import { formatCents, selectionLabel, shortTeam } from "@/lib/format";
import { useCancelWager, type MyWager } from "@/lib/queries/wagers";
import { cn } from "@/lib/utils";
import type { SportsbookEvent } from "./event-card";

type Props = {
  participantId: string;
  wagers: MyWager[];
  eventsById: ReadonlyMap<string, SportsbookEvent>;
  locked: boolean;
};

export function MyPicks({ participantId, wagers, eventsById, locked }: Props) {
  const router = useRouter();
  const cancel = useCancelWager({ participantId });

  if (wagers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <Ticket className="mx-auto mb-2 size-6" />
        No picks yet. Tap a price under Games to start a slip.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!locked && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <EyeOff className="size-3.5" /> Only you can see these until picks lock.
        </p>
      )}
      <ul className="space-y-2">
        {wagers.map((w) => {
          const cancelling = cancel.isPending && cancel.variables?.id === w.id;
          return (
            <li
              key={w.id}
              className={cn("rounded-2xl bg-card p-3.5 ring-1 ring-border", (w.optimistic || cancelling) && "opacity-60")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {w.wager_type === "parlay" ? `${w.legs.length}-leg parlay` : "Single"} ·{" "}
                  <Odds american={w.odds_american} />
                </span>
                {!locked && !w.optimistic && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    disabled={cancel.isPending}
                    onClick={() =>
                      cancel.mutate(w, {
                        onSuccess: () => {
                          toast("Bet cancelled. Stake refunded.");
                          router.refresh();
                        },
                        onError: (err) => toast.error(friendlyError(err)),
                      })
                    }
                  >
                    {cancelling ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Cancel
                  </Button>
                )}
              </div>
              <ul className="mt-1 space-y-1">
                {w.legs.map((leg) => {
                  const ev = eventsById.get(leg.event_id);
                  return (
                    <li key={leg.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-semibold">
                          {selectionLabel({
                            marketKey: leg.market_key,
                            outcomeName: leg.selection,
                            point: leg.line,
                            participantName: leg.participant_name,
                            participantTeam: leg.participant_team,
                          })}
                        </span>
                        {ev && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {shortTeam(ev.away_team)} @ {shortTeam(ev.home_team)}
                          </span>
                        )}
                      </span>
                      {w.wager_type === "parlay" && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          <Odds american={leg.odds_american} />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 flex items-baseline gap-1.5 text-sm text-muted-foreground">
                <span className="num text-lg font-bold text-foreground">{formatCents(w.amount_cents)}</span> returns
                <span className="num text-lg font-bold text-brand">{formatCents(w.potential_payout_cents)}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
