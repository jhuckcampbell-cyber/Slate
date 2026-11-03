"use client";

import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { indexBoard, type BoardRow } from "@/lib/core/board";
import type { Rules } from "@/lib/core/slip";
import { formatCents, shortTeam } from "@/lib/format";
import { useBoard } from "@/lib/queries/board";
import { useBankroll, useMyWagers, type Bankroll, type MyWager } from "@/lib/queries/wagers";
import { cn } from "@/lib/utils";
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

      <div role="tablist" className="mt-4 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
        <TabButton active={tab === "board"} onClick={() => setTab("board")}>
          Board
        </TabButton>
        <TabButton active={tab === "picks"} onClick={() => setTab("picks")}>
          My picks{wagers.data.length > 0 ? ` (${wagers.data.length})` : ""}
        </TabButton>
      </div>

      <div className="mt-4">
        {tab === "board" ? (
          <div className="space-y-3">
            {isLocked && (
              <p className="flex items-center gap-2 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-300">
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-card p-2.5 ring-1 ring-border">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-semibold tabular-nums", highlight && "text-emerald-400")}>{value}</dd>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("h-9 rounded-md font-medium transition-colors", active ? "bg-background shadow-sm" : "text-muted-foreground")}
    >
      {children}
    </button>
  );
}
