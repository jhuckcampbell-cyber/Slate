import Link from "next/link";
import { connection } from "next/server";
import { ChevronRight } from "lucide-react";
import { Eyebrow } from "@/components/brand";
import { LocalTime } from "@/components/local-time";
import { sportEmoji } from "@/lib/format";
import { orderMyTournaments, tournamentStatusLabel, type MyTournament } from "@/lib/my-tournaments";
import { getViewer } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-brand/15 text-brand ring-brand/30",
  Locked: "bg-warn/15 text-warn ring-warn/30",
  Live: "bg-hype/15 text-hype ring-hype/30",
  Final: "bg-muted text-muted-foreground ring-border",
};

type Row = {
  tournaments: {
    code: string;
    title: string;
    sport_key: string;
    status: string;
    lock_time: string;
    host_id: string;
  } | null;
};

/** This device's player's tournaments, ordered and labeled (RLS: own memberships only). */
async function loadMyTournaments() {
  await connection(); // per-request: auth cookie + the clock
  const viewer = await getViewer();
  if (!viewer) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_participants")
    .select("tournaments(code, title, sport_key, status, lock_time, host_id)")
    .eq("user_id", viewer.userId)
    .returns<Row[]>();

  const list: MyTournament[] = (data ?? []).flatMap((r) =>
    r.tournaments
      ? [
          {
            code: r.tournaments.code,
            title: r.tournaments.title,
            sportKey: r.tournaments.sport_key,
            status: r.tournaments.status,
            lockTime: r.tournaments.lock_time,
            isHost: r.tournaments.host_id === viewer.userId,
          },
        ]
      : [],
  );
  const now = Date.now();
  return orderMyTournaments(list).map((t) => ({ ...t, label: tournamentStatusLabel(t, now) }));
}

/** "Your tournaments" on the home screen; renders nothing for a first-time visitor. */
export async function MyTournamentsList({ className }: { className?: string }) {
  const list = await loadMyTournaments();
  if (list.length === 0) return null;

  return (
    <section aria-labelledby="my-tournaments" className={className}>
      <Eyebrow>
        <span id="my-tournaments">Your tournaments</span>
      </Eyebrow>
      <ul className="mt-2 space-y-2">
        {list.map((t) => {
          const label = t.label;
          return (
            <li key={t.code}>
              <Link
                href={`/t/${t.code}`}
                className="flex min-h-14 items-center gap-3 rounded-2xl bg-card px-3 py-2.5 ring-1 ring-border active:scale-[0.99]"
              >
                <span className="text-xl" aria-hidden>
                  {sportEmoji(t.sportKey)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="font-mono tracking-wider">{t.code}</span>
                    {t.isHost && <span> · Host</span>}
                    {label === "Open" && (
                      <>
                        {" · Locks "}
                        <LocalTime iso={t.lockTime} />
                      </>
                    )}
                  </span>
                </span>
                <span
                  className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", STATUS_STYLE[label])}
                >
                  {label}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
