"use client";

import { Odds } from "@/components/odds";
import { TeamMark } from "@/components/team-mark";
import { pickTeam } from "@/lib/team-colors";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleDashed, Loader2, Lock, X } from "lucide-react";
import { useRouter } from "next/navigation";
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
} from "@/lib/core/slip";
import { friendlyError, messageFor, priceUpdatesFrom } from "@/lib/errors";
import { MARKET_LABELS, dollarsToCents, formatCents, selectionLabel } from "@/lib/format";
import { patchBoardPrices } from "@/lib/queries/board";
import { queryKeys } from "@/lib/queries/keys";
import { usePlaceWagers, type MyWager, type SlipPayload } from "@/lib/queries/wagers";
import { cn } from "@/lib/utils";
import { useSlip, type SlipEntry } from "./slip-store";

type Props = {
  tournamentId: string;
  participantId: string;
  rules: Rules;
  bankrollCents: number;
  /** Bets already placed in this tournament (for the minimum-bets rule). */
  betsPlaced?: number;
  boardById: ReadonlyMap<number, BoardRow>;
  locked: boolean;
};

const QUICK_STAKES = [500, 1000, 2500];

export function BetSlip({ tournamentId, participantId, rules, bankrollCents, betsPlaced = 0, boardById, locked }: Props) {
  const { state, dispatch } = useSlip();
  const router = useRouter();
  const queryClient = useQueryClient();
  const place = usePlaceWagers({ tournamentId, participantId });
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

  const parlayCheck = parlayEligibility(entries, rules);
  const mode = state.mode === "parlay" && parlayCheck.ok ? "parlay" : "singles";
  const stakeCents = Object.fromEntries(
    entries.map((e) => [e.oddsId, dollarsToCents(state.stakes[e.oddsId] ?? "") ?? 0]),
  );
  const drafts = buildWagers(mode, entries, stakeCents, dollarsToCents(state.parlayStake) ?? 0);
  const issues = validateSlip(drafts, { rules, bankrollCents, betsPlaced });
  const totals = slipTotals(drafts);
  // The most one bet can be: the bankroll, split across singles, capped by the host's max bet.
  const perBet = Math.floor((mode === "parlay" ? bankrollCents : bankrollCents / Math.max(entries.length, 1)) / 100) * 100;
  const maxStake = Math.min(perBet, rules.maxBetCents ?? Number.POSITIVE_INFINITY);
  const missingStake = issues.some((i) => i.code === "MISSING_STAKE");
  // House rules have their own checklist in the slip; every other problem is listed in red.
  const short = houseRuleShortfall(rules, { bankrollCents, betsPlaced }, drafts);
  const hasHouseRules = (rules.minBets ?? 0) > 0 || Boolean(rules.allIn);
  const blockingIssues = [
    ...new Set(issues.filter((i) => i.code !== "MISSING_STAKE" && !i.code.startsWith("HOUSE_RULE_")).map((i) => i.code)),
  ];

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
    const slip: SlipPayload = drafts.map((d) => ({
      amount_cents: d.amountCents,
      legs: d.legs.map((l) => ({ odds_id: l.oddsId, price_american: l.priceAmerican, point: l.point })),
    }));
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

    place.mutate(
      { slip, optimistic, stakeCents: totals.stakeCents, returnCents: totals.returnCents },
      {
        onSuccess: () => {
          dispatch({ type: "clear" });
          toast.success(drafts.length > 1 ? `${drafts.length} bets placed 🔒` : "Bet placed 🔒", {
            description: "Hidden from the squad until kickoff.",
          });
          router.refresh(); // roster "submitted" checkmarks
        },
        onError: (err) => {
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
  if (locked) action = { label: "Picks are locked", disabled: true };
  else if (anyUnavailable) action = { label: "Remove unavailable picks", disabled: true };
  else if (anyChanged) action = { label: "Accept new odds", onClick: acceptChanges, disabled: false };
  else if (missingStake) action = { label: "Enter a stake", disabled: true };
  else if (blockingIssues.length) action = { label: "Fix your slip", disabled: true };
  else if (short.betsShort > 0)
    action = { label: `Add ${short.betsShort} more ${short.betsShort === 1 ? "pick" : "picks"} to place`, disabled: true };
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
              className="h-14 w-full justify-between px-4 text-base font-semibold shadow-lg shadow-brand/20"
              onClick={() => dispatch({ type: "open", open: true })}
            >
              <span className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-background text-xs font-bold text-foreground">
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
            <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "clear" })}>
              Clear all
            </Button>
          </DrawerHeader>

          {entries.length >= 2 && (
            <div className="px-4 pb-2">
              <div role="tablist" className="grid grid-cols-2 rounded-xl bg-card p-1 text-sm ring-1 ring-border">
                {(["singles", "parlay"] as const).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    type="button"
                    aria-selected={mode === m}
                    disabled={m === "parlay" && !parlayCheck.ok}
                    onClick={() => dispatch({ type: "mode", mode: m })}
                    className={cn(
                      "h-10 rounded-lg font-semibold capitalize disabled:opacity-40",
                      mode === m ? "bg-foreground text-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    {m === "parlay" ? `Parlay (${entries.length})` : "Singles"}
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

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
            {live.map(({ entry, row, changed, unavailable }) => (
              <SlipRow
                key={entry.oddsId}
                entry={entry}
                row={row}
                changed={changed}
                unavailable={unavailable}
                mode={mode}
                stake={state.stakes[entry.oddsId] ?? ""}
                onStake={(value) => dispatch({ type: "stake", oddsId: entry.oddsId, value })}
                onRemove={() => dispatch({ type: "remove", oddsId: entry.oddsId })}
              />
            ))}

            {mode === "parlay" && drafts[0] && (
              <div className="rounded-2xl border border-brand/40 bg-brand/5 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{entries.length}-leg parlay</span>
                  <span className="num text-xl leading-none font-bold text-brand"><Odds american={wagerAmerican(drafts[0].legs)} /></span>
                </div>
                <StakeInput
                  value={state.parlayStake}
                  onChange={(value) => dispatch({ type: "parlayStake", value })}
                  returnCents={wagerPayoutCents(drafts[0])}
                  label="Parlay stake"
                />
              </div>
            )}
          </div>

          <DrawerFooter className="gap-3 border-t border-border pt-3">
            <div className="flex gap-2">
              {QUICK_STAKES.filter((c) => c <= maxStake).map((c) => (
                <Button key={c} variant="outline" size="sm" className="h-9 flex-1" onClick={() => setQuickStake(c)}>
                  {formatCents(c)}
                </Button>
              ))}
              <Button variant="outline" size="sm" className="h-9 flex-1" onClick={setMax}>
                {rules.allIn ? "Bet it all" : "Max"}
              </Button>
            </div>

            {hasHouseRules && (
              <ul aria-label="House rules for this slip" className="space-y-1 rounded-xl bg-muted/50 p-2.5 text-sm">
                {(rules.minBets ?? 0) > 0 && (
                  <RuleLine
                    done={short.betsShort === 0}
                    label={`At least ${rules.minBets} ${rules.minBets === 1 ? "bet" : "bets"}`}
                    detail={`${Math.min(betsPlaced + drafts.length, rules.minBets ?? 0)} of ${rules.minBets}`}
                  />
                )}
                {rules.allIn && (
                  <RuleLine
                    done={short.leftCents === 0}
                    label="Bet your whole bankroll"
                    detail={short.leftCents === 0 ? "All in" : `${formatCents(short.leftCents)} left`}
                  />
                )}
              </ul>
            )}

            {blockingIssues.length > 0 && (
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
  mode,
  stake,
  onStake,
  onRemove,
}: {
  entry: SlipEntry;
  row: BoardRow | undefined;
  changed: boolean;
  unavailable: boolean;
  mode: "singles" | "parlay";
  stake: string;
  onStake: (value: string) => void;
  onRemove: () => void;
}) {
  const current = row ?? null;
  return (
    <div className={cn("rounded-2xl bg-card p-3 ring-1 ring-border", unavailable && "opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 font-semibold">
            <PickBadge marketKey={entry.marketKey} outcomeName={entry.outcomeName} participantTeam={entry.participantTeam} />
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
          className="-mt-1 -mr-1 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      {mode === "singles" && (
        <StakeInput
          value={stake}
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

function PickBadge(p: { marketKey: string; outcomeName: string; participantTeam?: string | null }) {
  const team = pickTeam(p);
  return team ? <TeamMark team={team} className="size-5" /> : null;
}

function StakeInput({
  value,
  onChange,
  returnCents,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  returnCents: number;
  label: string;
}) {
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
