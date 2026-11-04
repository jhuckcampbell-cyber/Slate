import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EyeOff, UserRound } from "lucide-react";
import { AppBar, DisplayTitle, Eyebrow } from "@/components/brand";
import { InstallHint } from "@/components/install-hint";
import { PageSkeleton } from "@/components/page-skeleton";
import { Leaderboard, type LeaderRow } from "@/components/leaderboard/leaderboard";
import { PropsDesk, type PropLine, type PropResult } from "@/components/leaderboard/props-desk";
import { Reveal, type RevealPlayer } from "@/components/reveal/reveal";
import { Sportsbook } from "@/components/sportsbook/sportsbook";
import type { SportsbookEvent } from "@/components/sportsbook/event-card";
import { HostTools } from "@/components/tournament/host-tools";
import { LockCountdown } from "@/components/tournament/lock-countdown";
import { ShareButton } from "@/components/tournament/share-button";
import { SquadList, type SquadMember } from "@/components/tournament/squad-list";
import { TournamentLive } from "@/components/tournament/tournament-live";
import { Badge } from "@/components/ui/badge";
import { toBoardRow } from "@/lib/core/board";
import { normalizeCode } from "@/lib/core/codes";
import { propLinesToGrade, propMarkets, tournamentMarkets } from "@/lib/core/props";
import type { Rules } from "@/lib/core/slip";
import { publicEnv } from "@/lib/env";
import { MARKET_LABELS, formatCents, formatKickoff, shortTeam, sportEmoji, sportLabel } from "@/lib/format";
import {
  BOARD_COLUMNS,
  REVEAL_WAGER_SELECT,
  WAGER_SELECT,
  toMyWager,
  toRevealedWager,
  type WagerRow,
} from "@/lib/queries/selects";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/queries";

export const metadata: Metadata = { title: "Lobby" };

