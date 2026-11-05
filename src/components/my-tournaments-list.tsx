import Link from "next/link";
import { connection } from "next/server";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { Eyebrow } from "@/components/brand";
import { LocalTime } from "@/components/local-time";
import { shortTeam, sportEmoji } from "@/lib/format";
import { finishLabel, orderMyTournaments, tournamentStatusLabel, type MyTournament } from "@/lib/my-tournaments";
import { getViewer } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-brand/15 text-brand ring-brand/30",
  Locked: "bg-warn/15 text-warn ring-warn/30",
  Live: "bg-hype/15 text-hype ring-hype/30",
  Final: "bg-muted text-muted-foreground ring-border",
};

type EventRow = {
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  commence_time: string;
  game_live: { state: string; detail: string | null; home_score: number | null; away_score: number | null } | null;
};

type Row = {
  tournaments: {
    id: string;
    code: string;
    title: string;
    sport_key: string;
    status: string;
    lock_time: string;
    host_id: string;
    tournament_events: { events: EventRow | null }[];
  } | null;
};

export type MyTournamentItem = MyTournament & {
  label: string;
  /** Live: "Jaguars 10 · Ravens 17 · 8:21 - 3rd" */
  score: string | null;
  /** Final: "🏆 Won", "2nd of 5" */
  finish: string | null;
};

function scoreText(events: EventRow[]): string | null {
  const e = events.find((x) => x.game_live?.state === "in") ?? events.find((x) => x.home_score !== null);
  if (!e) return null;
  const home = e.game_live?.home_score ?? e.home_score;
  const away = e.game_live?.away_score ?? e.away_score;
  if (home === null || away === null) return null;
  const clock = e.game_live?.state === "in" && e.game_live.detail ? ` · ${e.game_live.detail}` : "";
  return `${shortTeam(e.away_team)} ${away} · ${shortTeam(e.home_team)} ${home}${clock}`;
}

/** This device's player's tournaments, ordered and labeled (RLS: own memberships only). */
export async function loadMyTournaments(): Promise<MyTournamentItem[]> {
  await connection(); // per-request: auth cookie + the clock
  const viewer = await getViewer();
  if (!viewer) return [];

  const supabase = await createClient();
  const [{ data }, { data: standings }] = await Promise.all([
    supabase
      .from("tournament_participants")
      .select(
        "tournaments(id, code, title, sport_key, status, lock_time, host_id, tournament_events(events(home_team, away_team, home_score, away_score, commence_time, game_live(state, detail, home_score, away_score))))",
      )
      .eq("user_id", viewer.userId)
      .returns<Row[]>(),
    // After lock the leaderboard shows everyone, so these are real places out of the whole field.
    supabase.from("leaderboard").select("tournament_id, user_id, rank"),
  ]);

  const field = new Map<string, number>();
  const mine = new Map<string, number>();
  for (const s of standings ?? []) {
    field.set(String(s.tournament_id), (field.get(String(s.tournament_id)) ?? 0) + 1);
    if (s.user_id === viewer.userId) mine.set(String(s.tournament_id), Number(s.rank));
  }

  const rows = (data ?? []).flatMap((r) => (r.tournaments ? [r.tournaments] : []));
  const byCode = new Map(rows.map((t) => [t.code, t]));
  const list: MyTournament[] = rows.map((t) => ({
    code: t.code,
    title: t.title,
    sportKey: t.sport_key,
    status: t.status,
    lockTime: t.lock_time,
    isHost: t.host_id === viewer.userId,
  }));
  const now = Date.now();
  return orderMyTournaments(list).map((t) => {
    const row = byCode.get(t.code)!;
    const label = tournamentStatusLabel(t, now);
    const events = row.tournament_events.flatMap((te) => (te.events ? [te.events] : []));
    return {
      ...t,
      label,
      score: label === "Live" || label === "Locked" ? scoreText(events) : null,
      finish: label === "Final" ? finishLabel(mine.get(row.id) ?? null, field.get(row.id) ?? 0) : null,
    };
  });
}

/** Home menu: "Playing now" up top, finished ones folded into "Past tournaments". Nothing for first-time visitors. */
export async function MyTournamentsList({ className }: { className?: string }) {
  const list = await loadMyTournaments();
  if (list.length === 0) return null;
  const current = list.filter((t) => t.label !== "Final");
  const past = list.filter((t) => t.label === "Final");

  return (
    <div className={cn("space-y-6", className)}>
      {current.length > 0 && (
        <section aria-labelledby="my-tournaments">
          <Eyebrow>
            <span id="my-tournaments">Your tournaments</span>
          </Eyebrow>
          <ul className="mt-2 space-y-2">
            {current.map((t) => (
              <li key={t.code}>
                <TournamentRow t={t} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <details className="group rounded-2xl bg-card/60 ring-1 ring-border" open={current.length === 0}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
            <History className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm font-semibold">Past tournaments</span>
            <span className="text-xs text-muted-foreground">{past.length}</span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ul aria-label="Past tournaments" className="space-y-2 px-2 pb-2">
            {past.map((t) => (
              <li key={t.code}>
                <TournamentRow t={t} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TournamentRow({ t }: { t: MyTournamentItem }) {
  return (
    <Link
      href={`/t/${t.code}`}
      className="flex min-h-16 items-center gap-3 rounded-2xl bg-card px-3 py-2.5 ring-1 ring-border transition-transform active:scale-[0.99]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl" aria-hidden>
        {sportEmoji(t.sportKey)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{t.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {t.score ? (
            <span className="font-medium text-foreground tabular-nums">{t.score}</span>
          ) : t.finish ? (
            <span className="font-medium text-foreground">{t.finish}</span>
          ) : t.label === "Open" ? (
            <>
              Locks <LocalTime iso={t.lockTime} />
            </>
          ) : null}
          {(t.score || t.finish || t.label === "Open") && " · "}
          <span className="font-mono tracking-wider">{t.code}</span>
          {t.isHost && <span> · Host</span>}
        </span>
      </span>
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", STATUS_STYLE[t.label])}>{t.label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
