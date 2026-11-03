import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CircleCheck, Crown, EyeOff, Hourglass, UserRound } from "lucide-react";
import { PageSkeleton } from "@/components/page-skeleton";
import { Sportsbook } from "@/components/sportsbook/sportsbook";
import { LockCountdown } from "@/components/tournament/lock-countdown";
import { ShareButton } from "@/components/tournament/share-button";
import { Badge } from "@/components/ui/badge";
import { toBoardRow } from "@/lib/core/board";
import { normalizeCode } from "@/lib/core/codes";
import type { Rules } from "@/lib/core/slip";
import { publicEnv } from "@/lib/env";
import { MARKET_LABELS, formatCents, formatKickoff, sportEmoji } from "@/lib/format";
import { BOARD_COLUMNS, WAGER_SELECT, toMyWager, type WagerRow } from "@/lib/queries/selects";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/queries";

export const metadata: Metadata = { title: "Lobby" };

type AllowedBetTypes = {
  markets?: string[];
  parlays?: boolean;
  max_parlay_legs?: number;
};

export default function LobbyPage(props: PageProps<"/t/[code]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Lobby {...props} />
    </Suspense>
  );
}

async function Lobby({ params, searchParams }: PageProps<"/t/[code]">) {
  await connection(); // per-request: auth cookies + clock (Cache Components)
  const code = normalizeCode((await params).code);
  const created = (await searchParams).created === "1";

  const viewer = await getViewer();
  if (!viewer) redirect(`/join/${code}`);

  const supabase = await createClient();
  // RLS: only visible to the host and participants. is_locked is a DB-clock computed field.
  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "id, code, title, description, sport_key, host_id, lock_time, status, starting_bankroll_cents, max_bet_cents, allowed_bet_types, is_locked",
    )
    .eq("code", code)
    .maybeSingle();
  if (!t) redirect(`/join/${code}`);

  const [{ data: eventLinks }, { data: roster }, { data: me }] = await Promise.all([
    supabase
      .from("tournament_events")
      .select("events(id, home_team, away_team, commence_time, status)")
      .eq("tournament_id", t.id),
    supabase.rpc("get_roster", { p_tournament_id: t.id }),
    supabase
      .from("tournament_participants")
      .select("id, remaining_bankroll_cents, total_potential_payout_cents")
      .eq("tournament_id", t.id)
      .eq("user_id", viewer.userId)
      .maybeSingle(),
  ]);
  if (!me) redirect(`/join/${code}`);

  const events = (eventLinks ?? [])
    .flatMap((l) => (l.events ? [l.events] : []))
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time));

  const [{ data: boardRows }, { data: wagerRows }] = await Promise.all([
    supabase.from("odds_board").select(BOARD_COLUMNS).in("event_id", events.map((e) => e.id)),
    supabase
      .from("wagers")
      .select(WAGER_SELECT)
      .eq("participant_id", me.id)
      .order("created_at", { ascending: false }),
  ]);

  const allowed = (t.allowed_bet_types ?? {}) as AllowedBetTypes;
  const rules: Rules = {
    markets: allowed.markets ?? [],
    parlays: Boolean(allowed.parlays),
    maxParlayLegs: allowed.max_parlay_legs ?? 6,
    maxBetCents: t.max_bet_cents === null ? null : Number(t.max_bet_cents),
  };
  const isLocked = Boolean(t.is_locked);
  const bankroll = formatCents(t.starting_bankroll_cents);
  const squad = roster ?? [];
  const submitted = squad.filter((p) => p.has_submitted).length;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-10">
      <header>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="font-mono tracking-widest">
            {t.code}
          </Badge>
          <Link href="/account" className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Account">
            <UserRound className="size-4" />
            {viewer.profile?.display_name}
          </Link>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-balance">
          {sportEmoji(t.sport_key)} {t.title}
        </h1>
        {t.description && <p className="mt-1 text-muted-foreground">{t.description}</p>}
        <div className="mt-3 text-sm">
          <LockCountdown lockTime={t.lock_time} />
        </div>
      </header>

      {created && (
        <section className="mt-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <p className="mb-3 text-sm">
            <strong>You&apos;re the host.</strong> Drop the link in the group chat. Friends join in one tap.
          </p>
          <ShareButton
            code={t.code}
            url={`${publicEnv.siteUrl}/join/${t.code}`}
            title={t.title}
            bankrollLabel={bankroll}
          />
        </section>
      )}

      <Sportsbook
        tournamentId={t.id}
        participantId={me.id}
        isLocked={isLocked}
        rules={rules}
        events={events}
        initialBoard={(boardRows ?? []).map(toBoardRow)}
        initialWagers={((wagerRows ?? []) as unknown as WagerRow[]).map(toMyWager)}
        initialBankroll={{
          remainingCents: Number(me.remaining_bankroll_cents),
          potentialPayoutCents: Number(me.total_potential_payout_cents),
        }}
      />

      <section className="mt-8">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Squad · {isLocked ? squad.length : `${submitted}/${squad.length} locked in`}
        </h2>
        <ul className="space-y-2">
          {squad.map((p) => (
            <li key={p.user_id} className="flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-border">
              <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 font-semibold text-emerald-300">
                {p.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {p.display_name}
                {p.user_id === viewer.userId && <span className="text-muted-foreground"> (you)</span>}
                {p.is_host && <Crown className="ml-1.5 inline size-4 text-amber-400" aria-label="Host" />}
              </span>
              {!isLocked &&
                (p.has_submitted ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CircleCheck className="size-4" /> Picks in
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Hourglass className="size-4" /> Thinking…
                  </span>
                ))}
            </li>
          ))}
        </ul>
        {!isLocked && !created && (
          <ShareButton
            className="mt-3"
            code={t.code}
            url={`${publicEnv.siteUrl}/join/${t.code}`}
            title={t.title}
            bankrollLabel={bankroll}
          />
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Rules</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Rule label="Bankroll" value={bankroll} />
          <Rule label="Max bet" value={rules.maxBetCents ? formatCents(rules.maxBetCents) : "No limit"} />
          <Rule label="Bets" value={rules.markets.map((m) => MARKET_LABELS[m] ?? m).join(", ")} />
          <Rule label="Parlays" value={rules.parlays ? `Up to ${rules.maxParlayLegs} legs` : "Off"} />
        </dl>
        <p className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          <EyeOff className="mt-0.5 size-4 shrink-0" />
          Picks stay hidden from everyone until {formatKickoff(t.lock_time)}, then they&apos;re all revealed at once.
        </p>
      </section>
    </main>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
