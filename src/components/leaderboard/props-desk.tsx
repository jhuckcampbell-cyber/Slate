"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";
import { MARKET_LABELS } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

import { AUTO_PROP_STATS } from "@/lib/core/props";

export type PropLine = { eventId: string; marketKey: string; player: string; matchup: string };

/** What the host types in: anytime TD is graded on touchdowns scored (1+ wins). */
function statName(marketKey: string) {
  return marketKey === "player_anytime_td" ? "Touchdowns scored" : (MARKET_LABELS[marketKey] ?? marketKey);
}
export type PropResult = PropLine & { stat: number | null };

/** Verified box scores settle supported props; the host resolves missing or unsupported data. */
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
  // The route's legacy numeric mapping coerces null to zero. Read authoritative results
  // here so confirmed DNP evidence is displayed correctly even with that older caller.
  const [recorded, setRecorded] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (results.length === 0) return;
    let active = true;
    void createClient().from("prop_results")
      .select("event_id,market_key,participant_name,stat")
      .eq("tournament_id", tournamentId)
      .then(({ data, error }) => {
        if (!active || error) return;
        setRecorded(Object.fromEntries((data ?? []).map((r) => [
          `${tournamentId}|${r.event_id}|${r.market_key}|${r.participant_name}`, r.stat === null ? null : Number(r.stat),
        ])));
      });
    return () => { active = false; };
  }, [tournamentId, results]);

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
              ? "Verified box scores settle supported props automatically. Enter a stat below to resolve missing data. Team D/ST TD and unsupported markets are host-graded."
              : `Waiting for verified box scores or ${hostName} to enter the stats.`}
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
              <span className="num text-lg font-bold">{!(`${tournamentId}|${key(r)}` in recorded) ? "Recorded" : recorded[`${tournamentId}|${key(r)}`] === null ? "Did not play: void" : recorded[`${tournamentId}|${key(r)}`]}</span>
            </li>
          ))}
          <li className="pt-1 text-xs text-muted-foreground">Results are final. A confirmed DNP voids all props for that player.</li>
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
      <span className="text-muted-foreground"> · {statName(line.marketKey)}</span>
      <span className="block text-xs text-muted-foreground">{line.matchup}</span>
    </span>
  );
}

function GradeRow({ tournamentId, line }: { tournamentId: string; line: PropLine }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const label = `${line.player} ${statName(line.marketKey)}`;

  async function submit(form: FormData) {
    const raw = String(form.get("stat") ?? "").trim();
    const didNotPlay = form.get("didNotPlay") === "on";
    const stat = Number(raw);
    const yards = ["player_pass_yds", "player_rush_yds", "player_reception_yds"].includes(line.marketKey.replace(/_alternate$/, ""));
    if (!didNotPlay && (raw === "" || !Number.isInteger(stat) || stat < (yards ? -999 : 0) || stat > 9999)) {
      toast.error("Enter a whole-number stat. Only yards may be negative.");
      return;
    }
    setPending(true);
    const args = {
      p_tournament_id: tournamentId,
      p_event_id: line.eventId,
      p_market_key: line.marketKey,
      p_participant_name: line.player,
      p_stat: didNotPlay ? 0 : stat,
      p_did_not_play: didNotPlay,
    };
    const { error } = await createClient().rpc("grade_prop", args);
    setPending(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success(didNotPlay ? `${line.player} did not play. Picks voided.` : `${label}: ${stat}. Picks graded.`);
    router.refresh();
  }

  return (
    <li>
      <form action={submit} className="flex flex-wrap items-center gap-2">
        <div className="w-full min-w-0 text-sm">
          <LineLabel line={line} />
          <span className="text-xs text-muted-foreground">{Object.values(AUTO_PROP_STATS).some((markets) => markets.includes(line.marketKey.replace(/_alternate$/, ""))) ? "Box score when verified ? host override available" : "Host-graded market"}</span>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-xs">
          <input type="checkbox" className="size-5 accent-foreground" name="didNotPlay" aria-label={`${line.player} confirmed did not play`} />
          Did not play
        </label>
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