type AllowedBetTypes = {
  markets?: string[];
  parlays?: boolean;
  max_parlay_legs?: number;
  player_props?: boolean;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

const STATUS_LABELS: Record<string, string> = { locked: "Locked", live: "Live", settled: "Final" };

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
  // RLS: only visible to the host and participants. is_locked/server_now are DB-clock computed fields.
  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "id, code, title, description, sport_key, host_id, lock_time, status, starting_bankroll_cents, max_bet_cents, allowed_bet_types, updated_at, is_locked, server_now",
    )
    .eq("code", code)
    .maybeSingle();
  if (!t) redirect(`/join/${code}`);

  const [{ data: eventLinks }, { data: roster }, { data: me }] = await Promise.all([
    supabase
      .from("tournament_events")
      .select("events(id, home_team, away_team, commence_time, status, home_score, away_score)")
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

  const allowed = (t.allowed_bet_types ?? {}) as AllowedBetTypes;
  const gameMarkets = allowed.markets ?? [];
  const playerProps = Boolean(allowed.player_props) && propMarkets(t.sport_key).length > 0;
  const rules: Rules = {
    // Everything bettable (mirrors place_wagers): game markets + the sport's props if enabled.
    markets: tournamentMarkets(t.sport_key, gameMarkets, playerProps),
    parlays: Boolean(allowed.parlays),
    maxParlayLegs: allowed.max_parlay_legs ?? 6,
    maxBetCents: t.max_bet_cents === null ? null : Number(t.max_bet_cents),
  };
  const isLocked = Boolean(t.is_locked);
  const isHost = t.host_id === viewer.userId;
  const bankroll = formatCents(t.starting_bankroll_cents);
  const squad: SquadMember[] = roster ?? [];
  const shareUrl = `${publicEnv.siteUrl}/join/${t.code}`;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-10">
      <TournamentLive
        tournamentId={t.id}
        code={t.code}
        viewerUserId={viewer.userId}
        renderedVersion={t.updated_at}
        sweating={t.status === "live"}
      />

      <header>
        <AppBar>
          <Badge variant="outline" className="h-7 font-mono tracking-widest">
            {t.code}
          </Badge>
          <Link
            href="/account"
            aria-label="Account"
            className="flex size-9 items-center justify-center rounded-full bg-card font-display text-base font-bold ring-1 ring-border"
          >
            {viewer.profile?.display_name?.slice(0, 1).toUpperCase() ?? <UserRound className="size-4" />}
          </Link>
        </AppBar>
        <Eyebrow className="mt-6">
          {sportEmoji(t.sport_key)} {sportLabel(t.sport_key)} · {events.length} {events.length === 1 ? "game" : "games"}
          {isLocked && <span className="text-warn"> · {STATUS_LABELS[t.status] ?? "Locked"}</span>}
        </Eyebrow>
        <DisplayTitle className="mt-1.5">{t.title}</DisplayTitle>
        {t.description && <p className="mt-2 text-muted-foreground">{t.description}</p>}
        <div className="mt-3 inline-flex rounded-full bg-card px-3.5 py-1.5 text-sm ring-1 ring-border">
          <LockCountdown lockTime={t.lock_time} serverNow={t.server_now ?? undefined} isLocked={isLocked} />
        </div>
      </header>

      {isLocked ? (
        <RevealSection
          supabase={supabase}
          tournamentId={t.id}
          events={events}
          squad={squad}
          viewerUserId={viewer.userId}
          settled={t.status === "settled"}
          startingBankrollCents={Number(t.starting_bankroll_cents)}
        />
      ) : (
        <>
          {created && (
            <section className="mt-6 rounded-2xl border border-brand/40 bg-brand/5 p-4">
              <p className="mb-3 text-sm">
                <strong>You&apos;re the host.</strong> Drop the link in the group chat. Friends join in one tap.
              </p>
              <ShareButton code={t.code} url={shareUrl} title={t.title} bankrollLabel={bankroll} />
            </section>
          )}

          {isHost && (
            <HostTools
              tournamentId={t.id}
              rules={{
                title: t.title,
                lockTime: t.lock_time,
                maxBetCents: rules.maxBetCents,
                startingBankrollCents: t.starting_bankroll_cents,
                markets: gameMarkets,
                parlays: rules.parlays,
                maxParlayLegs: rules.maxParlayLegs,
                playerProps,
              }}
              firstKickoff={events[0]?.commence_time ?? t.lock_time}
              canEditBankroll={squad.length === 1 && Number(me.total_potential_payout_cents) === 0}
              waitingOn={squad.filter((m) => !m.has_submitted && m.user_id !== viewer.userId).map((m) => m.display_name)}
              propsAvailable={propMarkets(t.sport_key).length > 0}
            />
          )}

          <PreLockSportsbook
            supabase={supabase}
            tournamentId={t.id}
            participantId={me.id}
            rules={rules}
            events={events}
            bankroll={{
              remainingCents: Number(me.remaining_bankroll_cents),
              potentialPayoutCents: Number(me.total_potential_payout_cents),
            }}
          />

          <SquadList
            tournamentId={t.id}
            members={squad}
            viewerUserId={viewer.userId}
            showStatus
            canRemove={isHost}
          >
            {!created && (
              <ShareButton className="mt-3" code={t.code} url={shareUrl} title={t.title} bankrollLabel={bankroll} />
            )}
          </SquadList>
        </>
      )}

      <InstallHint className="mt-8" />

      <section className="mt-8" aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Rules
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Rule label="Bankroll" value={bankroll} />
          <Rule label="Max bet" value={rules.maxBetCents ? formatCents(rules.maxBetCents) : "No limit"} />
          <Rule
            label="Bets"
            value={
              gameMarkets.map((m) => MARKET_LABELS[m] ?? m).join(", ") + (playerProps ? " + player props" : "")
            }
          />
          <Rule label="Parlays" value={rules.parlays ? `Up to ${rules.maxParlayLegs} legs` : "Off"} />
        </dl>
        {!isLocked && (
          <p className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
            <EyeOff className="mt-0.5 size-4 shrink-0" />
            Picks stay hidden from everyone until {formatKickoff(t.lock_time)}, then they&apos;re all revealed at once.
          </p>
        )}
      </section>
    </main>
  );
}

