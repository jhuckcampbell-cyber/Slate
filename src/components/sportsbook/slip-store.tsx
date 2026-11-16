"use client";

import { createContext, useContext, useMemo, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { createSubmissionTracker } from "./submission";
import { MAX_SLIP_SELECTIONS, type Selection } from "@/lib/core/slip";

/** A pick in the slip: the accepted price/line plus display context. */
export type SlipEntry = Selection & { matchup: string; sportKey?: string; participantTeam?: string | null };

type State = {
  entries: SlipEntry[];
  mode: "singles" | "parlay";
  /** Raw dollar strings as typed (parsed with dollarsToCents at render). */
  stakes: Record<number, string>;
  parlayStake: string;
  open: boolean;
};

type Action =
  | { type: "toggle"; entry: SlipEntry }
  | { type: "remove"; oddsId: number; releaseParlay?: boolean }
  | { type: "clear" }
  | { type: "mode"; mode: "singles" | "parlay" }
  | { type: "stake"; oddsId: number; value: string }
  | { type: "stakeAll"; value: string }
  | { type: "stakeEach"; values: Record<number, string> }
  | { type: "parlayStake"; value: string }
  | { type: "accept"; updates: { oddsId: number; priceAmerican: number; point: number | null }[] }
  | { type: "open"; open: boolean };

const initialState: State = { entries: [], mode: "singles", stakes: {}, parlayStake: "", open: false };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "toggle": {
      if (state.entries.some((e) => e.oddsId === action.entry.oddsId)) {
        return reducer(state, { type: "remove", oddsId: action.entry.oddsId });
      }
      if (state.entries.length >= MAX_SLIP_SELECTIONS) return state;
      return { ...state, entries: [...state.entries, action.entry] };
    }
    case "remove": {
      const entries = state.entries.filter((e) => e.oddsId !== action.oddsId);
      const stakes = { ...state.stakes };
      delete stakes[action.oddsId];
      return {
        ...state,
        entries,
        stakes,
        mode: entries.length < 2 ? "singles" : state.mode,
        parlayStake: action.releaseParlay && entries.length < 2 ? "" : state.parlayStake,
        open: entries.length > 0 && state.open,
      };
    }
    case "clear":
      return initialState;
    case "mode":
      return { ...state, mode: action.mode };
    case "stake":
      return { ...state, stakes: { ...state.stakes, [action.oddsId]: action.value } };
    case "stakeAll":
      return {
        ...state,
        stakes: Object.fromEntries(state.entries.map((e) => [e.oddsId, action.value])),
      };
    case "stakeEach":
      return { ...state, stakes: { ...state.stakes, ...action.values } };
    case "parlayStake":
      return { ...state, parlayStake: action.value };
    case "accept": {
      const byId = new Map(action.updates.map((u) => [u.oddsId, u]));
      return {
        ...state,
        entries: state.entries.map((e) => {
          const u = byId.get(e.oddsId);
          return u ? { ...e, priceAmerican: u.priceAmerican, point: u.point } : e;
        }),
      };
    }
    case "open":
      return { ...state, open: action.open && state.entries.length > 0 };
  }
}

const SlipContext = createContext<{
  state: State;
  dispatch: Dispatch<Action>;
  submissions: ReturnType<typeof createSubmissionTracker>;
} | null>(null);

export function SlipProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [submissions] = useState(createSubmissionTracker);
  const value = useMemo(() => ({ state, dispatch, submissions }), [state, submissions]);
  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip() {
  const ctx = useContext(SlipContext);
  if (!ctx) throw new Error("useSlip must be used inside <SlipProvider>");
  return ctx;
}
