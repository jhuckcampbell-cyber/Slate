"use client";

import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { MAX_SLIP_SELECTIONS, type Selection, type SlipMode } from "@/lib/core/slip";

/** A pick in the slip: the accepted price/line plus display context. */
export type SlipEntry = Selection & { matchup: string; participantTeam?: string | null };

type State = {
  entries: SlipEntry[];
  mode: SlipMode;
  /** Raw dollar strings as typed (parsed with dollarsToCents at render). */
  stakes: Record<number, string>;
  parlayStake: string;
  /** Mixed mode (token tournaments): the picks grouped into the one parlay. */
  parlayIds: number[];
  open: boolean;
};

type Action =
  | { type: "toggle"; entry: SlipEntry }
  | { type: "remove"; oddsId: number }
  | { type: "clear" }
  | { type: "mode"; mode: SlipMode }
  | { type: "stake"; oddsId: number; value: string }
  | { type: "stakeAll"; value: string }
  | { type: "stakeEach"; values: Record<number, string> }
  | { type: "parlayStake"; value: string }
  | { type: "toggleParlayLeg"; oddsId: number }
  | { type: "accept"; updates: { oddsId: number; priceAmerican: number; point: number | null }[] }
  | { type: "open"; open: boolean };

const initialState: State = { entries: [], mode: "singles", stakes: {}, parlayStake: "", parlayIds: [], open: false };

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
        parlayIds: state.parlayIds.filter((id) => id !== action.oddsId),
        mode: entries.length < 2 ? "singles" : state.mode,
        open: entries.length > 0 && state.open,
      };
    }
    case "clear":
      return initialState;
    case "mode":
      // Entering mixed mode starts with every pick in the parlay; tap a pick out to make it a single.
      return {
        ...state,
        mode: action.mode,
        parlayIds: action.mode === "mixed" && state.mode !== "mixed" ? state.entries.map((e) => e.oddsId) : state.parlayIds,
      };
    case "toggleParlayLeg":
      return {
        ...state,
        parlayIds: state.parlayIds.includes(action.oddsId)
          ? state.parlayIds.filter((id) => id !== action.oddsId)
          : [...state.parlayIds, action.oddsId],
      };
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

const SlipContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function SlipProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip() {
  const ctx = useContext(SlipContext);
  if (!ctx) throw new Error("useSlip must be used inside <SlipProvider>");
  return ctx;
}
