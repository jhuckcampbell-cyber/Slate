"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";
import { MARKET_LABELS } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

export type PropLine = { eventId: string; marketKey: string; player: string; matchup: string };
export type PropResult = PropLine & { stat: number };

/**
 * Player props are graded by hand (the odds API has no player stats). After a game is final the
 * host enters each stat once; it grades every pick on that line the same way, and the squad sees
 * every number that was entered.
 */
export function PropsDesk({
  tournamentId,
  isHost,
  hostName,
  pending,
  results,
}: {
  tournamentId: string;
  isHost: boolean;
  hostName: string;
  pending: PropLine[];
  results: PropResult[];
}) {
  if (pending.length === 0 && results.length === 0) return null;
  return (
    <section className="mt-6 rounded-2xl bg-card p-4 ring-1 ring-border" aria-labelledby="props-desk-heading">
      <h2 id="props-desk-heading" className="flex items-center gap-2 font-display text-xl font-bold uppercase">
        <ClipboardCheck className="size-5 text-warn" /> Player props
      </h2>

      {pending.length > 0 && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {isHost
              ? "Games are final. Enter each player's real stat to grade everyone's picks."
              : `Waiting on ${hostName} to enter the stats.`}
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map((line) =>
              isHost ? (
                <GradeRow key={key(line)} tournamentId={tournamentId} line={line} />
              ) : (
                <li key={key(line)} className="text-sm">
                  <LineLabel line={line} />
                </li>
              ),
            )}
          </ul>
        </>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          {results.map((r) => (
            <li key={key(r)} className="flex items-baseline justify-between gap-3">
              <LineLabel line={r} />
              <span className="num text-lg font-bold">{r.stat}</span>
            </li>
          ))}
          <li className="pt-1 text-xs text-muted-foreground">Entered by {hostName}.</li>
        </ul>
      )}
    </section>
  );
}

const key = (l: PropLine) => `${l.eventId}|${l.marketKey}|${l.player}`;

function LineLabel({ line }: { line: PropLine }) {
  return (
    <span className="min-w-0">
      <span className="font-medium">{line.player}</span>
      <span className="text-muted-foreground"> · {MARKET_LABELS[line.marketKey] ?? line.marketKey}</span>
      <span className="block text-xs text-muted-foreground">{line.matchup}</span>
    </span>
  );
}

function GradeRow({ tournamentId, line }: { tournamentId: string; line: PropLine }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const label = `${line.player} ${MARKET_LABELS[line.marketKey] ?? line.marketKey}`;

  async function submit(form: FormData) {
    const raw = String(form.get("stat") ?? "").trim();
    const stat = Number(raw);
    if (raw === "" || !Number.isFinite(stat) || stat < 0) {
      toast.error("Enter the stat as a number, 0 or more.");
      return;
    }
    setPending(true);
    const { error } = await createClient().rpc("grade_prop", {
      p_tournament_id: tournamentId,
      p_event_id: line.eventId,
      p_market_key: line.marketKey,
      p_participant_name: line.player,
      p_stat: stat,
    });
    setPending(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success(`${label}: ${stat}. Picks graded.`);
    router.refresh();
  }

  return (
    <li>
      <form action={submit} className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <LineLabel line={line} />
        </div>
        <Input
          name="stat"
          inputMode="decimal"
          aria-label={`${label} stat`}
          placeholder="Stat"
          className="h-11 w-20 text-base"
        />
        <Button type="submit" variant="secondary" className="h-11" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enter
        </Button>
      </form>
    </li>
  );
}
