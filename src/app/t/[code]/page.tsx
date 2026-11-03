import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Crown, EyeOff, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LockCountdown } from "@/components/tournament/lock-countdown";
import { ShareButton } from "@/components/tournament/share-button";
import { normalizeCode } from "@/lib/core/codes";
import { publicEnv } from "@/lib/env";
import { formatCents, formatKickoff, matchupLabel, sportEmoji } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/queries";

export const metadata: Metadata = { title: "Lobby" };

const MARKET_LABELS: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Over/Under",
};

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
  // RLS: only visible to the host and participants.
  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "id, code, title, description, sport_key, host_id, lock_time, status, starting_bankroll_cents, max_bet_cents, allowed_bet_types",
    )
    .eq("code", code)
    .maybeSingle();
  if (!t) redirect(`/join/${code}`);

  const [{ data: eventLinks }, { data: roster }] = await Promise.all([
    supabase
      .from("tournament_events")
      .select("events(id, home_team, away_team, commence_time, status)")
      .eq("tournament_id", t.id),
    supabase.rpc("get_roster", { p_tournament_id: t.id }),
  ]);

  const events = (eventLinks ?? [])
    .flatMap((l) => (l.events ? [l.events] : []))
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time));
  const rules = t.allowed_bet_types as AllowedBetTypes;
  const isHost = t.host_id === viewer.userId;
  const bankroll = formatCents(t.starting_bankroll_cents);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-10">
      <header>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="font-mono tracking-widest">
            {t.code}
          </Badge>
          <Link
            href="/account"
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
            aria-label="Account"
          >
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

      {(created || isHost) && (
        <section className="mt-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          {created && (
            <p className="mb-3 text-sm">
              <strong>You&apos;re the host.</strong> Drop the link in the group chat. Friends join in
              one tap.
            </p>
          )}
          <ShareButton
            code={t.code}
            url={`${publicEnv.siteUrl}/join/${t.code}`}
            title={t.title}
            bankrollLabel={bankroll}
          />
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Games
        </h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="font-medium">{matchupLabel(e)}</span>
              <span className="shrink-0 text-muted-foreground">{formatKickoff(e.commence_time)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Rules
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Rule label="Bankroll" value={bankroll} />
          <Rule label="Max bet" value={t.max_bet_cents ? formatCents(t.max_bet_cents) : "No limit"} />
          <Rule
            label="Bets"
            value={(rules.markets ?? []).map((m) => MARKET_LABELS[m] ?? m).join(", ")}
          />
          <Rule
            label="Parlays"
            value={rules.parlays ? `Up to ${rules.max_parlay_legs ?? 6} legs` : "Off"}
          />
        </dl>
        <p className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          <EyeOff className="mt-0.5 size-4 shrink-0" />
          Picks stay hidden from everyone until {formatKickoff(t.lock_time)}, then they&apos;re all
          revealed at once.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Squad · {roster?.length ?? 0}
        </h2>
        <ul className="space-y-2">
          {(roster ?? []).map((p) => (
            <li
              key={p.user_id}
              className="flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-border"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 font-semibold text-emerald-300">
                {p.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 font-medium">
                {p.display_name}
                {p.user_id === viewer.userId && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </span>
              {p.is_host && <Crown className="size-4 text-amber-400" aria-label="Host" />}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Betting slip opens here in the next update. 🏗️
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
