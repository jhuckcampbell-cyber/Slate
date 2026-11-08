import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronDown, EyeOff, House } from "lucide-react";
import { AppBar, Eyebrow } from "@/components/brand";
import { LiveGames } from "@/components/game/live-games";
import { FinalCelebration } from "@/components/leaderboard/final-celebration";
import { loadMyTournaments } from "@/components/my-tournaments-list";
import { SettingsButton } from "@/components/settings/settings-button";
import { ExitTournament } from "@/components/tournament/exit-tournament";
import { TournamentTitle } from "@/components/tournament/explainer";
import { TournamentSwitcher } from "@/components/tournament/tournament-switcher";
import { explainTournament } from "@/lib/plain-english";
import { InstallHint } from "@/components/install-hint";
import { PageSkeleton } from "@/components/page-skeleton";
import { Leaderboard, type LeaderRow } from "@/components/leaderboard/leaderboard";
import { PropsDesk, type PropLine, type PropResult } from "@/components/leaderboard/props-desk";
import { PlayerBets, Reveal, type RevealPlayer } from "@/components/reveal/reveal";
import { Sportsbook } from "@/components/sportsbook/sportsbook";
import type { SportsbookEvent } from "@/components/sportsbook/event-card";
import { HostTools } from "@/components/tournament/host-tools";
import { LockCountdown } from "@/components/tournament/lock-countdown";
import { ShareButton } from "@/components/tournament/share-button";
import { SquadList, type SquadMember } from "@/components/tournament/squad-list";
import { TournamentLive } from "@/components/tournament/tournament-live";
import { toBoardRow } from "@/lib/core/board";
import { normalizeCode } from "@/lib/core/codes";
import { propLinesToGrade, propMarkets, tournamentMarkets } from "@/lib/core/props";
import type { Rules } from "@/lib/core/slip";
import { publicEnv } from "@/lib/env";
import { MARKET_LABELS, formatCents, shortTeam, sportEmoji, sportLabel } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
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
  same_game_parlays?: boolean;
  all_in?: boolean;
  min_bets?: number;
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

  const [{ data: eventLinks }, { data: roster }, { data: me }, mine] = await Promise.all([
    supabase
      .from("tournament_events")
      .select("events(id, sport_key, home_team, away_team, commence_time, status, home_score, away_score)")
      .eq("tournament_id", t.id),
    supabase.rpc("get_roster", { p_tournament_id: t.id }),
    supabase
      .from("tournament_participants")
      .select("id, remaining_bankroll_cents, total_potential_payout_cents")
      .eq("tournament_id", t.id)
      .eq("user_id", viewer.userId)
      .maybeSingle(),
    loadMyTournaments(),
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
    sameGameParlays: allowed.same_game_parlays ?? true, // mirrors place_wagers' default
    minBets: Number(allowed.min_bets ?? 0),
    allIn: Boolean(allowed.all_in),
  };
  const isLocked = Boolean(t.is_locked);
  const isHost = t.host_id === viewer.userId;
  const bankroll = formatCents(t.starting_bankroll_cents);
  const squad: SquadMember[] = roster ?? [];
  const shareUrl = `${publicEnv.siteUrl}/join/${t.code}`;
  const allIn = Boolean(allowed.all_in);
  const minBets = Number(allowed.min_bets ?? 0);
  const hostName = squad.find((m) => m.is_host)?.display_name ?? "Your friend";
  const explainer = explainTournament({
    bankrollCents: Number(t.starting_bankroll_cents),
    games: events.map((e) => `${shortTeam(e.away_team)} @ ${shortTeam(e.home_team)}`),
    markets: gameMarkets,
    parlays: rules.parlays,
    playerProps,
    maxBetCents: rules.maxBetCents,
    allIn,
    minBets,
    hostName: isHost ? null : hostName,
  });
  const switcher = mine.map((m) => ({
    code: m.code,
    title: m.title,
    sportKey: m.sportKey,
    label: m.label,
    detail: m.score ?? m.finish,
  }));

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
          <Link
            href="/"
            aria-label="Home"
            className="flex size-10 items-center justify-center rounded-full bg-card ring-1 ring-border"
          >
            <House className="size-[18px]" aria-hidden />
          </Link>
          <TournamentSwitcher current={t.code} items={switcher} />
          <SettingsButton />
        </AppBar>
        <Eyebrow className="mt-6">
          {sportEmoji(t.sport_key)} {sportLabel(t.sport_key)} · {events.length} {events.length === 1 ? "game" : "games"}
          {isLocked && <span className="text-warn"> · {STATUS_LABELS[t.status] ?? "Locked"}</span>}
        </Eyebrow>
        <TournamentTitle title={t.title} sections={explainer} />
        {t.description && <p className="mt-2 text-muted-foreground">{t.description}</p>}
        <div className="mt-3 inline-flex rounded-full bg-card px-3.5 py-1.5 text-sm ring-1 ring-border">
          <LockCountdown lockTime={t.lock_time} serverNow={t.server_now ?? undefined} isLocked={isLocked} />
        </div>
      </header>

      {/* One line with what matters (bankroll and house rules); tap for the rest. */}
      <section className="mt-5" aria-labelledby="rules-heading">
        <details className="group rounded-2xl bg-card ring-1 ring-border">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
            <h2 id="rules-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Rules
            </h2>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {[
                `${bankroll} each`,
                allIn && "Bet it all",
                minBets > 0 && `${minBets}+ bets`,
                rules.maxBetCents && `${formatCents(rules.maxBetCents)} max bet`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border px-3.5 pt-3 pb-3.5 text-sm">
          <Rule label="Bankroll" value={bankroll} />
          <Rule label="Max bet" value={rules.maxBetCents ? formatCents(rules.maxBetCents) : "No limit"} />
          <Rule
            label="Bets"
            value={
              gameMarkets.map((m) => MARKET_LABELS[m] ?? m).join(", ") + (playerProps ? " + player props" : "")
            }
          />
          <Rule
            label="Parlays"
            value={
              rules.parlays
                ? `Up to ${rules.maxParlayLegs} legs${rules.sameGameParlays ? ", same-game OK" : ", one per game"}`
                : "Off"
            }
          />
          </dl>
        </details>
        {!isLocked && (
          <p className="mt-2 flex gap-2 px-1 text-xs text-muted-foreground">
            <EyeOff className="size-3.5 shrink-0" />
            <span>
              Picks stay hidden from everyone until <LocalTime iso={t.lock_time} />, then they&apos;re all revealed at
              once.
            </span>
          </p>
        )}
      </section>

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
                sameGameParlays: rules.sameGameParlays,
                allIn,
                minBets,
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
            houseRules={allIn || minBets > 0 ? { allIn, minBets, bankrollCents: Number(t.starting_bankroll_cents) } : undefined}
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

      {!isLocked && <ExitTournament tournamentId={t.id} isHost={isHost} title={t.title} />}
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
  houseRules,
}: {
  supabase: Supabase;
  tournamentId: string;
  participantId: string;
  rules: Rules;
  events: SportsbookEvent[];
  bankroll: { remainingCents: number; potentialPayoutCents: number };
  houseRules?: { allIn: boolean; minBets: number; bankrollCents: number };
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
      houseRules={houseRules}
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
  const [{ data: wagerRows }, { data: participants }, { data: board }, { data: propRows }, { data: liveRows }] =
    await Promise.all([
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
    supabase
      .from("game_live")
      .select("event_id, state, home_score, away_score, detail, situation, last_play")
      .in("event_id", events.map((e) => e.id)),
  ]);
  const live = Object.fromEntries((liveRows ?? []).map((r) => [r.event_id, r]));

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
      {settled && (
        <FinalCelebration
          tournamentId={tournamentId}
          finishers={leaders.map((l) => ({ name: l.name, isYou: l.isYou, cashCents: l.cashCents, rank: l.rank }))}
        />
      )}
      <LiveGames events={events} live={live} />
      <Leaderboard
        rows={leaders}
        settled={settled}
        startCents={startingBankrollCents}
        bets={Object.fromEntries(
          players.map((p) => [
            p.participantId,
            <PlayerBets
              key={p.participantId}
              player={p}
              wagers={wagers.filter((w) => w.participantId === p.participantId)}
              events={events}
            />,
          ]),
        )}
      />
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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
