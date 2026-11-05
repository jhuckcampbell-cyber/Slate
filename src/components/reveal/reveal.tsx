"use client";

import { Odds } from "@/components/odds";
import { Check, ChevronDown, LockOpen, Ticket, X } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SportsbookEvent } from "@/components/sportsbook/event-card";
import {
  buildConsensus,
  type Backer,
  type ConsensusMarket,
  type ConsensusSide,
  type GameConsensus,
} from "@/lib/core/consensus";
import { MARKET_LABELS, formatCents, selectionLabel, shortTeam } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import type { LegOutcome, RevealedWager } from "@/lib/queries/selects";
import { formatChance, propProgress, scoreLine, sweatTag, wagerOutcome, type Tone } from "@/lib/sweat";
import { cn } from "@/lib/utils";

export type RevealPlayer = {
  participantId: string;
  name: string;
  isHost: boolean;
  isYou: boolean;
  /** Unwagered bankroll (counts toward the final score). */
  holdingCents: number;
};

type Props = {
  tournamentId: string;
  events: SportsbookEvent[];
  players: RevealPlayer[];
  wagers: RevealedWager[];
};

/**
 * After lock: the "Picks are in" moment, and what everyone's on, game by game, as a dropdown (closed by
 * default; each player's own bets drop down from their leaderboard row instead).
 */
export function Reveal({ tournamentId, events, players, wagers }: Props) {
  const games = useMemo(() => buildConsensus(wagers, events.map((e) => e.id)), [wagers, events]);
  const byId = useMemo(() => new Map(players.map((p) => [p.participantId, p])), [players]);
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const inPlay = wagers.reduce((sum, w) => sum + w.amountCents, 0);
  const summary = `${players.length} ${players.length === 1 ? "player" : "players"} · ${wagers.length} ${
    wagers.length === 1 ? "bet" : "bets"
  } · ${formatCents(inPlay)} in play`;

  return (
    <section className="mt-6" aria-label="What everyone's on">
      <Celebration tournamentId={tournamentId} summary={summary} />

      <details className="group rounded-2xl bg-gradient-to-br from-hype/25 via-card to-card ring-1 ring-hype/40">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-display text-3xl font-extrabold uppercase">
              <LockOpen className="size-6 text-hype" /> Picks are in
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
            <p className="mt-0.5 text-xs font-medium text-hype group-open:hidden">Tap to see what everyone&apos;s on</p>
          </div>
          <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 px-3 pb-3">
          {games.map((game, i) => (
            <GameCard key={game.eventId} game={game} event={eventsById.get(game.eventId)} players={byId} index={i} />
          ))}
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// First look after lock: a short full-screen moment, once per tournament per device.
// ---------------------------------------------------------------------------
const noopSubscribe = () => () => {};

function seenKey(tournamentId: string) {
  return `squadbets:revealed:${tournamentId}`;
}
function hasSeen(tournamentId: string) {
  try {
    return localStorage.getItem(seenKey(tournamentId)) === "1";
  } catch {
    return true; // storage blocked: skip the flourish rather than replay it forever
  }
}

function Celebration({ tournamentId, summary }: { tournamentId: string; summary: string }) {
  const seen = useSyncExternalStore(
    noopSubscribe,
    () => hasSeen(tournamentId),
    () => true,
  );
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (seen) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(seenKey(tournamentId), "1");
      } catch {
        // storage blocked: the flourish just plays again next time
      }
      setDone(true);
    }, 2400);
    return () => clearTimeout(t);
  }, [seen, tournamentId]);

  if (seen || done) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/85 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in"
    >
      <div className="text-center">
        <LockOpen className="mx-auto size-16 text-hype motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:spin-in-12 motion-safe:duration-500" />
        <p className="mt-4 font-display text-5xl font-extrabold uppercase motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:delay-200 motion-safe:duration-500">
          Picks are in!
        </p>
        <p className="mt-2 text-sm text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both motion-safe:delay-500">
          {summary}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// By game: who's on which side of every line.
// ---------------------------------------------------------------------------
function sideLabel(marketKey: string, side: ConsensusSide) {
  return selectionLabel({
    marketKey,
    outcomeName: side.selection,
    point: side.line,
    participantName: side.participantName,
    participantTeam: side.participantTeam,
  });
}

