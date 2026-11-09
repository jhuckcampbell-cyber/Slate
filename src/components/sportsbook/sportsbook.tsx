"use client";

import { CircleCheck, CircleDashed, Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { indexBoard, type BoardRow } from "@/lib/core/board";
import type { Rules } from "@/lib/core/slip";
import { shortTeam } from "@/lib/format";
import { requirements, type HouseRules } from "@/lib/plain-english";
import { useBoard } from "@/lib/queries/board";
import { useBankroll, useMyWagers, type Bankroll, type MyWager } from "@/lib/queries/wagers";
import { cn } from "@/lib/utils";
import { Ticker } from "@/components/ticker";
import { TabSwitch } from "../tab-switch";
import { BetSlip } from "./bet-slip";
import { EventCard, type SportsbookEvent } from "./event-card";
import { GamePage } from "./game-page";
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

  // The game page lives in the URL (?game=ID) so the phone's back button closes it and a reload keeps it open.
  const searchParams = useSearchParams();
  const openGame = eventsById.get(searchParams.get("game") ?? "") ?? null;
  const pushedGame = useRef(false);
  const boardScroll = useRef(0);
  function showGame(id: string) {
    boardScroll.current = window.scrollY;
    const url = new URL(window.location.href);
    url.searchParams.set("game", id);
    window.history.pushState(null, "", url);
    pushedGame.current = true;
  }
  function closeGame() {
    if (pushedGame.current) {
      pushedGame.current = false;
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("game");
      window.history.replaceState(null, "", url);
    }
    requestAnimationFrame(() => window.scrollTo({ top: boardScroll.current }));
  }

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
      <dl className="grid grid-cols-3 divide-x-2 divide-foreground/15 rounded-2xl border-2 border-foreground bg-card py-2.5 text-center">
        <Stat label="Bankroll" cents={bankroll.data.remainingCents} highlight />
        <Stat label="At risk" cents={atRiskCents} />
        <Stat label="Potential" cents={bankroll.data.potentialPayoutCents} />
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
        {tab === "board" && openGame ? (
          <GamePage
            event={openGame}
            markets={index.get(openGame.id)}
            allowedMarkets={rules.markets}
            locked={isLocked}
            selected={selected}
            onToggle={toggle}
            onBack={closeGame}
          />
        ) : tab === "board" ? (
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
                onOpen={() => showGame(ev.id)}
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
        betsPlaced={wagers.data.length}
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
      {!allDone && (
        <li className="pt-1 text-xs text-muted-foreground">
          Your slip can only be placed once it meets every house rule. If you cancel a bet, re-bet before lock or
          you&apos;ll rank last.
        </li>
      )}
    </ul>
  );
}

function Stat({ label, cents, highlight }: { label: string; cents: number; highlight?: boolean }) {
  return (
    <div className="px-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("num mt-0.5 text-2xl leading-none font-bold", highlight && "text-brand")}>
        <Ticker cents={cents} />
      </dd>
    </div>
  );
}

