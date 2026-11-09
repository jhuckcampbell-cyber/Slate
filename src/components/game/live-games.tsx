import { Radio } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { gameView, type GameView, type LiveFeed, type ScoredEvent } from "@/lib/sweat";
import { TeamMark } from "@/components/team-mark";
import { readableTeamColor, teamLook } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

export type LiveGameEvent = ScoredEvent & { id: string; sport_key?: string };

/**
 * The Games tab: every game in the tournament as a scoreboard (score, clock, down & distance, last play). Live and
 * finished games first, then upcoming ones by kickoff. Updated about once a minute from the free live feed
 * (game_live); the page re-renders on every change.
 */
export function LiveGames({ events, live }: { events: LiveGameEvent[]; live: Record<string, LiveFeed> }) {
  const order = { in: 0, post: 1, pre: 2 } as const;
  const games = events
    .map((e) => ({ id: e.id, kickoff: e.commence_time, view: gameView(e, live[e.id] ?? null), event: e }))
    .sort((a, b) => order[a.view.state] - order[b.view.state] || a.kickoff.localeCompare(b.kickoff));
  if (games.length === 0) return null;
  return (
    <section aria-label="Games" className="space-y-2.5">
      {games.map((g) => (
        <GameCard key={g.id} view={g.view} kickoff={g.kickoff} event={g.event} />
      ))}
    </section>
  );
}

function GameCard({ view, kickoff, event }: { view: GameView; kickoff: string; event: LiveGameEvent }) {
  const away = teamLook(event.away_team, event.sport_key).primary;
  const home = teamLook(event.home_team, event.sport_key).primary;
  return (
    <article
      aria-label={`${view.away.name} at ${view.home.name}`}
      className="overflow-hidden rounded-2xl border-2 border-foreground bg-card"
    >
      {/* Team colors across the top: away on the left, home on the right. */}
      <div aria-hidden className="flex h-1.5">
        <span className="flex-1" style={{ background: away }} />
        <span className="flex-1" style={{ background: home }} />
      </div>
      <div className="flex items-center justify-between px-4 pt-3">
        <StatePill state={view.state} />
        <span className="text-sm font-semibold text-muted-foreground tabular-nums">
          {view.state === "pre" ? <LocalTime iso={kickoff} /> : view.detail}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-2.5 pb-3.5">
        <Team side={view.away} team={event.away_team} sportKey={event.sport_key} align="left" />
        <span className="font-display text-base font-extrabold text-muted-foreground">
          {view.state === "pre" ? "VS" : "@"}
        </span>
        <Team side={view.home} team={event.home_team} sportKey={event.sport_key} align="right" />
      </div>
      {(view.situation || view.lastPlay) && (
        <div className="border-t-2 border-dashed border-border bg-surface-2 px-4 py-3 text-base">
          {view.situation && <p className="text-sm font-semibold text-muted-foreground">{view.situation}</p>}
          {view.lastPlay && (
            <p className="mt-0.5 flex gap-2 leading-snug">
              <Radio className="mt-1 size-4 shrink-0" aria-hidden />
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

/** One side: the team's jersey/helmet in a small tile next to its name (in team colors) and the score. */
function Team({
  side,
  team,
  sportKey,
  align,
}: {
  side: GameView["home"];
  team: string;
  sportKey?: string;
  align: "left" | "right";
}) {
  const right = align === "right";
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", right && "flex-row-reverse text-right")}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border-2 border-foreground bg-surface-2">
        <TeamMark team={team} sportKey={sportKey} className={cn("size-8", right && "-scale-x-100")} />
      </span>
      <div className="min-w-0">
        <p
          className="truncate font-display text-lg/none font-extrabold tracking-tight uppercase"
          style={{ color: readableTeamColor(team, sportKey) }}
        >
          {side.name}
        </p>
        {side.score !== null && (
          <p
            className={cn(
              "num mt-0.5 text-[2rem] leading-none font-extrabold",
              side.leading ? "text-foreground" : "text-foreground/55",
            )}
          >
            {side.score}
          </p>
        )}
      </div>
    </div>
  );
}

export function StatePill({ state }: { state: GameView["state"] }) {
  if (state === "in")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-2.5 py-0.5 text-xs font-bold uppercase">
        <span className="live-dot" aria-hidden /> Live
      </span>
    );
  if (state === "post")
    return <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-bold text-background uppercase">Final</span>;
  return <span className="rounded-full border-2 border-foreground/25 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground uppercase">Upcoming</span>;
}