function headline(market: ConsensusMarket) {
  const { leader, sides, playerCount } = market;
  if (!leader) return `Split ${sides[0]!.playerCount}–${sides[1]!.playerCount}`;
  const label = sideLabel(market.marketKey, leader);
  if (playerCount > 1 && leader.playerCount === playerCount) return `Everyone's on ${label}`;
  return `${leader.playerCount} of ${playerCount} on ${label}`;
}

const SIDE_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

function stagger(index: number) {
  return {
    className:
      "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-500",
    style: { animationDelay: `${Math.min(index, 8) * 70}ms` },
  };
}

function GameCard({
  game,
  event,
  players,
  index,
}: {
  game: GameConsensus;
  event: SportsbookEvent | undefined;
  players: ReadonlyMap<string, RevealPlayer>;
  index: number;
}) {
  const anim = stagger(index);
  const matchup = event ? `${shortTeam(event.away_team)} @ ${shortTeam(event.home_team)}` : game.eventId;
  const score = event ? scoreLine(event) : null;
  return (
    <article aria-label={matchup} className={cn("rounded-2xl bg-card p-4 ring-1 ring-border", anim.className)} style={anim.style}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl leading-none font-bold uppercase">{matchup}</h3>
        {event && !score && <span className="text-xs text-muted-foreground"><LocalTime iso={event.commence_time} /></span>}
        {score && <StatePill state={score.state} />}
      </header>

      {game.markets.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nobody touched this one.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {game.markets.map((market) => (
            <div key={market.marketKey}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {MARKET_LABELS[market.marketKey] ?? market.marketKey}
                </span>
                <span className="font-display text-lg leading-none font-bold">{headline(market)}</span>
              </div>
              <div className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                {market.sides.map((side, i) => (
                  <div
                    key={side.selection + side.participantName}
                    className={SIDE_COLORS[i % SIDE_COLORS.length]}
                    style={{ width: `${(side.playerCount / market.playerCount) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="mt-2 space-y-1.5">
                {market.sides.map((side, i) => (
                  <li key={side.selection + side.participantName} className="flex items-start gap-2 text-sm">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SIDE_COLORS[i % SIDE_COLORS.length])} />
                    <span className="w-24 shrink-0 font-medium">{sideLabel(market.marketKey, side)}</span>
                    <span className="flex flex-1 flex-wrap gap-1">
                      {side.backers.map((b) => (
                        <BackerChip key={b.participantId} backer={b} player={players.get(b.participantId)} sideLine={side.line} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function BackerChip({ backer, player, sideLine }: { backer: Backer; player: RevealPlayer | undefined; sideLine: number | null }) {
  const bits = [
    backer.singleStakeCents > 0 ? formatCents(backer.singleStakeCents) : null,
    backer.parlays > 0 ? (backer.parlays === 1 ? "parlay" : `${backer.parlays} parlays`) : null,
    backer.line !== sideLine && backer.line !== null ? `@ ${backer.line > 0 ? "+" : ""}${backer.line}` : null,
  ].filter(Boolean);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1",
        player?.isYou ? "bg-brand/15 ring-brand/40" : "bg-muted ring-border",
      )}
    >
      <span className="font-medium">{player ? (player.isYou ? "You" : player.name) : "?"}</span>
      {bits.length > 0 && <span className="text-muted-foreground">{bits.join(" · ")}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One player's slip: drops down from their leaderboard row after lock.
// ---------------------------------------------------------------------------
export function PlayerBets({
  player,
  wagers,
  events,
}: {
  player: RevealPlayer;
  wagers: RevealedWager[];
  events: SportsbookEvent[];
}) {
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const riskedCents = wagers.reduce((sum, w) => sum + w.amountCents, 0);
  const potentialCents = wagers.reduce((sum, w) => sum + (w.status === "pending" ? w.potentialPayoutCents : 0), 0);
  if (wagers.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Ticket className="size-4" /> No picks. Sitting on {formatCents(player.holdingCents)}.
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Risked <span className="num font-bold text-foreground">{formatCents(riskedCents)}</span>
        {potentialCents > 0 && (
          <>
            {" · "}Can still win <span className="num font-bold text-brand">{formatCents(potentialCents)}</span>
          </>
        )}
      </p>
      <ul className="mt-2 space-y-2">
        {wagers.map((w) => (
          <li key={w.id} className="rounded-xl bg-muted/40 p-2.5">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-semibold tracking-wide uppercase">
                {w.wagerType === "parlay" ? `${w.legs.length}-leg parlay` : "Single"} · <Odds american={w.oddsAmerican} />
              </span>
              <span className="tabular-nums">
                {formatCents(w.amountCents)} → <span className="text-brand">{formatCents(w.potentialPayoutCents)}</span>
              </span>
            </div>
            <Outcome wager={w} />
            <ul className="mt-1 space-y-0.5">
              {w.legs.map((leg, i) => {
                const ev = eventsById.get(leg.eventId);
                return (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
                    <LegMark leg={leg} />
                    <span className="font-medium">
                      {selectionLabel({
                        marketKey: leg.marketKey,
                        outcomeName: leg.selection,
                        point: leg.line,
                        participantName: leg.participantName,
                        participantTeam: leg.participantTeam,
                      })}
                    </span>
                    {ev && events.length > 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {shortTeam(ev.away_team)} @ {shortTeam(ev.home_team)}
                      </span>
                    )}
                    <LiveStat leg={leg} />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {player.holdingCents > 0 && (
          <li className="px-1 text-xs text-muted-foreground">Holding {formatCents(player.holdingCents)} unbet.</li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sweat: live chances and graded results.
// ---------------------------------------------------------------------------
const TONE_TEXT: Record<Tone, string> = {
  win: "text-win",
  loss: "text-loss",
  muted: "text-muted-foreground",
  live: "text-foreground",
};

const TONE_BAR: Record<Tone, string> = { win: "bg-win", loss: "bg-loss", muted: "bg-muted-foreground", live: "bg-brand" };
const TONE_PILL: Record<Tone, string> = {
  win: "bg-win/15 text-win",
  loss: "bg-loss/15 text-loss",
  muted: "bg-muted text-muted-foreground",
  live: "bg-warn/15 text-warn",
};

function Outcome({ wager }: { wager: RevealedWager }) {
  const out = wagerOutcome(wager);
  const pending = wager.status === "pending";
  const tag = pending ? sweatTag(wager.winProbability) : null;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      {pending && (
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn("h-full rounded-full transition-[width,background-color] duration-700", tag ? TONE_BAR[tag.tone] : "bg-brand")}
            style={{ width: `${Math.round((wager.winProbability ?? 0) * 100)}%` }}
          />
        </div>
      )}
      {tag && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase", TONE_PILL[tag.tone])}>
          {tag.label}
        </span>
      )}
      <span className={cn("text-xs font-semibold", TONE_TEXT[out.tone], !pending && "ml-auto")}>{out.label}</span>
    </div>
  );
}

/** The player's number so far, next to a prop pick: "18 Pts · needs 8 more". */
function LiveStat({ leg }: { leg: RevealedWager["legs"][number] }) {
  const p = propProgress({ marketKey: leg.marketKey, selection: leg.selection, line: leg.line, status: leg.status, liveStat: leg.liveStat });
  if (!p) return null;
  return (
    <span
      aria-label={`Live stat: ${p.text}`}
      className={cn("ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums", TONE_TEXT[p.tone])}
    >
      {p.text}
    </span>
  );
}

function LegMark({ leg }: { leg: LegOutcome }) {
  switch (leg.status) {
    case "hit":
      return <Check className="size-3.5 shrink-0 self-center text-win" aria-label="Hit" />;
    case "miss":
      return <X className="size-3.5 shrink-0 self-center text-loss" aria-label="Missed" />;
    case "push":
    case "void":
      return <span className="text-[10px] font-semibold text-muted-foreground uppercase">Push</span>;
    default:
      return (
        <span
          className={cn("num w-8 shrink-0 text-xs", TONE_TEXT[sweatTag(leg.winProbability)?.tone ?? "muted"])}
          aria-label="Chance to hit"
        >
          {formatChance(leg.winProbability)}
        </span>
      );
  }
}

function StatePill({ state }: { state: "Final" | "Live" }) {
  return state === "Live" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-hype/15 px-2 py-0.5 text-[11px] font-semibold text-hype uppercase">
      <span className="size-1.5 rounded-full bg-hype motion-safe:animate-pulse" /> Live
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground uppercase">Final</span>
  );
}
