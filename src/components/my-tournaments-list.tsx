import Link from "next/link";
import { connection } from "next/server";
import { cache } from "react";
import { ChevronDown } from "lucide-react";
import { Eyebrow, StubTear, stub } from "@/components/brand";
import { LocalTime } from "@/components/local-time";
import { formatShortDate, shortTeam, sportEmoji } from "@/lib/format";
import {
  finishLabel,
  ordinal,
  orderMyTournaments,
  tournamentStatusLabel,
  type MyTournament,
} from "@/lib/my-tournaments";
import { getViewer } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

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
  /** Final: your place (null if unknown) and how many played. */
  place: number | null;
  players: number;
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

/** This device's player's tournaments, ordered and labeled (RLS: own memberships only). Once per request. */
export const loadMyTournaments = cache(async function loadMyTournaments(): Promise<MyTournamentItem[]> {
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
      place: mine.get(row.id) ?? null,
      players: field.get(row.id) ?? 0,
    };
  });
});

/** Home, under the main buttons: tournaments still in play. Nothing when there are none. */
export async function MyTournamentsList({ className }: { className?: string }) {
  const current = (await loadMyTournaments()).filter((t) => t.label !== "Final");
  if (current.length === 0) return null;

  return (
    <section aria-labelledby="my-tournaments" className={className}>
      <Eyebrow>
        <span id="my-tournaments">Your tournaments</span>
      </Eyebrow>
      <ul className="mt-2.5 space-y-2">
        {current.map((t) => (
          <li key={t.code}>
            <Link href={`/t/${t.code}`} className={stub("default", "transition-transform active:scale-[0.99]")}>
              <StubMain t={t}>
                {t.score ? (
                  <span className="font-medium text-foreground tabular-nums">{t.score}</span>
                ) : t.label === "Open" ? (
                  <>
                    Locks <LocalTime iso={t.lockTime} />
                  </>
                ) : (
                  "Picks locked"
                )}
                <span aria-hidden> · </span>
                <span className="font-mono tracking-wider">{t.code}</span>
                {t.isHost && <span> · Host</span>}
              </StubMain>
              <StubTear>
                <StatusTag label={t.label} />
              </StubTear>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PAST_SHOWN = 3;

/**
 * Home, near the bottom: finished tournaments, most recent first, each a stub with your place on the tear-off.
 * First-time visitors see one empty stub saying where these will land.
 */
export async function PastTournaments({ className }: { className?: string }) {
  const past = (await loadMyTournaments()).filter((t) => t.label === "Final");
  const shown = past.slice(0, PAST_SHOWN);
  const more = past.slice(PAST_SHOWN);

  return (
    <section aria-labelledby="past-tournaments" className={className}>
      <div className="flex items-baseline justify-between">
        <Eyebrow>
          <span id="past-tournaments">Past tournaments</span>
        </Eyebrow>
        {past.length > 0 && <span className="num text-sm text-muted-foreground">{past.length}</span>}
      </div>
      {past.length === 0 ? (
        <div className={stub("ghost", "mt-2.5")}>
          <div className="flex min-w-0 flex-1 items-center px-4 py-3 text-sm text-muted-foreground">
            Your finished tournaments land here, with where you placed.
          </div>
          <StubTear>
            <span className="num text-2xl font-bold text-foreground/25">1st?</span>
          </StubTear>
        </div>
      ) : (
        <>
          <PastList items={shown} />
          {more.length > 0 && (
            <details className="group mt-2">
              <summary className="flex h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show all {past.length}</span>
                <span className="hidden group-open:inline">Show fewer</span>
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <PastList items={more} />
            </details>
          )}
        </>
      )}
    </section>
  );
}

function PastList({ items }: { items: MyTournamentItem[] }) {
  return (
    <ul aria-label="Past tournaments" className="mt-2.5 space-y-2">
      {items.map((t) => (
        <li key={t.code}>
          <Link href={`/t/${t.code}`} className={stub("default", "transition-transform active:scale-[0.99]")}>
            <StubMain t={t}>
              {formatShortDate(t.lockTime)}
              {t.players > 0 && ` · ${t.players} ${t.players === 1 ? "player" : "players"}`}
              {t.isHost && " · Host"}
            </StubMain>
            <StubTear winner={t.place === 1}>
              {t.place === null ? (
                <span className="text-xs font-semibold text-muted-foreground">Final</span>
              ) : (
                <>
                  <span className="num text-[1.7rem]/none font-extrabold">{ordinal(t.place)}</span>
                  {t.players > 1 && (
                    <span
                      className={cn(
                        "mt-0.5 text-[11px] font-medium",
                        t.place === 1 ? "text-hype-foreground/85" : "text-muted-foreground",
                      )}
                    >
                      of {t.players}
                    </span>
                  )}
                </>
              )}
            </StubTear>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The left side of a tournament stub: sport, title, one line of detail. */
function StubMain({ t, children }: { t: MyTournamentItem; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 pl-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl" aria-hidden>
        {sportEmoji(t.sportKey)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{t.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{children}</span>
      </span>
    </span>
  );
}

/** Where a tournament in play stands, on its tear-off side. */
function StatusTag({ label }: { label: string }) {
  if (label === "Live")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-bold">
        <span className="live-dot" aria-hidden /> Live
      </span>
    );
  return <span className={cn("text-sm font-bold", label === "Locked" ? "text-warn" : "text-foreground")}>{label}</span>;
}