async function PreLockSportsbook({
  supabase,
  tournamentId,
  participantId,
  rules,
  events,
  bankroll,
}: {
  supabase: Supabase;
  tournamentId: string;
  participantId: string;
  rules: Rules;
  events: SportsbookEvent[];
  bankroll: { remainingCents: number; potentialPayoutCents: number };
}) {
  const [{ data: boardRows }, { data: wagerRows }] = await Promise.all([
    supabase.from("odds_board").select(BOARD_COLUMNS).in("event_id", events.map((e) => e.id)),
    supabase
      .from("wagers")
      .select(WAGER_SELECT)
      .eq("participant_id", participantId)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <Sportsbook
      tournamentId={tournamentId}
      participantId={participantId}
      isLocked={false}
      rules={rules}
      events={events}
      initialBoard={(boardRows ?? []).map(toBoardRow)}
      initialWagers={((wagerRows ?? []) as unknown as WagerRow[]).map(toMyWager)}
      initialBankroll={bankroll}
    />
  );
}

/** Post-lock: RLS now returns every participant's wagers and bankroll. */
async function RevealSection({
  supabase,
  tournamentId,
  events,
  squad,
  viewerUserId,
  settled,
  startingBankrollCents,
}: {
  supabase: Supabase;
  tournamentId: string;
  events: SportsbookEvent[];
  squad: SquadMember[];
  viewerUserId: string;
  settled: boolean;
  startingBankrollCents: number;
}) {
  const [{ data: wagerRows }, { data: participants }, { data: board }, { data: propRows }] = await Promise.all([
    supabase.from("wagers").select(REVEAL_WAGER_SELECT).eq("tournament_id", tournamentId).order("created_at"),
    supabase
      .from("tournament_participants")
      .select("id, user_id, remaining_bankroll_cents")
      .eq("tournament_id", tournamentId),
    supabase
      .from("leaderboard")
      .select("participant_id, user_id, display_name, cash_cents, ev_cents, max_cents, rank, standing")
      .eq("tournament_id", tournamentId),
    supabase
      .from("prop_results")
      .select("event_id, market_key, participant_name, stat")
      .eq("tournament_id", tournamentId)
      .order("graded_at"),
  ]);

  const leaders: LeaderRow[] = (board ?? []).map((r) => ({
    participantId: String(r.participant_id),
    name: r.display_name ?? "Player",
    isYou: r.user_id === viewerUserId,
    cashCents: Number(r.cash_cents),
    evCents: Number(r.ev_cents),
    maxCents: Number(r.max_cents),
    rank: Number(r.rank),
    standing: (r.standing ?? "alive") as LeaderRow["standing"],
  }));

  const wagers = (wagerRows ?? []).map(toRevealedWager);

  // Player props: what the host still has to grade, and what was entered (public to the squad).
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const matchupOf = (id: string) => {
    const e = eventsById.get(id);
    return e ? `${shortTeam(e.away_team)} @ ${shortTeam(e.home_team)}` : "";
  };
  const finalIds = new Set(events.filter((e) => e.status === "final").map((e) => e.id));
  const propsToGrade: PropLine[] = propLinesToGrade(
    wagers.flatMap((w) => w.legs),
    finalIds,
  ).map((l) => ({ ...l, matchup: matchupOf(l.eventId) }));
  const propResults: PropResult[] = (propRows ?? []).map((r) => ({
    eventId: r.event_id,
    marketKey: r.market_key,
    player: r.participant_name,
    stat: Number(r.stat),
    matchup: matchupOf(r.event_id),
  }));
  const hostName = squad.find((m) => m.is_host)?.display_name ?? "the host";
  // Unbet = starting bankroll minus stakes (the live bankroll also includes winnings once graded).
  const staked = new Map<string, number>();
  for (const w of wagers) staked.set(w.participantId, (staked.get(w.participantId) ?? 0) + w.amountCents);

  // You first, then everyone in join order (get_roster's order).
  const members = new Map(squad.map((m, joinOrder) => [m.user_id, { ...m, joinOrder }]));
  const players: RevealPlayer[] = (participants ?? [])
    .map((p) => {
      const member = members.get(p.user_id);
      return {
        joinOrder: member?.joinOrder ?? Number.MAX_SAFE_INTEGER,
        player: {
          participantId: p.id,
          name: member?.display_name ?? "Player",
          isHost: member?.is_host ?? false,
          isYou: p.user_id === viewerUserId,
          holdingCents: Math.max(0, startingBankrollCents - (staked.get(p.id) ?? 0)),
        },
      };
    })
    .sort((a, b) => Number(b.player.isYou) - Number(a.player.isYou) || a.joinOrder - b.joinOrder)
    .map((x) => x.player);

  return (
    <>
      <Leaderboard rows={leaders} settled={settled} />
      <PropsDesk
        tournamentId={tournamentId}
        isHost={squad.some((m) => m.is_host && m.user_id === viewerUserId)}
        hostName={hostName}
        pending={propsToGrade}
        results={propResults}
      />
      <Reveal
        tournamentId={tournamentId}
        events={events}
        players={players}
        wagers={wagers}
      />
    </>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-display text-lg leading-tight font-bold">{value}</dd>
    </div>
  );
}
