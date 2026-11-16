"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Eyebrow } from "@/components/brand";
import { Odds } from "@/components/odds";
import { TeamMark } from "@/components/team-mark";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import type { BoardRow } from "@/lib/core/board";
import { wagerAmerican, wagerPayoutCents } from "@/lib/core/slip";
import { takeTokens } from "@/lib/core/tokens";
import { dollarsToCents, formatCents, selectionLabel } from "@/lib/format";
import { messageFor } from "@/lib/errors";
import { pickTeam } from "@/lib/team-colors";
import { cn } from "@/lib/utils";
import { useSlip } from "./slip-store";

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-felt-foreground";
const chip =
  "num relative flex shrink-0 items-center justify-center rounded-full border-2 border-solid border-foreground bg-felt-foreground font-extrabold text-foreground after:pointer-events-none after:absolute after:inset-1 after:rounded-full after:border after:border-dashed after:border-foreground";

export function TokenSlip({
  tokens,
  availableTokens,
  boardById,
  mode,
  parlayCheck,
  parlays,
  action,
  busy,
  issues,
}: {
  tokens: readonly number[];
  availableTokens: number[];
  boardById: ReadonlyMap<number, BoardRow>;
  mode: "singles" | "parlay";
  parlayCheck: { ok: true } | { ok: false; reason: string };
  parlays: boolean;
  action: { label: string; disabled: boolean; onClick?: () => void };
  busy: boolean;
  issues: string[];
}) {
  const { state, dispatch } = useSlip();
  const [selected, setSelected] = useState<number | null>(null);
  const assignments = [
    ...state.entries.flatMap((e) => {
      const amount = dollarsToCents(state.stakes[e.oddsId] ?? "") ?? 0;
      return amount > 0 ? [{ amount, label: selectionLabel(e) }] : [];
    }),
    ...(Number(state.parlayStake) > 0
      ? [{ amount: dollarsToCents(state.parlayStake) ?? 0, label: "parlay" }]
      : []),
  ];
  const remainingAssignments = [...assignments];
  const rail = availableTokens.map((amount) => {
    const index = remainingAssignments.findIndex((a) => a.amount === amount);
    const assigned = index < 0 ? undefined : remainingAssignments.splice(index, 1)[0];
    return { amount, assigned };
  });
  const free = takeTokens(
    availableTokens,
    assignments.map((a) => a.amount),
  );
  const active =
    selected !== null && rail[selected] && !rail[selected].assigned ? rail[selected].amount : null;

  function slot(amount: number, label: string, onChange: (value: string) => void) {
    return (
      <button
        type="button"
        disabled={busy || (!amount && active === null)}
        aria-label={
          amount
            ? "Take " + formatCents(amount) + " off " + label
            : "Put " + (active === null ? "a token" : formatCents(active)) + " on " + label
        }
        onClick={() => {
          onChange(amount ? "" : String((active ?? 0) / 100));
          setSelected(null);
        }}
        className={cn(
          "border-felt-muted text-felt-muted size-11 shrink-0 rounded-full border-2 border-dashed",
          focus,
          amount > 0 && chip,
        )}
      >
        {amount ? formatCents(amount) : "+"}
      </button>
    );
  }

  return (
    <>
      {!state.open && (
        <div className="bg-felt text-felt-foreground fixed inset-x-0 bottom-0 z-40 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <button
            type="button"
            onClick={() => dispatch({ type: "open", open: true })}
            className={cn(
              "border-foreground mx-auto flex min-h-14 w-full max-w-md items-center justify-between gap-2 rounded-2xl border-2 px-3 text-sm font-semibold",
              focus,
            )}
          >
            <span data-slip-target>Your slip · {state.entries.length} picks</span>
            <span className="num">
              {free.length} of {tokens.length} tokens left
            </span>
          </button>
        </div>
      )}
      <Drawer open={state.open} onOpenChange={(open) => dispatch({ type: "open", open })}>
        <DrawerContent className="bg-felt text-felt-foreground border-foreground mx-auto w-full max-w-md [--drawer-bleed-background:var(--felt)] data-[swipe-axis=y]:[--drawer-content-max-height:70dvh] data-[swipe-direction=down]:rounded-t-3xl data-[swipe-direction=down]:border-t-2 motion-reduce:transition-none">
          <div className="flex shrink-0 items-start justify-between gap-2 p-4 pb-2">
            <div>
              <DrawerTitle className="font-display text-felt-foreground text-2xl font-extrabold">
                Your slip
              </DrawerTitle>
              <p aria-live="polite" className="num text-felt-muted text-sm">
                {free.length} of {tokens.length} tokens left
              </p>
            </div>
            {state.entries.length >= 2 && parlays && (
              <div>
                <div
                  role="tablist"
                  aria-label="Bet type"
                  className="border-foreground bg-felt-deep flex rounded-full border-2 p-0.5"
                >
                  {(["singles", "parlay"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      disabled={busy || (m === "parlay" && !parlayCheck.ok)}
                      onClick={() => dispatch({ type: "mode", mode: m })}
                      className={cn(
                        "min-h-11 rounded-full border-2 border-transparent px-3 text-sm font-semibold disabled:opacity-50",
                        focus,
                        mode === m && "border-foreground bg-felt-foreground text-foreground",
                      )}
                    >
                      {m === "singles" ? "Singles" : "Parlay"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {!parlayCheck.ok && state.entries.length >= 2 && (
            <p className="text-felt-muted px-4 pb-2 text-xs">
              Parlay unavailable: {messageFor(parlayCheck.reason)}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-3 px-4 py-3">
            <div
              aria-label="Your tokens"
              className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pt-2 pb-3"
            >
              {rail.map(({ amount, assigned }, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={!assigned && selected === i}
                  aria-label={
                    formatCents(amount) + " token" + (assigned ? ", on " + assigned.label : "")
                  }
                  disabled={!!assigned || busy}
                  onClick={() => setSelected(selected === i ? null : i)}
                  className={cn(
                    chip,
                    focus,
                    "size-[54px] border-b-[5px] text-lg motion-safe:transition-transform",
                    assigned &&
                      "border-felt-muted text-felt-muted after:border-felt-muted border-dashed bg-transparent",
                    !assigned &&
                      selected === i &&
                      "ring-foreground ring-offset-felt ring-2 ring-offset-2 motion-safe:-translate-y-1 motion-safe:-rotate-6",
                  )}
                >
                  <span>
                    {formatCents(amount)}
                    {assigned && (
                      <span className="absolute inset-x-0 bottom-1 truncate px-1 font-sans text-[8px] leading-none">
                        {assigned.label}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-felt-muted w-24 shrink-0 text-xs">
              {active === null ? "Tap a chip, then a pick" : "Now tap a pick"}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3">
            {state.entries.map((entry) => {
              const amount = dollarsToCents(state.stakes[entry.oddsId] ?? "") ?? 0;
              const label = selectionLabel(entry);
              const team = pickTeam(entry);
              const row = boardById.get(entry.oddsId);
              const changed =
                row && (row.priceAmerican !== entry.priceAmerican || row.point !== entry.point);
              return (
                <div
                  key={entry.oddsId}
                  className={cn(
                    "bg-felt-deep flex items-center gap-2 rounded-xl",
                    mode === "parlay" ? "h-9 px-2 text-xs" : "border-foreground border-2 p-2",
                  )}
                >
                  {team && (
                    <TeamMark team={team} sportKey={entry.sportKey} className="size-5 shrink-0" />
                  )}
                  {mode === "singles" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (amount || active !== null) {
                          dispatch({
                            type: "stake",
                            oddsId: entry.oddsId,
                            value: amount ? "" : String((active ?? 0) / 100),
                          });
                          setSelected(null);
                        }
                      }}
                      className={cn("min-h-11 min-w-0 flex-1 rounded text-left", focus)}
                    >
                      <span className="block truncate text-sm font-semibold">{label}</span>
                      <span className="text-felt-muted text-xs">
                        {amount
                          ? "wins " +
                            formatCents(wagerPayoutCents({ amountCents: amount, legs: [entry] }))
                          : active !== null
                            ? "Tap to place"
                            : "No token yet"}
                      </span>
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  )}
                  <span className="num shrink-0">
                    {!row || row.isStale ? (
                      "Unavailable"
                    ) : (
                      <>
                        {changed && <span className="text-felt-muted mr-1">New</span>}
                        <Odds american={row.priceAmerican} />
                      </>
                    )}
                  </span>
                  {mode === "singles" && (
                    <>
                      {slot(amount, label, (value) =>
                        dispatch({ type: "stake", oddsId: entry.oddsId, value }),
                      )}
                      <button
                        type="button"
                        aria-label={"Remove " + label}
                        disabled={busy}
                        onClick={() =>
                          dispatch({ type: "remove", oddsId: entry.oddsId, releaseParlay: true })
                        }
                        className={cn(
                          "border-foreground flex size-11 shrink-0 items-center justify-center rounded-full border-2",
                          focus,
                        )}
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            {mode === "parlay" && (
              <div className="bg-felt-deep flex items-center gap-3 rounded-xl p-3">
                <div className="min-w-0 flex-1">
                  <Eyebrow className="text-felt-muted">{state.entries.length}-leg parlay</Eyebrow>
                  <span className="num text-xl">
                    <Odds american={wagerAmerican(state.entries)} />
                  </span>
                  <p className="text-felt-muted text-xs">
                    {Number(state.parlayStake) > 0
                      ? "wins " +
                        formatCents(
                          wagerPayoutCents({
                            amountCents: dollarsToCents(state.parlayStake) ?? 0,
                            legs: state.entries,
                          }),
                        ) +
                        ", one token, all " +
                        state.entries.length +
                        " must hit"
                      : "One token, all " + state.entries.length + " must hit"}
                  </p>
                </div>
                {slot(dollarsToCents(state.parlayStake) ?? 0, "the parlay", (value) =>
                  dispatch({ type: "parlayStake", value }),
                )}
              </div>
            )}
          </div>
          <div className="border-felt-muted/30 shrink-0 border-t px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
            {issues.map((code) => (
              <p key={code} className="text-felt-foreground mb-2 text-sm">
                {messageFor(code)}
              </p>
            ))}
            <button
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              className={cn(
                "border-foreground min-h-14 w-full rounded-full border-2 px-3 text-sm font-bold",
                focus,
                action.disabled
                  ? "text-felt-muted bg-transparent"
                  : "bg-felt-foreground text-foreground",
              )}
            >
              {action.label}
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
