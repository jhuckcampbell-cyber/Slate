"use client";

import { Crown, LockOpen, Ticket } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SportsbookEvent } from "@/components/sportsbook/event-card";
import { TabSwitch } from "@/components/tab-switch";
import {
  buildConsensus,
  slipsByPlayer,
  type Backer,
  type ConsensusMarket,
  type ConsensusSide,
  type GameConsensus,
} from "@/lib/core/consensus";
import { MARKET_LABELS, formatAmerican, formatCents, formatKickoff, selectionLabel, shortTeam } from "@/lib/format";
import type { RevealedWager } from "@/lib/queries/selects";
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

export function Reveal({ tournamentId, events, players, wagers }: Props) {
  const [tab, setTab] = useState<"games" | "players">("games");
  const games = useMemo(() => buildConsensus(wagers, events.map((e) => e.id)), [wagers, events]);
  const slips = useMemo(() => slipsByPlayer(wagers, players.map((p) => p.participantId)), [wagers, players]);
  const byId = useMemo(() => new Map(players.map((p) => [p.participantId, p])), [players]);
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const inPlay = wagers.reduce((sum, w) => sum + w.amountCents, 0);
  const summary = `${players.length} ${players.length === 1 ? "player" : "players"} · ${wagers.length} ${
    wagers.length === 1 ? "bet" : "bets"
  } · ${formatCents(inPlay)} in play`;

  return (
    <section className="mt-6" aria-labelledby="reveal-heading">
      <Celebration tournamentId={tournamentId} summary={summary} />

      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-hype/25 via-card to-card p-4 ring-1 ring-hype/40 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
        <h2 id="reveal-heading" className="flex items-center gap-2 font-display text-3xl font-extrabold uppercase">
          <LockOpen className="size-6 text-hype" /> Picks are in
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      </div>

      <TabSwitch
        label="Reveal view"
        className="mt-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "games", label: "By game" },
          { value: "players", label: "By player" },
        ]}
      />

      <div className="mt-4 space-y-3">
        {tab === "games"
          ? games.map((game, i) => (
              <GameCard key={game.eventId} game={game} event={eventsById.get(game.eventId)} players={byId} index={i} />
            ))
          : slips.map((slip, i) => {
              const player = byId.get(slip.participantId);
              if (!player) return null;
              return (
                <PlayerCard
                  key={slip.participantId}
                  player={player}
                  wagers={slip.wagers}
                  riskedCents={slip.riskedCents}
                  potentialCents={slip.potentialPayoutCents}
                  eventsById={eventsById}
                  index={i}
                />
              );
            })}
      </div>
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
  return (
    <article aria-label={matchup} className={cn("rounded-2xl bg-card p-4 ring-1 ring-border", anim.className)} style={anim.style}>
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl leading-none font-bold uppercase">{matchup}</h3>
        {event && <span className="text-xs text-muted-foreground">{formatKickoff(event.commence_time)}</span>}
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
// By player: every slip, side by side.
// ---------------------------------------------------------------------------
function PlayerCard({
  player,
  wagers,
  riskedCents,
  potentialCents,
  eventsById,
  index,
}: {
  player: RevealPlayer;
  wagers: RevealedWager[];
  riskedCents: number;
  potentialCents: number;
  eventsById: ReadonlyMap<string, SportsbookEvent>;
  index: number;
}) {
  const anim = stagger(index);
  return (
    <article
      aria-label={player.name}
      className={cn(
        "rounded-2xl bg-card p-4 ring-1",
        player.isYou ? "ring-brand/40" : "ring-border",
        anim.className,
      )}
      style={anim.style}
    >
      <header className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15 font-semibold text-brand">
          {player.name.slice(0, 1).toUpperCase()}
        </span>
        <h3 className="min-w-0 flex-1 truncate font-display text-xl font-bold uppercase">
          {player.name}
          {player.isYou && <span className="font-normal text-muted-foreground"> (you)</span>}
          {player.isHost && <Crown className="ml-1.5 inline size-4 text-warn" aria-label="Host" />}
        </h3>
        <div className="text-right text-xs text-muted-foreground tabular-nums">
          <div>
            Risked <span className="num text-base font-bold text-foreground">{formatCents(riskedCents)}</span>
          </div>
          <div>
            Returns <span className="num text-base font-bold text-brand">{formatCents(potentialCents)}</span>
          </div>
        </div>
      </header>

      {wagers.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Ticket className="size-4" /> No picks. Sitting on {formatCents(player.holdingCents)}.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {wagers.map((w) => (
            <li key={w.id} className="rounded-xl bg-muted/40 p-2.5">
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-semibold tracking-wide uppercase">
                  {w.wagerType === "parlay" ? `${w.legs.length}-leg parlay` : "Single"} · {formatAmerican(w.oddsAmerican)}
                </span>
                <span className="tabular-nums">
                  {formatCents(w.amountCents)} → <span className="text-brand">{formatCents(w.potentialPayoutCents)}</span>
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {w.legs.map((leg, i) => {
                  const ev = eventsById.get(leg.eventId);
                  return (
                    <li key={i} className="text-sm">
                      <span className="font-medium">
                        {selectionLabel({
                          marketKey: leg.marketKey,
                          outcomeName: leg.selection,
                          point: leg.line,
                          participantName: leg.participantName,
                        })}
                      </span>
                      {ev && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {shortTeam(ev.away_team)} @ {shortTeam(ev.home_team)}
                        </span>
                      )}
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
      )}
    </article>
  );
}
