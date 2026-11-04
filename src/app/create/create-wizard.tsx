"use client";

import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ensureSession } from "@/lib/auth/ensure-session";
import { codePrefix } from "@/lib/core/codes";
import { propMarkets } from "@/lib/core/props";
import { friendlyError } from "@/lib/errors";
import {
  dollarsToCents,
  formatDay,
  formatKickoff,
  matchupLabel,
  sportEmoji,
  sportLabel,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type EventRow = {
  id: string;
  sport_key: string;
  sport_title: string | null;
  home_team: string;
  away_team: string;
  commence_time: string;
};

const MARKETS = [
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Over/Under" },
] as const;

export function CreateWizard({ events, defaultName }: { events: EventRow[]; defaultName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const sports = useMemo(() => [...new Set(events.map((e) => e.sport_key))], [events]);
  const [sport, setSport] = useState(sports[0] ?? "");
  const [selected, setSelected] = useState<string[]>([]);

  const [title, setTitle] = useState("");
  const [name, setName] = useState(defaultName);
  const [bankroll, setBankroll] = useState("100");
  const [maxBet, setMaxBet] = useState("");
  const [markets, setMarkets] = useState<string[]>(MARKETS.map((m) => m.key));
  const [parlays, setParlays] = useState(true);
  const [sameGame, setSameGame] = useState(true);
  const [playerProps, setPlayerProps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const propsAvailable = propMarkets(sport).length > 0;

  const sportEvents = events.filter((e) => e.sport_key === sport);
  const byDay = groupByDay(sportEvents);
  const chosen = events.filter((e) => selected.includes(e.id));
  const firstKickoff = chosen.map((e) => e.commence_time).sort()[0];

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function goToRules() {
    if (!title) setTitle(suggestTitle(chosen, sport));
    setStep(2);
  }

  async function submit() {
    const bankrollCents = dollarsToCents(bankroll);
    const maxBetCents = maxBet ? dollarsToCents(maxBet) : null;
    if (!bankrollCents) return toast.error("Enter a starting bankroll.");
    if (maxBet && !maxBetCents) return toast.error("Max bet must be a positive amount.");
    if (maxBetCents && maxBetCents > bankrollCents)
      return toast.error("Max bet can't exceed the bankroll.");
    if (markets.length === 0) return toast.error("Allow at least one bet type.");
    if (!name.trim()) return toast.error("What should your friends call you?");

    setSubmitting(true);
    try {
      await ensureSession(name);
      const finalTitle = title.trim() || suggestTitle(chosen, sport);
      const supabase = createClient();
      const { data, error } = await supabase
        .rpc("create_tournament", {
          p_title: finalTitle,
          p_event_ids: selected,
          p_code_prefix: codePrefix(finalTitle),
          p_starting_bankroll_cents: bankrollCents,
          p_max_bet_cents: maxBetCents ?? undefined,
          p_allowed_bet_types: {
            markets,
            parlays,
            max_parlay_legs: 6,
            player_props: propsAvailable && playerProps,
            same_game_parlays: parlays && sameGame,
          },
        })
        .single();
      if (error) throw error;
      router.push(`/t/${data.code}?created=1`);
    } catch (err) {
      toast.error(friendlyError(err));
      setSubmitting(false);
    }
  }

  if (events.length === 0) {
    return (
      <div className="pt-20 text-center text-muted-foreground">
        No upcoming games right now. Check back closer to game day.
      </div>
    );
  }

  return (
    <>
      <header className="mb-6 flex items-center gap-3">
        {step === 2 && (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => setStep(1)}>
            <ArrowLeft />
          </Button>
        )}
        <div>
          <p className="text-xs text-muted-foreground">Step {step} of 2</p>
          <h1 className="font-display text-4xl leading-none font-extrabold uppercase">{step === 1 ? "Pick the game(s)" : "Set the rules"}</h1>
        </div>
      </header>

      {step === 1 ? (
        <section>
          {sports.length > 1 && (
            <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
              {sports.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSport(s);
                    setSelected([]);
                  }}
                  className={cn(
                    "h-10 shrink-0 rounded-full border px-4 text-sm font-medium",
                    s === sport
                      ? "border-brand bg-brand/15 text-brand"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {sportEmoji(s)} {sportLabel(s)}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-6">
            {byDay.map(([day, dayEvents]) => (
              <div key={day}>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {day}
                </h2>
                <ul className="space-y-2">
                  {dayEvents.map((e) => {
                    const on = selected.includes(e.id);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(e.id)}
                          className={cn(
                            "flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                            on ? "border-brand bg-brand/10" : "border-border bg-card",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-md border",
                              on ? "border-brand bg-brand text-brand-foreground" : "border-border",
                            )}
                          >
                            {on && <Check className="size-4" />}
                          </span>
                          <span className="flex-1">
                            <span className="block font-medium">{matchupLabel(e)}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatKickoff(e.commence_time)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <StickyFooter>
            <Button className="h-14 w-full text-base font-semibold" disabled={!selected.length} onClick={goToRules}>
              {selected.length
                ? `Continue with ${selected.length} game${selected.length > 1 ? "s" : ""}`
                : "Select at least one game"}
            </Button>
          </StickyFooter>
        </section>
      ) : (
        <section className="space-y-6">
          <Field label="Tournament name" htmlFor="title">
            <Input
              id="title"
              maxLength={60}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-12 text-base"
            />
          </Field>

          <Field label="Your name" htmlFor="name" hint="What the squad sees on the leaderboard.">
            <Input
              id="name"
              maxLength={24}
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 text-base"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Bankroll ($)" htmlFor="bankroll">
              <Input
                id="bankroll"
                inputMode="decimal"
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
                className="h-12 text-base"
              />
            </Field>
            <Field label="Max bet ($)" htmlFor="maxbet">
              <Input
                id="maxbet"
                inputMode="decimal"
                placeholder="No limit"
                value={maxBet}
                onChange={(e) => setMaxBet(e.target.value)}
                className="h-12 text-base"
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Allowed bets</p>
            <div className="flex flex-wrap gap-2">
              {MARKETS.map((m) => {
                const on = markets.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setMarkets((cur) => (on ? cur.filter((k) => k !== m.key) : [...cur, m.key]))
                    }
                    className={cn(
                      "h-11 rounded-full border px-4 text-sm font-medium",
                      on
                        ? "border-brand bg-brand/15 text-brand"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex min-h-12 items-center justify-between rounded-xl border border-border p-3">
            <span>
              <span className="block text-sm font-medium">Parlays</span>
              <span className="text-xs text-muted-foreground">Up to 6 legs</span>
            </span>
            <Switch checked={parlays} onCheckedChange={setParlays} />
          </label>

          {parlays && (
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Same-game parlays</span>
                <span className="text-xs text-muted-foreground">Stack picks from one game, like Ravens ML + Henry TD</span>
              </span>
              <Switch aria-label="Same-game parlays" checked={sameGame} onCheckedChange={setSameGame} />
            </label>
          )}

          {propsAvailable && (
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Player props</span>
                <span className="text-xs text-muted-foreground">
                  Over/under on player stats. You enter the real stats after each game.
                </span>
              </span>
              <Switch aria-label="Player props" checked={playerProps} onCheckedChange={setPlayerProps} />
            </label>
          )}

          {firstKickoff && (
            <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              🔒 Picks lock and are revealed at the first kickoff:{" "}
              <strong className="text-foreground">{formatKickoff(firstKickoff)}</strong>
            </p>
          )}

          <StickyFooter>
            <Button className="h-14 w-full text-base font-semibold" disabled={submitting} onClick={submit}>
              {submitting && <Loader2 className="animate-spin" />}
              Create &amp; get invite link
            </Button>
          </StickyFooter>
        </section>
      )}
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}

function groupByDay(events: EventRow[]): [string, EventRow[]][] {
  const map = new Map<string, EventRow[]>();
  for (const e of events) {
    const day = formatDay(e.commence_time);
    map.set(day, [...(map.get(day) ?? []), e]);
  }
  return [...map.entries()];
}

function suggestTitle(chosen: EventRow[], sport: string): string {
  if (chosen.length === 1) {
    const e = chosen[0]!;
    const short = (t: string) => t.split(" ").pop();
    return `${short(e.away_team)} @ ${short(e.home_team)}`;
  }
  const day = chosen[0] ? new Date(chosen[0].commence_time).toLocaleDateString("en-US", { weekday: "long" }) : "";
  return `${sportLabel(sport)} ${day} Slate`.trim();
}
