"use client";

import { Odds } from "@/components/odds";
import { TeamMark } from "@/components/team-mark";
import { pickTeam } from "@/lib/team-colors";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleDashed, Loader2, Lock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import type { BoardRow } from "@/lib/core/board";
import {
  buildWagers,
  parlayEligibility,
  houseRuleShortfall,
  splitEvenly,
  slipTotals,
  validateSlip,
  wagerAmerican,
  wagerPayoutCents,
  type Rules,
  type SlipMode,
} from "@/lib/core/slip";
import { friendlyError, messageFor, priceUpdatesFrom } from "@/lib/errors";
import { MARKET_LABELS, dollarsToCents, formatCents, selectionLabel } from "@/lib/format";
import { patchBoardPrices } from "@/lib/queries/board";
import { queryKeys } from "@/lib/queries/keys";
import { usePlaceWagers, type MyWager, type SlipPayload } from "@/lib/queries/wagers";
import { cn } from "@/lib/utils";
import { useSlip, type SlipEntry } from "./slip-store";
import { stakesFitTokens, takeTokens } from "@/lib/core/tokens";

type Props = {
  tournamentId: string;
  participantId: string;
  rules: Rules;
  bankrollCents: number;
  /** Bets already placed in this tournament (for the minimum-bets rule). */
  betsPlaced?: number;
  /** Amounts of bets already placed (token mode: which tokens are spent). */
  placedCents?: number[];
  boardById: ReadonlyMap<number, BoardRow>;
  locked: boolean;
};

const QUICK_STAKES = [500, 1000, 2500];

type Snapshot = { bankrollCents: number; betsPlaced: number; placedCents: number[] };

