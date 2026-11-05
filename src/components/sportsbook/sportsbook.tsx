"use client";

import { CircleCheck, CircleDashed, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { indexBoard, type BoardRow } from "@/lib/core/board";
import type { Rules } from "@/lib/core/slip";
import { formatCents, shortTeam } from "@/lib/format";
import { requirements, type HouseRules } from "@/lib/plain-english";
import { useBoard } from "@/lib/queries/board";
import { useBankroll, useMyWagers, type Bankroll, type MyWager } from "@/lib/queries/wagers";
import { cn } from "@/lib/utils";
import { TabSwitch } from "../tab-switch";
import { BetSlip } from "./bet-slip";
import { EventCard, type SportsbookEvent } from "./event-card";
import { MyPicks } from "./my-picks";
import { SlipProvider, useSlip } from "./slip-store";

export type SportsbookProps = {
  tournamentId: string;
  participantId: string;
  /** Decided by the DB clock (tournaments.is_locked); the page refreshes at lock time. */
  isLocked: boolean;
  rules: Rules;
  events: SportsbookEvent[];
  initialBoard: BoardRow[];
  initialWagers: MyWager[];
  initialBankroll: Bankroll;
  /** Host rules (all-in, minimum bets): a live checklist under the bankroll. */
  houseRules?: HouseRules;
};

export function Sportsbook(props: SportsbookProps) {
  return (
    <SlipProvider>
      <SportsbookInner {...props} />
    </SlipProvider>
  );
}

function SportsbookInner({
  tournamentId,
  participantId,
  isLocked,
  rules,
  events,
  initialBoard,
  initialWagers,
  initialBankroll,
  houseRules,
}: SportsbookProps) {
  const [tab, setTab] = useState<"board" | "picks">("board");
  const { state, dispatch } = useSlip();

  const eventIds = useMemo(() => events.map((e) => e.id), [events]);
  const board = useBoard(tournamentId, eventIds, initialBoard);
  const wagers = useMyWagers(participantId, initialWagers);
  const bankroll = useBankroll(participantId, initialBankroll);

  const index = useMemo(() => indexBoard(board.data), [board.data]);
  const boardById = useMemo(() => new Map(board.data.map((r) => [r.id, r])), [board.data]);
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const selected = useMemo(() => new Set(state.entries.map((e) => e.oddsId)), [state.entries]);
  const atRiskCents = wagers.data.reduce((sum, w) => sum + (w.status === "pending" ? w.amount_cents : 0), 0);

  function toggle(row: BoardRow) {
    const ev = eventsById.get(row.eventId);
    if (!ev || isLocked) return;
    dispatch({
      type: "toggle",
      entry: {
        oddsId: row.id,
        eventId: row.eventId,
        marketKey: row.marketKey,
        outcomeName: row.outcomeName,
        participantName: row.participantName,
        participantTeam: row.participantTeam,
        priceAmerican: row.priceAmerican,
        point: row.point,
        matchup: `${shortTeam(ev.away_team)} @ ${shortTeam(ev.home_team)}`,
      },
    });
  }

  return (
    <section className="mt-6" aria-label="Sportsbook">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Bankroll" value={formatCents(bankroll.data.remainingCents)} highlight />
        <Stat label="At risk" value={formatCents(atRiskCents)} />
        <Stat label="Potential" value={formatCents(bankroll.data.potentialPayoutCents)} />
      </dl>

      {houseRules && (
        <HouseRulesChecklist
          items={requirements(houseRules, {
            bets: wagers.data.length,
            wageredCents: wagers.data.reduce((sum, w) => sum + w.amount_cents, 0),
          })}
        />
      )}

      <TabSwitch
        label="Sportsbook view"
        className="mt-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "board", label: "Games" },
          { value: "picks", label: `My picks${wagers.data.length > 0 ? ` (${wagers.data.length})` : ""}` },
        ]}
      />

      <div className="mt-4">
        {tab === "board" ? (
          <div className="space-y-3">
            {isLocked && (
              <p className="flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                <Lock className="size-4 shrink-0" /> Picks are locked. The board is read-only.
              </p>
            )}
            {events.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                markets={index.get(ev.id)}
                allowedMarkets={rules.markets}
                locked={isLocked}
                selected={selected}
                onToggle={toggle}
              />
            ))}
          </div>
        ) : (
          <MyPicks participantId={participantId} wagers={wagers.data} eventsById={eventsById} locked={isLocked} />
        )}
      </div>

      <BetSlip
        tournamentId={tournamentId}
        participantId={participantId}
        rules={rules}
        bankrollCents={bankroll.data.remainingCents}
        boardById={boardById}
        locked={isLocked}
      />
      {/* Keep the last card clear of the sticky slip bar. */}
      {state.entries.length > 0 && <div className="h-24" aria-hidden />}
    </section>
  );
}

function HouseRulesChecklist({ items }: { items: ReturnType<typeof requirements> }) {
  if (items.length === 0) return null;
  const allDone = items.every((i) => i.done);
  return (
    <ul
      aria-label="House rules"
      className={cn("mt-2 space-y-1 rounded-2xl p-3 text-sm ring-1", allDone ? "bg-win/8 ring-win/30" : "bg-warn/8 ring-warn/30")}
    >
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.done ? <CircleCheck className="size-4 shrink-0 text-win" /> : <CircleDashed className="size-4 shrink-0 text-warn" />}
          <span className="flex-1">{i.label}</span>
          <span className={cn("text-xs font-semibold tabular-nums", i.done ? "text-win" : "text-warn")}>{i.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl bg-card p-2.5 ring-1 ring-border">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("num mt-0.5 text-2xl leading-none font-bold", highlight && "text-brand")}>{value}</dd>
    </div>
  );
}

