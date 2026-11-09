"use client";

import { Info, Ticket } from "lucide-react";
import { useId, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { Odds } from "@/components/odds";
import type { SportsbookEvent } from "@/components/sportsbook/event-card";
import { TeamMark } from "@/components/team-mark";
import { formatCents, selectionLabel, shortTeam } from "@/lib/format";
import { chanceExplainer } from "@/lib/plain-english";
import type { RevealedWager } from "@/lib/queries/selects";
import {
  formatChance,
  gameView,
  propProgress,
  totalProgress,
  wagerOutcome,
  type LiveFeed,
  type Tone,
} from "@/lib/sweat";
import { pickTeam, readableTeamColor } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

export type BetsPlayer = { participantId: string; name: string; isYou: boolean; holdingCents: number };

type Leg = RevealedWager["legs"][number];

const TONE_TEXT: Record<Tone, string> = {
  win: "text-win",
  loss: "text-loss",
  muted: "text-muted-foreground",
  live: "text-foreground",
};

/**
 * One player's slip, dropped down from their leaderboard row after lock. Singles sit in a white box per game (one
 * scoreboard per game, at the bottom); each parlay gets its own box. Every open pick shows its live chance as a bar
 * and a %, with an (i) that says what the % means. Totals show points so far against the line.
 */
export function PlayerBets({
  player,
  wagers,
  events,
  live,
}: {
  player: BetsPlayer;
  wagers: RevealedWager[];
  events: SportsbookEvent[];
  live: Record<string, LiveFeed>;
}) {
  if (wagers.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Ticket className="size-4" /> No picks. Sitting on {formatCents(player.holdingCents)}.
      </p>
    );
  }

  const singles = wagers.filter((w) => w.legs.length === 1);
  const parlays = wagers.filter((w) => w.legs.length > 1);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const games = events.filter((e) => singles.some((w) => w.legs[0]!.eventId === e.id));
  const riskedCents = wagers.reduce((sum, w) => sum + w.amountCents, 0);
  const potentialCents = wagers.reduce((sum, w) => sum + (w.status === "pending" ? w.potentialPayoutCents : 0), 0);

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground tabular-nums">
        Risked <span className="num font-bold text-foreground">{formatCents(riskedCents)}</span>
        {potentialCents > 0 && (
          <>
            {" · "}Can still win <span className="num font-bold text-foreground">{formatCents(potentialCents)}</span>
          </>
        )}
      </p>

      {games.map((e) => (
        <GameBox key={e.id} event={e} live={live[e.id] ?? null}>
          {singles
            .filter((w) => w.legs[0]!.eventId === e.id)
            .map((w) => (
              <SinglePick key={w.id} wager={w} event={e} live={live[e.id] ?? null} />
            ))}
        </GameBox>
      ))}

      {parlays.map((w) => (
        <ParlayBox key={w.id} wager={w} eventsById={eventsById} live={live} />
      ))}

      {player.holdingCents > 0 && (
        <p className="px-1 text-xs text-muted-foreground">Holding {formatCents(player.holdingCents)} unbet.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

function GameBox({
  event,
  live,
  children,
}: {
  event: SportsbookEvent;
  live: LiveFeed | null;
  children: React.ReactNode;
}) {
  return (
    <article
      aria-label={`${shortTeam(event.away_team)} at ${shortTeam(event.home_team)}`}
      className="rounded-xl border-2 border-foreground bg-card p-3"
    >
      <Matchup event={event} />
      <div className="mt-1.5 divide-y-[1.5px] divide-dashed divide-border">{children}</div>
      <Scoreboard event={event} live={live} className="mt-2.5" />
    </article>
  );
}

function ParlayBox({
  wager,
  eventsById,
  live,
}: {
  wager: RevealedWager;
  eventsById: ReadonlyMap<string, SportsbookEvent>;
  live: Record<string, LiveFeed>;
}) {
  const pending = wager.status === "pending";
  const out = wagerOutcome(wager);
  return (
    <article aria-label={`${wager.legs.length}-leg parlay`} className="rounded-xl border-2 border-foreground bg-card p-3">
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {wager.legs.length}-leg parlay · <Odds american={wager.oddsAmerican} />
        </span>
        <Stake wager={wager} />
      </header>
      {pending ? (
        <Chance p={wager.winProbability} parlay className="mt-2" />
      ) : (
        <p className={cn("mt-1.5 text-right text-sm font-bold", TONE_TEXT[out.tone])}>{out.label}</p>
      )}
      <ul className="mt-2 divide-y-[1.5px] divide-dashed divide-border">
        {wager.legs.map((leg, i) => {
          const event = eventsById.get(leg.eventId);
          const view = event ? gameView(event, live[leg.eventId] ?? null) : null;
          return (
            <li key={i} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <PickLabel leg={leg} sportKey={event?.sport_key} />
                <LegResult leg={leg} />
              </div>
              {leg.status === "pending" && <LegProgress leg={leg} event={event} live={live[leg.eventId] ?? null} />}
              {event && view && view.state !== "pre" && (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  <TeamName team={event.away_team} sportKey={event.sport_key} /> {view.away.score ?? "–"} ·{" "}
                  <TeamName team={event.home_team} sportKey={event.sport_key} /> {view.home.score ?? "–"}
                  {view.detail && ` · ${view.detail}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

function SinglePick({ wager, event, live }: { wager: RevealedWager; event: SportsbookEvent; live: LiveFeed | null }) {
  const leg = wager.legs[0]!;
  const pending = wager.status === "pending";
  const out = wagerOutcome(wager);
  const total = totalFor(leg, event, live);
  return (
    <div className="py-2 first:pt-0.5 last:pb-0.5">
      <div className="flex items-center justify-between gap-2">
        <PickLabel leg={leg} sportKey={event.sport_key} />
        <Stake wager={wager} />
      </div>
      {pending ? (
        total ? (
          <TotalBar total={total} p={wager.winProbability} />
        ) : (
          <>
            <Chance p={wager.winProbability} className="mt-1.5" />
            <PropLine leg={leg} />
          </>
        )
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2 text-sm">
          <span className="text-xs text-muted-foreground">{total?.text ?? <PropText leg={leg} />}</span>
          <span className={cn("font-bold", TONE_TEXT[out.tone])}>{out.label}</span>
        </div>
      )}
    </div>
  );
}

/** A parlay leg still open: its own chance, plus points/stat progress where there is one. */
function LegProgress({ leg, event, live }: { leg: Leg; event: SportsbookEvent | undefined; live: LiveFeed | null }) {
  const total = event ? totalFor(leg, event, live) : null;
  if (total) return <TotalBar total={total} p={leg.winProbability} />;
  return (
    <>
      <Chance p={leg.winProbability} className="mt-1.5" />
      <PropLine leg={leg} />
    </>
  );
}

function totalFor(leg: Leg, event: SportsbookEvent, live: LiveFeed | null) {
  if (leg.marketKey !== "totals") return null;
  const view = gameView(event, live);
  return totalProgress({
    selection: leg.selection,
    line: leg.line,
    home: view.home.score,
    away: view.away.score,
    final: view.state === "post",
  });
}

/** "Knicks +6.5" with the team name in the team's color, next to its helmet/jersey. */
function PickLabel({ leg, sportKey }: { leg: Leg; sportKey?: string }) {
  const label = selectionLabel({
    marketKey: leg.marketKey,
    outcomeName: leg.selection,
    point: leg.line,
    participantName: leg.participantName,
    participantTeam: leg.participantTeam,
  });
  const team = pickTeam({ marketKey: leg.marketKey, outcomeName: leg.selection, participantTeam: leg.participantTeam });
  const name = team ? shortTeam(team) : null;
  const colored = name && label.startsWith(name);
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-semibold">
      {team && <TeamMark team={team} sportKey={sportKey} className="size-5" />}
      <span className="truncate">
        {colored ? (
          <>
            <span style={{ color: readableTeamColor(team!, sportKey) }}>{name}</span>
            {label.slice(name.length)}
          </>
        ) : (
          label
        )}
      </span>
    </span>
  );
}

function Stake({ wager }: { wager: RevealedWager }) {
  return (
    <span className="num shrink-0 text-sm font-bold tabular-nums">
      {formatCents(wager.amountCents)} → {formatCents(wager.potentialPayoutCents)}
    </span>
  );
}

function LegResult({ leg }: { leg: Leg }) {
  switch (leg.status) {
    case "hit":
      return <span className="text-xs font-bold text-win">Hit</span>;
    case "miss":
      return <span className="text-xs font-bold text-loss">Missed</span>;
    case "push":
    case "void":
      return <span className="text-xs font-semibold text-muted-foreground">Push</span>;
    default:
      return null;
  }
}

function PropText({ leg }: { leg: Leg }) {
  const p = propProgress({ marketKey: leg.marketKey, selection: leg.selection, line: leg.line, status: leg.status, liveStat: leg.liveStat });
  return p ? <>{p.text}</> : null;
}

/** Props: the player's number so far ("18 Pts · needs 8 more"). */
function PropLine({ leg }: { leg: Leg }) {
  const p = propProgress({ marketKey: leg.marketKey, selection: leg.selection, line: leg.line, status: leg.status, liveStat: leg.liveStat });
  if (!p) return null;
  return (
    <p aria-label={`Live stat: ${p.text}`} className={cn("mt-1 text-xs font-medium tabular-nums", TONE_TEXT[p.tone])}>
      {p.text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Bars and the (i)
// ---------------------------------------------------------------------------

/** The live chance: a black bar, the %, and an (i) that opens what the % means. */
function Chance({ p, parlay = false, className }: { p: number | null; parlay?: boolean; className?: string }) {
  const pct = formatChance(p);
  return (
    <ChanceInfo pct={pct} parlay={parlay} className={className}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-700"
          style={{ width: `${Math.round((p ?? 0) * 100)}%` }}
        />
      </div>
    </ChanceInfo>
  );
}

/** Totals: the bar fills with points toward the line (the tick at its end); the chance sits by the (i). */
function TotalBar({ total, p }: { total: NonNullable<ReturnType<typeof totalFor>>; p: number | null }) {
  return (
    <div className="mt-1.5">
      <ChanceInfo pct={formatChance(p)} parlay={false}>
        <div className="relative h-1.5 flex-1 rounded-full bg-foreground/10" aria-hidden>
          <div
            className={cn("h-full rounded-full transition-[width] duration-700", total.tone === "loss" ? "bg-loss" : "bg-foreground")}
            style={{ width: `${Math.round(total.fill * 100)}%` }}
          />
          <span className="absolute -top-1 right-0 h-3.5 w-0.5 rounded-full bg-foreground" />
        </div>
      </ChanceInfo>
      <p className={cn("mt-1 text-xs font-medium tabular-nums", TONE_TEXT[total.tone === "live" ? "muted" : total.tone])}>
        {total.text}
      </p>
    </div>
  );
}

function ChanceInfo({
  pct,
  parlay,
  className,
  children,
}: {
  pct: string;
  parlay: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const copy = chanceExplainer(pct, parlay);
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {children}
        <span className="num w-9 text-right text-sm font-bold" aria-label={`Chance to win ${pct}`}>
          {pct}
        </span>
        <button
          type="button"
          aria-label="What does this % mean?"
          aria-expanded={open}
          aria-controls={id}
          onClick={(e) => {
            e.preventDefault(); // inside the leaderboard row's <details>: don't toggle it
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="relative -m-1 flex size-7 shrink-0 items-center justify-center rounded-full text-foreground transition-transform after:absolute after:-inset-2 motion-safe:active:scale-90"
        >
          <Info className="size-4" strokeWidth={2.5} />
        </button>
      </div>
      {open && (
        <div
          id={id}
          role="note"
          className="relative mt-2 rounded-xl border-2 border-foreground bg-card px-3 py-2 text-xs motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
        >
          <span
            aria-hidden
            className="absolute -top-[7px] right-3 size-3 rotate-45 border-t-2 border-l-2 border-foreground bg-card"
          />
          <p className="font-bold">{copy.title}</p>
          <p className="mt-0.5 leading-snug text-muted-foreground">{copy.body}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matchup header and mini scoreboard
// ---------------------------------------------------------------------------

function TeamName({ team, sportKey }: { team: string; sportKey?: string }) {
  return (
    <span className="font-bold" style={{ color: readableTeamColor(team, sportKey) }}>
      {shortTeam(team)}
    </span>
  );
}

function Matchup({ event }: { event: SportsbookEvent }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      <TeamName team={event.away_team} sportKey={event.sport_key} /> @{" "}
      <TeamName team={event.home_team} sportKey={event.sport_key} />
    </p>
  );
}

export function Scoreboard({
  event,
  live,
  className,
}: {
  event: SportsbookEvent;
  live: LiveFeed | null;
  className?: string;
}) {
  const view = gameView(event, live);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border-2 border-foreground px-2.5 py-1.5 text-sm",
        className,
      )}
    >
      {view.state === "pre" ? (
        <span className="text-xs text-muted-foreground">
          Starts <LocalTime iso={event.commence_time} />
        </span>
      ) : (
        <span className="flex items-baseline gap-1.5 tabular-nums">
          <TeamName team={event.away_team} sportKey={event.sport_key} />
          <span className={cn("num text-base font-extrabold", !view.away.leading && "text-foreground/60")}>
            {view.away.score ?? "–"}
          </span>
          <span className="text-muted-foreground">·</span>
          <TeamName team={event.home_team} sportKey={event.sport_key} />
          <span className={cn("num text-base font-extrabold", !view.home.leading && "text-foreground/60")}>
            {view.home.score ?? "–"}
          </span>
        </span>
      )}
      <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
        {view.state === "in" ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
            <span className="live-dot" aria-hidden /> {view.detail ?? "Live"}
          </span>
        ) : view.state === "post" ? (
          "Final"
        ) : null}
      </span>
    </div>
  );
}
