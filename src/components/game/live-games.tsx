import { Radio } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { gameView, type GameView, type LiveFeed, type ScoredEvent } from "@/lib/sweat";
import { cn } from "@/lib/utils";

export type LiveGameEvent = ScoredEvent & { id: string };

/**
 * The game, front and center once it starts: score, clock, down & distance, and the last play. Updated about once a
 * minute from the free live feed (game_live); the page re-renders on every change.
 */
export function LiveGames({ events, live }: { events: LiveGameEvent[]; live: Record<string, LiveFeed> }) {
  const games = events
    .map((e) => ({ id: e.id, kickoff: e.commence_time, view: gameView(e, live[e.id] ?? null) }))
    .filter((g) => g.view.state !== "pre" || live[g.id]);
  if (games.length === 0) return null;
  return (
    <section aria-label="Games" className="mt-6 space-y-2">
      {games.map((g) => (
        <GameCard key={g.id} view={g.view} kickoff={g.kickoff} />
      ))}
    </section>
  );
}

function GameCard({ view, kickoff }: { view: GameView; kickoff: string }) {
  return (
    <article
      aria-label={`${view.away.name} at ${view.home.name}`}
      className="overflow-hidden rounded-3xl bg-card ring-1 ring-border"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <StatePill state={view.state} />
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {view.state === "pre" ? <LocalTime iso={kickoff} /> : view.detail}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-2 pb-3">
        <Team side={view.away} align="left" />
        <span className="text-sm text-muted-foreground">@</span>
        <Team side={view.home} align="right" />
      </div>
      {(view.situation || view.lastPlay) && (
        <div className="border-t border-border bg-muted/40 px-4 py-2.5 text-sm">
          {view.situation && <p className="text-xs font-semibold text-muted-foreground">{view.situation}</p>}
          {view.lastPlay && (
            <p className="mt-0.5 flex gap-2 leading-snug">
              <Radio className="mt-0.5 size-3.5 shrink-0 text-hype" aria-hidden />
              <span>
                <span className="sr-only">Last play: </span>
                {view.lastPlay}
              </span>
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Team({ side, align }: { side: GameView["home"]; align: "left" | "right" }) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className={cn("truncate text-sm", side.leading ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {side.name}
      </p>
      <p className={cn("num text-4xl leading-none font-extrabold", side.leading ? "text-foreground" : "text-foreground/70")}>
        {side.score ?? "–"}
      </p>
    </div>
  );
}

export function StatePill({ state }: { state: GameView["state"] }) {
  if (state === "in")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-hype/15 px-2 py-0.5 text-[11px] font-semibold text-hype uppercase">
        <span className="size-1.5 rounded-full bg-hype motion-safe:animate-pulse" /> Live
      </span>
    );
  if (state === "post")
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground uppercase">Final</span>;
  return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground uppercase">Upcoming</span>;
}
