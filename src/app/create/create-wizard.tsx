"use client";

import { HouseRulesFields } from "@/components/tournament/house-rules-fields";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { ensureSession } from "@/lib/auth/ensure-session";
import { codePrefix } from "@/lib/core/codes";
import { propMarkets } from "@/lib/core/props";
import { tokenPresets } from "@/lib/core/tokens";
import { formatCents } from "@/lib/format";
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
  { key: "h2h", label: "Winner" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Over/Under" },
] as const;

export function CreateWizard({ events, defaultName }: { events: EventRow[]; defaultName: string }) {
  const router = useRouter();
  const turnstile = useRef<TurnstileHandle>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [direction, setDirection] = useState<"left" | "right">("right");
  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const next = event.state?.slateCreateStep === 2 ? 2 : 1;
      setDirection(next === 2 ? "right" : "left");
      setStep(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
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
  const [allIn, setAllIn] = useState(false);
  const [minBets, setMinBets] = useState(0);
  const [tokenKey, setTokenKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const presets = tokenPresets(dollarsToCents(bankroll) ?? 0);
  const tokens = presets.find((p) => p.key === tokenKey)?.tokens ?? null;
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
    window.history.pushState({ ...window.history.state, slateCreateStep: 2 }, "", window.location.href);
    setDirection("right");
    setStep(2);
  }

  async function submit() {
    const bankrollCents = dollarsToCents(bankroll);
    // Token mode: the tokens are the bet sizes, so there's no separate max bet or minimum number of bets.
    const maxBetCents = maxBet && !tokens ? dollarsToCents(maxBet) : null;
    if (!bankrollCents) return toast.error("Enter a starting bankroll.");
    if (maxBet && !tokens && !maxBetCents) return toast.error("Max bet must be a positive amount.");
    if (maxBetCents && maxBetCents > bankrollCents)
      return toast.error("Max bet can't exceed the bankroll.");
    if (markets.length === 0) return toast.error("Allow at least one bet type.");
    if (!name.trim()) return toast.error("What should your friends call you?");

    setSubmitting(true);
    try {
      await ensureSession(name, () => {
        if (!turnstile.current) throw new Error("CAPTCHA_FAILED");
        return turnstile.current.getToken();
      });
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
            // set_tournament_tokens turns "bet everything" on for token tournaments.
            all_in: tokens ? false : allIn,
            min_bets: tokens ? 0 : minBets,
          },
        })
        .single();
      if (error) throw error;
      if (tokens) {
        const { error: tokenError } = await supabase.rpc("set_tournament_tokens", {
          p_tournament_id: data.id,
          p_tokens: tokens,
        });
        if (tokenError) {
          // Don't leave a half-made tournament behind: undo it and keep the form so the host can fix it.
          await supabase.rpc("delete_tournament", { p_tournament_id: data.id });
          throw tokenError;
        }
      }
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
      <Turnstile ref={turnstile} />
      <header className="mb-6 flex items-center gap-3">
        {step === 2 && (
          <Button variant="outline" size="icon" className="press size-11" aria-label="Back" onClick={() => window.history.back()}>
            <ArrowLeft />
          </Button>
        )}
        <div>
          <p className="text-xs text-muted-foreground">Step {step} of 2</p>
          <h1 className="font-display text-4xl leading-none font-extrabold tracking-tight">{step === 1 ? "Pick the games" : "Set the rules"}</h1>
        </div>
      </header>

      <div aria-label={`Step ${step} of 2`} className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border-2 border-foreground text-center text-xs font-semibold">
        {["1 ? Pick games", "2 ? Set rules"].map((label, index) => (
          <span key={label} aria-current={step === index + 1 ? "step" : undefined} className={cn("px-3 py-2", index === 1 && "border-l-2 border-dashed border-foreground", step === index + 1 ? "bg-tab underline" : "bg-card text-muted-foreground")}>{label}</span>
        ))}
      </div>
      <div key={step} className={direction === "right" ? "panel-slide-in-right" : "panel-slide-in-left"}>
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
                    "h-11 shrink-0 rounded-full border-2 border-foreground px-4 text-sm font-semibold",
                    s === sport ? "bg-foreground text-background" : "bg-card text-foreground",
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
                            "flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-foreground p-3 text-left transition-colors",
                            on ? "bg-surface-2" : "bg-card",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-foreground",
                              on ? "bg-foreground text-background" : "bg-card",
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

          {(sport === "americanfootball_ncaaf" || sport === "basketball_ncaab") && (
            <p className="mt-3 text-sm text-muted-foreground">College: game lines only (winner, spread, total).</p>
          )}

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

          <div className={cn("grid gap-3", tokens ? "grid-cols-1" : "grid-cols-2")}>
            <Field label="Bankroll ($)" htmlFor="bankroll">
              <Input
                id="bankroll"
                inputMode="decimal"
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
                className="h-12 text-base"
              />
            </Field>
            {!tokens && (
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
            )}
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
                      "h-11 rounded-full border-2 border-foreground px-4 text-sm font-semibold",
                      on ? "bg-foreground text-background" : "bg-card text-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex min-h-12 items-center justify-between rounded-xl border-2 border-foreground p-3">
            <span>
              <span className="block text-sm font-medium">Parlays</span>
              <span className="text-xs text-muted-foreground">Up to 6 legs</span>
            </span>
            <Switch checked={parlays} onCheckedChange={setParlays} />
          </label>

          {parlays && (
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-foreground p-3">
              <span>
                <span className="block text-sm font-medium">Same-game parlays</span>
                <span className="text-xs text-muted-foreground">Stack picks from one game, like Ravens to win + Henry TD</span>
              </span>
              <Switch aria-label="Same-game parlays" checked={sameGame} onCheckedChange={setSameGame} />
            </label>
          )}

          {propsAvailable && (
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 border-foreground p-3">
              <span>
                <span className="block text-sm font-medium">Player props</span>
                <span className="text-xs text-muted-foreground">
                  Over/under on player stats. You enter the real stats after each game.
                </span>
              </span>
              <Switch aria-label="Player props" checked={playerProps} onCheckedChange={setPlayerProps} />
            </label>
          )}

          <TokenPicker presets={presets} value={tokenKey} onChange={setTokenKey} />

          {tokens === null && (
            <HouseRulesFields allIn={allIn} onAllIn={setAllIn} minBets={minBets} onMinBets={setMinBets} />
          )}

          {firstKickoff && (
            <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              🔒 Picks lock and are revealed at the first kickoff:{" "}
              <strong className="text-foreground">{formatKickoff(firstKickoff)}</strong>
            </p>
          )}


        </section>
      )}
      </div>
      {step === 1 ? (
          <StickyFooter>
            <Button className="press h-14 w-full text-base font-semibold" disabled={!selected.length} onClick={goToRules}>
              {selected.length
                ? `Continue with ${selected.length} game${selected.length > 1 ? "s" : ""}`
                : "Select at least one game"}
            </Button>
          </StickyFooter>
      ) : (
          <StickyFooter>
            <Button className="press h-14 w-full text-base font-semibold" disabled={submitting} onClick={submit}>
              {submitting && <Loader2 className="motion-safe:animate-spin" />}
              Create &amp; get invite link
            </Button>
          </StickyFooter>
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

/** "How do players bet?": any amount (default) or a token set. Tokens mean every bet is one token and all get used. */
function TokenPicker({
  presets,
  value,
  onChange,
}: {
  presets: ReturnType<typeof tokenPresets>;
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  if (presets.length === 0) {
    return (
      <section className="rounded-xl border border-border p-3">
        <p className="text-sm font-medium">How do players bet?</p>
        <p className="text-xs text-muted-foreground">
          Any amount. For bet tokens ($25 + $25 + $50 style), use a bankroll that splits into whole-dollar quarters,
          like $100 or $200.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="bet-style" className="space-y-2 rounded-xl border-2 border-foreground p-3">
      <p id="bet-style" className="text-sm font-medium">How do players bet?</p>
      <div role="radiogroup" aria-labelledby="bet-style" className="grid gap-2">
        <TokenOption selected={value === null} onSelect={() => onChange(null)} title="Any amount" detail="Type any stake, like normal." />
        {presets.map((p) => (
          <TokenOption
            key={p.key}
            selected={value === p.key}
            onSelect={() => onChange(p.key)}
            title={`Tokens: ${p.tokens.map((t) => formatCents(t)).join(" + ")}`}
            detail={`${p.label}. One token per bet, ${p.tokens.length} bets or parlays, every token used.`}
          />
        ))}
      </div>
    </section>
  );
}

function TokenOption({
  selected,
  onSelect,
  title,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "min-h-12 rounded-xl border-2 px-3 py-2 text-left transition-[background-color,transform] motion-safe:active:scale-[0.98]",
        selected ? "border-foreground bg-foreground text-background" : "border-foreground bg-card",
      )}
    >
      <span className="block text-sm font-bold">{title}</span>
      <span className={cn("block text-xs", selected ? "text-background/80" : "text-muted-foreground")}>{detail}</span>
    </button>
  );
}