export function BetSlip({ tournamentId, participantId, rules, boardById, locked, ...current }: Props) {
  const { state, dispatch, submissions } = useSlip();
  const router = useRouter();
  const queryClient = useQueryClient();
  const place = usePlaceWagers({ tournamentId, participantId });
  const [retryAttempt, setRetryAttempt] = useState<Parameters<typeof place.mutate>[0] | null>(null);
  // While a slip is sending, the optimistic update already counts its bets as placed but the slip still holds them.
  // Judge the slip against what the player had when they tapped Place, so nothing flashes red mid-submit.
  const [submitted, setSubmitted] = useState<Snapshot | null>(null);
  const { bankrollCents, betsPlaced, placedCents }: Snapshot =
    place.isPending && submitted
      ? submitted
      : { bankrollCents: current.bankrollCents, betsPlaced: current.betsPlaced ?? 0, placedCents: current.placedCents ?? [] };
  const entries = state.entries;

  // Compare what the player accepted with what the board says now (Realtime keeps it live).
  const live = entries.map((entry) => {
    const row = boardById.get(entry.oddsId);
    return {
      entry,
      row,
      unavailable: locked || !row || row.isStale,
      changed: !!row && (row.priceAmerican !== entry.priceAmerican || row.point !== entry.point),
    };
  });
  const anyChanged = live.some((l) => l.changed);
  const anyUnavailable = live.some((l) => l.unavailable);

  // Token mode: the tokens can't all go on one parlay, so the multi-bet tab is "Parlay + singles" (some picks grouped
  // into one parlay on one token, the rest singles), all sent in one submit.
  const tokens = rules.tokens ?? null;
  const multiMode: SlipMode = tokens ? "mixed" : "parlay";
  const parlayCheck = tokens
    ? rules.parlays
      ? ({ ok: true } as const)
      : ({ ok: false, reason: "PARLAYS_DISABLED" } as const)
    : parlayEligibility(entries, rules);
  const mode: SlipMode = state.mode !== "singles" && entries.length >= 2 && parlayCheck.ok ? multiMode : "singles";
  const stakeCents = Object.fromEntries(
    entries.map((e) => [e.oddsId, dollarsToCents(state.stakes[e.oddsId] ?? "") ?? 0]),
  );
  const drafts = buildWagers(mode, entries, stakeCents, dollarsToCents(state.parlayStake) ?? 0, state.parlayIds);
  const draftCents = drafts.map((d) => d.amountCents);
  const parlayIndex = drafts.findIndex((d) => d.legs.length > 1);
  const singleIndex = new Map(drafts.flatMap((d, i) => (d.legs.length === 1 ? [[d.legs[0]!.oddsId, i] as const] : [])));
  const groupedCount = entries.filter((e) => state.parlayIds.includes(e.oddsId)).length;
  const issues = validateSlip(drafts, { rules, bankrollCents, betsPlaced });
  const totals = slipTotals(drafts);
  // The most one bet can be: the bankroll, split across singles, capped by the host's max bet.
  const perBet = Math.floor((mode === "parlay" ? bankrollCents : bankrollCents / Math.max(entries.length, 1)) / 100) * 100;
  const maxStake = Math.min(perBet, rules.maxBetCents ?? Number.POSITIVE_INFINITY);
  const missingStake = issues.some((i) => i.code === "MISSING_STAKE");
  // House rules have their own checklist in the slip; every other problem is listed in red.
  const short = houseRuleShortfall(rules, { bankrollCents, betsPlaced }, drafts);
  const hasHouseRules = (rules.minBets ?? 0) > 0 || Boolean(rules.allIn);
  // Token mode: what's left to spend, and whether this slip spends each token at most once.
  const availableTokens = tokens ? takeTokens(tokens, placedCents) : [];
  const tokensFit = !tokens || stakesFitTokens(availableTokens, draftCents.filter((c) => c > 0));
  const tokensLeftAfter = tokens ? takeTokens(availableTokens, draftCents.filter((c) => c > 0)).length : 0;
  const extraBets = tokens ? Math.max(0, drafts.length - availableTokens.length) : 0;
  const blockingIssues = [
    ...new Set([
      ...issues.filter((i) => i.code !== "MISSING_STAKE" && !i.code.startsWith("HOUSE_RULE_")).map((i) => i.code),
      ...(tokensFit ? [] : ["TOKEN_NOT_AVAILABLE"]),
    ]),
  ];
  /** Token choices for one bet (its index in `drafts`): what's left after the other bets in this slip. */
  function tokensFor(draftIndex: number): number[] {
    return takeTokens(availableTokens, draftCents.filter((c, i) => i !== draftIndex && c > 0));
  }

  if (entries.length === 0) return null;

  function setQuickStake(cents: number) {
    const value = centsToInput(cents);
    if (mode === "parlay") dispatch({ type: "parlayStake", value });
    else dispatch({ type: "stakeAll", value });
  }

  /** Max: everything that's left, split to the cent (so "bet it all" adds up exactly), within the max bet. */
  function setMax() {
    if (mode === "parlay") return setQuickStake(Math.min(bankrollCents, rules.maxBetCents ?? bankrollCents));
    const split = splitEvenly(bankrollCents, entries.length, rules.maxBetCents);
    dispatch({ type: "stakeEach", values: Object.fromEntries(entries.map((e, i) => [e.oddsId, centsToInput(split[i] ?? 0)])) });
  }

  function acceptChanges() {
    dispatch({
      type: "accept",
      updates: live
        .filter((l) => l.row && l.changed)
        .map((l) => ({ oddsId: l.entry.oddsId, priceAmerican: l.row!.priceAmerican, point: l.row!.point })),
    });
  }

  function submit() {
    const payload: SlipPayload = drafts.map((d) => ({
      amount_cents: d.amountCents,
      legs: d.legs.map((l) => ({ odds_id: l.oddsId, price_american: l.priceAmerican, point: l.point })),
    }));
    const submissionId = submissions.forPayload({ tournamentId, payload });
    const slip = payload.map((wager) => ({ ...wager, submission_id: submissionId }));
    const now = new Date().toISOString();
    const optimistic: MyWager[] = drafts.map((d, i) => ({
      id: `optimistic-${now}-${i}`,
      wager_type: d.legs.length > 1 ? "parlay" : "single",
      amount_cents: d.amountCents,
      odds_american: wagerAmerican(d.legs),
      potential_payout_cents: wagerPayoutCents(d),
      status: "pending",
      created_at: now,
      optimistic: true,
      legs: d.legs.map((l, j) => ({
        id: `optimistic-${now}-${i}-${j}`,
        event_id: l.eventId,
        market_key: l.marketKey,
        selection: l.outcomeName,
        participant_name: l.participantName,
        participant_team: (l as SlipEntry).participantTeam ?? null,
        line: l.point,
        odds_american: l.priceAmerican,
        status: "pending",
      })),
    }));

    setSubmitted({ bankrollCents, betsPlaced, placedCents });
    const attempt = retryAttempt ?? { slip, optimistic, stakeCents: totals.stakeCents, returnCents: totals.returnCents };
    place.mutate(
      attempt,
      {
        onSettled: () => setSubmitted(null),
        onSuccess: () => {
          setRetryAttempt(null);
          submissions.clear();
          dispatch({ type: "clear" });
          toast.success(drafts.length > 1 ? `${drafts.length} bets placed 🔒` : "Bet placed 🔒", {
            description: "Hidden from the squad until kickoff.",
          });
          router.refresh(); // roster "submitted" checkmarks
        },
        onError: (err) => {
          // A transport failure may follow a committed transaction. Retry the exact payload even
          // if a bankroll refresh or the lock would otherwise disable the normal Place button.
          setRetryAttempt(!("code" in err) || !err.code ? attempt : null);
          const updates = priceUpdatesFrom(err);
          if (updates.length) {
            queryClient.setQueryData<BoardRow[]>(queryKeys.board(tournamentId), (rows) =>
              patchBoardPrices(rows, updates),
            );
            toast.warning(friendlyError(err));
          } else {
            toast.error(friendlyError(err));
          }
        },
      },
    );
  }

  let action: { label: string; onClick?: () => void; disabled: boolean };
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (place.isPending) action = { label: "Placing…", disabled: true };
  else if (retryAttempt) action = { label: "Retry submission", onClick: submit, disabled: false };
  else if (locked) action = { label: "Picks are locked", disabled: true };
  else if (anyUnavailable) action = { label: "Remove unavailable picks", disabled: true };
  else if (anyChanged) action = { label: "Accept new odds", onClick: acceptChanges, disabled: false };
  else if (extraBets > 0)
    action = { label: `Too many bets: you have ${count(availableTokens.length, "token", "tokens")}`, disabled: true };
  else if (missingStake) action = { label: tokens ? "Pick a token for every bet" : "Enter a stake", disabled: true };
  else if (blockingIssues.length) action = { label: "Fix your slip", disabled: true };
  else if (short.betsShort > 0)
    action = { label: `Add ${short.betsShort} more ${short.betsShort === 1 ? "pick" : "picks"} to place`, disabled: true };
  else if (tokens && tokensLeftAfter > 0)
    action = { label: `${count(tokensLeftAfter, "token", "tokens")} left: add a pick for each`, disabled: true };
  else if (short.leftCents > 0) action = { label: `Bet ${formatCents(short.leftCents)} more to place`, disabled: true };
  else
    action = {
      label: `Place ${drafts.length > 1 ? `${drafts.length} bets` : "bet"} · ${formatCents(totals.stakeCents)}`,
      onClick: submit,
      disabled: place.isPending,
    };

  return (
    <>
      {!state.open && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur">
          <div className="mx-auto max-w-md">
            <Button
              className="h-14 w-full justify-between rounded-2xl px-4 text-base font-semibold"
              onClick={() => dispatch({ type: "open", open: true })}
            >
              <span className="flex items-center gap-2">
                <span
                  data-slip-target
                  className="flex size-6 items-center justify-center rounded-full bg-background text-xs font-bold text-foreground"
                >
                  {entries.length}
                </span>
                Bet slip
              </span>
              <span className="num text-lg">
                {totals.stakeCents > 0
                  ? `${formatCents(totals.stakeCents)} → ${formatCents(totals.returnCents)}`
                  : "Add stakes"}
              </span>
            </Button>
          </div>
        </div>
      )}

      <Drawer open={state.open} onOpenChange={(open) => dispatch({ type: "open", open })}>
        <DrawerContent className="mx-auto w-full max-w-md">
          <DrawerHeader className="flex-row items-center justify-between pb-2 text-left">
            <DrawerTitle className="font-display text-2xl font-extrabold uppercase">Bet slip</DrawerTitle>
            <Button variant="ghost" className="h-11" onClick={() => dispatch({ type: "clear" })}>
              Clear all
            </Button>
          </DrawerHeader>

          {entries.length >= 2 && (
            <div className="px-4 pb-2">
              <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full border-2 border-foreground bg-card p-1 text-sm">
                {(["singles", multiMode] as const).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    type="button"
                    aria-selected={mode === m}
                    disabled={m !== "singles" && !parlayCheck.ok}
                    onClick={() => dispatch({ type: "mode", mode: m })}
                    className={cn(
                      "h-11 rounded-full border-2 disabled:opacity-40",
                      mode === m
                        ? "border-foreground bg-tab font-bold underline decoration-2 underline-offset-4"
                        : "border-transparent font-semibold text-muted-foreground",
                    )}
                  >
                    {m === "parlay" ? `Parlay (${entries.length})` : m === "mixed" ? "Parlay + singles" : "Singles"}
                  </button>
                ))}
              </div>
              {!parlayCheck.ok && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Parlay unavailable: {messageFor(parlayCheck.reason)}
                </p>
              )}
            </div>
          )}

          {tokens && (
            <div className="px-4 pb-2">
              <TokenTray tokens={tokens} placedCents={placedCents} slipCents={drafts.map((d) => d.amountCents)} />
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
            {live.map(({ entry, row, changed, unavailable }) => (
              <SlipRow
                key={entry.oddsId}
                entry={entry}
                row={row}
                changed={changed}
                unavailable={unavailable}
                showStake={singleIndex.has(entry.oddsId)}
                inParlay={mode === "mixed" ? state.parlayIds.includes(entry.oddsId) : null}
                onToggleParlay={() => dispatch({ type: "toggleParlayLeg", oddsId: entry.oddsId })}
                stake={state.stakes[entry.oddsId] ?? ""}
                tokens={tokens ? tokensFor(singleIndex.get(entry.oddsId) ?? -1) : null}
                onStake={(value) => dispatch({ type: "stake", oddsId: entry.oddsId, value })}
                onRemove={() => dispatch({ type: "remove", oddsId: entry.oddsId })}
              />
            ))}

            {parlayIndex >= 0 && drafts[parlayIndex] && (
              <div className="rounded-2xl border-2 border-foreground bg-card p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{drafts[parlayIndex].legs.length}-leg parlay</span>
                  <span className="num text-xl leading-none font-bold text-brand"><Odds american={wagerAmerican(drafts[parlayIndex].legs)} /></span>
                </div>
                <StakeInput
                  value={state.parlayStake}
                  tokens={tokens ? tokensFor(parlayIndex) : null}
                  onChange={(value) => dispatch({ type: "parlayStake", value })}
                  returnCents={wagerPayoutCents(drafts[parlayIndex])}
                  label="Parlay stake"
                />
              </div>
            )}
            {mode === "mixed" && parlayIndex < 0 && (
              <p className="rounded-2xl border-2 border-dashed border-foreground/50 p-3 text-sm text-muted-foreground">
                {groupedCount === 1
                  ? "Add one more pick to make a parlay. Until then, every pick is a single."
                  : "Tap “Add to parlay” on 2 or more picks to group them into one parlay."}
              </p>
            )}
          </div>

          <DrawerFooter className="gap-3 border-t border-border pt-3">
            {tokens ? null : (
            <div className="flex gap-2">
              {QUICK_STAKES.filter((c) => c <= maxStake).map((c) => (
                <Button key={c} variant="outline" className="h-11 flex-1" onClick={() => setQuickStake(c)}>
                  {formatCents(c)}
                </Button>
              ))}
              <Button variant="outline" className="h-11 flex-1" onClick={setMax}>
                {rules.allIn ? "Bet it all" : "Max"}
              </Button>
            </div>
            )}

            {/* Token mode: the token tray is the "use everything" checklist. */}
            {hasHouseRules && ((rules.minBets ?? 0) > 0 || !tokens) && (
              <ul aria-label="House rules for this slip" className="space-y-1 rounded-xl bg-muted/50 p-2.5 text-sm">
                {(rules.minBets ?? 0) > 0 && (
                  <RuleLine
                    done={short.betsShort === 0}
                    label={`At least ${rules.minBets} ${rules.minBets === 1 ? "bet" : "bets"}`}
                    detail={`${Math.min(betsPlaced + drafts.length, rules.minBets ?? 0)} of ${rules.minBets}`}
                  />
                )}
                {rules.allIn && !tokens && (
                  <RuleLine
                    done={short.leftCents === 0}
                    label="Bet your whole bankroll"
                    detail={short.leftCents === 0 ? "All in" : `${formatCents(short.leftCents)} left`}
                  />
                )}
              </ul>
            )}

            {blockingIssues.length > 0 && !place.isPending && (
              <ul className="space-y-1 text-sm text-destructive">
                {blockingIssues.map((code) => (
                  <li key={code}>{messageFor(code)}</li>
                ))}
              </ul>
            )}

            <dl className="grid grid-cols-3 gap-2 text-center text-xs">
              <Summary label="Total stake" value={formatCents(totals.stakeCents)} />
              <Summary label="Potential return" value={formatCents(totals.returnCents)} highlight />
              <Summary label="Bankroll after" value={formatCents(Math.max(bankrollCents - totals.stakeCents, 0))} />
            </dl>

            <Button
              className={cn("h-14 w-full text-base font-semibold", anyChanged && !locked && "bg-warn text-brand-foreground hover:bg-warn")}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {place.isPending ? <Loader2 className="animate-spin" /> : locked ? <Lock /> : null}
              {action.label}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function SlipRow({
  entry,
  row,
  changed,
  unavailable,
  showStake,
  inParlay,
  onToggleParlay,
  stake,
  tokens,
  onStake,
  onRemove,
}: {
  entry: SlipEntry;
  row: BoardRow | undefined;
  changed: boolean;
  unavailable: boolean;
  /** This pick is a single bet with its own stake. */
  showStake: boolean;
  /** Mixed mode: whether this pick is grouped into the parlay (null outside mixed mode). */
  inParlay: boolean | null;
  onToggleParlay: () => void;
  stake: string;
  tokens: number[] | null;
  onStake: (value: string) => void;
  onRemove: () => void;
}) {
  const current = row ?? null;
  return (
    <div className={cn("rounded-2xl bg-card p-3 ring-1 ring-border", unavailable && "opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 font-semibold">
            <PickBadge sportKey={entry.sportKey} marketKey={entry.marketKey} outcomeName={entry.outcomeName} participantTeam={entry.participantTeam} />
            <span className="truncate">{selectionLabel(current ?? entry)}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {MARKET_LABELS[entry.marketKey] ?? entry.marketKey} · {entry.matchup}
          </p>
        </div>
        <div className="num text-right text-lg leading-none font-bold">
          {unavailable ? (
            <span className="text-xs font-medium text-muted-foreground">Unavailable</span>
          ) : changed && current ? (
            <span className="flex items-center gap-1 text-warn">
              <s className="text-xs text-muted-foreground"><Odds american={entry.priceAmerican} /></s>
              <ArrowRight className="size-3" />
              <Odds american={current.priceAmerican} />
            </span>
          ) : (
            <Odds american={entry.priceAmerican} />
          )}
        </div>
        <button
          type="button"
          aria-label={`Remove ${selectionLabel(entry)}`}
          onClick={onRemove}
          className="-mt-2 -mr-2 flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      {inParlay !== null && (
        <button
          type="button"
          aria-pressed={inParlay}
          onClick={onToggleParlay}
          className={cn(
            "mt-2 flex h-11 items-center gap-2 rounded-full border-2 border-foreground px-4 text-sm font-semibold",
            inParlay ? "bg-foreground text-background" : "bg-card",
          )}
        >
          {inParlay ? <CircleCheck className="size-4" /> : <CircleDashed className="size-4" />}
          {inParlay ? "In parlay" : "Add to parlay"}
        </button>
      )}
      {showStake && (
        <StakeInput
          value={stake}
          tokens={tokens}
          onChange={onStake}
          returnCents={wagerPayoutCents({
            amountCents: dollarsToCents(stake) ?? 0,
            legs: [entry],
          })}
          label={`Stake on ${selectionLabel(entry)}`}
        />
      )}
    </div>
  );
}

function RuleLine({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? <CircleCheck className="size-4 shrink-0 text-win" /> : <CircleDashed className="size-4 shrink-0 text-warn" />}
      <span className="flex-1">{label}</span>
      <span className={cn("num text-xs font-semibold", done ? "text-win" : "text-warn")}>{detail}</span>
    </li>
  );
}

function PickBadge(p: { sportKey?: string; marketKey: string; outcomeName: string; participantTeam?: string | null }) {
  const team = pickTeam(p);
  return team ? <TeamMark team={team} sportKey={p.sportKey} className="size-5" /> : null;
}

function StakeInput({
  value,
  tokens = null,
  onChange,
  returnCents,
  label,
}: {
  value: string;
  /** Token mode: tap a token instead of typing (the ones this bet can still take). */
  tokens?: number[] | null;
  onChange: (value: string) => void;
  returnCents: number;
  label: string;
}) {
  if (tokens) {
    const current = dollarsToCents(value) ?? 0;
    const holding = current > 0 && tokens.includes(current);
    // The free tokens: everything this bet could take, minus the one it's already holding.
    const free = (holding ? takeTokens(tokens, [current]) : tokens).slice().sort((a, b) => b - a);
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
          {holding && (
            <button
              type="button"
              role="radio"
              aria-checked
              aria-label={`${formatCents(current)} token (tap to take it back)`}
              onClick={() => onChange("")}
              className="num flex size-12 items-center justify-center rounded-full border-2 border-foreground bg-foreground text-base font-extrabold text-background transition-transform motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:active:scale-90"
            >
              {formatCents(current)}
            </button>
          )}
          {free.map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              role="radio"
              aria-checked={false}
              aria-label={`${formatCents(c)} token`}
              onClick={() => onChange(centsToInput(c))}
              className={cn(
                "num flex items-center justify-center rounded-full border-2 border-dashed border-foreground/50 bg-card font-extrabold text-foreground/80 transition-transform motion-safe:active:scale-90",
                holding ? "size-11 text-xs" : "size-12 text-base",
              )}
            >
              {formatCents(c)}
            </button>
          ))}
          {!holding && free.length === 0 && (
            <span className="text-xs text-muted-foreground">All your tokens are on other bets.</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Returns <span className="num text-lg font-bold text-foreground">{formatCents(returnCents)}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="relative w-28">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
        <Input
          aria-label={label}
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="h-11 pl-6 text-base tabular-nums"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Returns <span className="num text-lg font-bold text-foreground">{formatCents(returnCents)}</span>
      </p>
    </div>
  );
}

function Summary({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-card p-2 ring-1 ring-border">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("num mt-0.5 text-xl leading-none font-bold", highlight && "text-brand")}>{value}</dd>
    </div>
  );
}

function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Token mode, top of the slip: the tokens you still have. A token disappears from here once a bet takes it. */
function TokenTray({ tokens, placedCents, slipCents }: { tokens: readonly number[]; placedCents: number[]; slipCents: number[] }) {
  const left = takeTokens(takeTokens(tokens, placedCents), slipCents.filter((c) => c > 0)).sort((a, b) => b - a);
  const done = left.length === 0;
  return (
    <div
      aria-live="polite"
      className={cn("rounded-2xl border-2 border-foreground p-3", done ? "bg-surface-2" : "bg-tab")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-lg/none font-extrabold">{done ? "All tokens placed" : "Your tokens"}</p>
        <p className="text-xs font-semibold">
          {tokens.length - left.length} of {tokens.length} used
        </p>
      </div>
      {done ? (
        <p className="mt-1 text-xs text-muted-foreground">Every token is on a bet. You&apos;re ready to place.</p>
      ) : (
        <>
          <p className="mt-1 text-xs">Tap a token under each pick. One token per bet, and every token has to be used.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {left.map((t, i) => (
              <span
                key={`${t}-${i}-${left.length}`}
                className="num flex size-12 items-center justify-center rounded-full border-2 border-foreground bg-card text-base font-extrabold motion-safe:animate-in motion-safe:zoom-in-90"
              >
                {formatCents(t)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
