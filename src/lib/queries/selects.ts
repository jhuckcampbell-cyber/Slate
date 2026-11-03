/**
 * Select strings, row types, and mappers shared by server components (initial data) and the
 * client query hooks. Deliberately NOT a "use client" module: exports from one become client
 * references when imported by a server component.
 */

export const BOARD_COLUMNS =
  "id, event_id, market_key, outcome_name, participant_name, point, price_american, updated_at, is_stale";

export const WAGER_SELECT =
  "id, wager_type, amount_cents, odds_american, potential_payout_cents, status, created_at, wager_legs(id, event_id, market_key, selection, participant_name, line, odds_american, status)";

export type WagerLeg = {
  id: string;
  event_id: string;
  market_key: string;
  selection: string;
  participant_name: string;
  line: number | null;
  odds_american: number;
  status: string;
};

export type MyWager = {
  id: string;
  wager_type: "single" | "parlay";
  amount_cents: number;
  odds_american: number;
  potential_payout_cents: number;
  status: string;
  created_at: string;
  legs: WagerLeg[];
  /** Shown before the server confirms (optimistic update). */
  optimistic?: boolean;
};

export type Bankroll = { remainingCents: number; potentialPayoutCents: number };

export type SlipPayload = {
  amount_cents: number;
  legs: { odds_id: number; price_american: number; point: number | null }[];
}[];

export type WagerRow = Omit<MyWager, "legs" | "optimistic"> & { wager_legs: WagerLeg[] | null };

export function toMyWager(row: WagerRow): MyWager {
  const { wager_legs, ...rest } = row;
  return {
    ...rest,
    amount_cents: Number(rest.amount_cents),
    potential_payout_cents: Number(rest.potential_payout_cents),
    legs: (wager_legs ?? []).map((l) => ({ ...l, line: l.line === null ? null : Number(l.line) })),
  };
}
