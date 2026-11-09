/**
 * Select strings, row types, and mappers shared by server components (initial data) and the
 * client query hooks. Deliberately NOT a "use client" module: exports from one become client
 * references when imported by a server component.
 */

/** A revealed pick (post-lock; the database already decided this viewer may see it). */
export type RevealLeg = {
  eventId: string;
  marketKey: string;
  selection: string;
  /** Player name for props; "" for game lines. */
  participantName: string;
  /** Props: the player's team in this game (null if unknown or a game line). */
  participantTeam?: string | null;
  line: number | null;
  oddsAmerican: number;
};

export type RevealWager = {
  id: string;
  participantId: string;
  wagerType: "single" | "parlay";
  amountCents: number;
  potentialPayoutCents: number;
  legs: RevealLeg[];
};

export const BOARD_COLUMNS =
  "id, event_id, market_key, outcome_name, participant_name, point, price_american, updated_at, last_seen_at, is_stale, participant_team";

export const WAGER_SELECT =
  "id, wager_type, amount_cents, odds_american, potential_payout_cents, status, created_at, wager_legs(id, event_id, market_key, selection, participant_name, participant_team, line, odds_american, status)";

export type WagerLeg = {
  id: string;
  event_id: string;
  market_key: string;
  selection: string;
  participant_name: string;
  participant_team: string | null;
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

/** Everyone's wagers, for the post-lock reveal (RLS only returns them once picks are locked). */
export const REVEAL_WAGER_SELECT =
  "id, participant_id, wager_type, amount_cents, odds_american, potential_payout_cents, status, payout_cents, live_probability, wager_legs(event_id, market_key, selection, participant_name, participant_team, line, odds_american, status, live_probability, live_stat)";

/** Graded outcome + live chance, for the sweat view. */
export type LegOutcome = {
  status: string;
  winProbability: number | null;
  /** Props: the player's number in this game so far (live box score), when known. */
  liveStat: number | null;
};

export type RevealedWager = Omit<RevealWager, "legs"> & {
  oddsAmerican: number;
  status: string;
  payoutCents: number | null;
  winProbability: number | null;
  legs: (RevealWager["legs"][number] & LegOutcome)[];
};

type RevealWagerRow = {
  id: string;
  participant_id: string;
  wager_type: "single" | "parlay";
  amount_cents: number;
  odds_american: number;
  potential_payout_cents: number;
  status: string;
  payout_cents: number | null;
  live_probability: number | null;
  wager_legs:
    | {
        event_id: string;
        market_key: string;
        selection: string;
        participant_name: string;
        participant_team?: string | null;
        line: number | null;
        odds_american: number;
        status: string;
        live_probability: number | null;
        live_stat?: number | null;
      }[]
    | null;
};

export function toRevealedWager(row: RevealWagerRow): RevealedWager {
  return {
    id: row.id,
    participantId: row.participant_id,
    wagerType: row.wager_type,
    amountCents: Number(row.amount_cents),
    oddsAmerican: row.odds_american,
    potentialPayoutCents: Number(row.potential_payout_cents),
    status: row.status,
    payoutCents: row.payout_cents === null ? null : Number(row.payout_cents),
    winProbability: row.live_probability === null ? null : Number(row.live_probability),
    legs: (row.wager_legs ?? []).map((l) => ({
      eventId: l.event_id,
      marketKey: l.market_key,
      selection: l.selection,
      participantName: l.participant_name,
      participantTeam: l.participant_team ?? null,
      line: l.line === null ? null : Number(l.line),
      oddsAmerican: l.odds_american,
      status: l.status,
      winProbability: l.live_probability === null ? null : Number(l.live_probability),
      liveStat: l.live_stat === null || l.live_stat === undefined ? null : Number(l.live_stat),
    })),
  };
}

export function toMyWager(row: WagerRow): MyWager {
  const { wager_legs, ...rest } = row;
  return {
    ...rest,
    amount_cents: Number(rest.amount_cents),
    potential_payout_cents: Number(rest.potential_payout_cents),
    legs: (wager_legs ?? []).map((l) => ({ ...l, line: l.line === null ? null : Number(l.line) })),
  };
}
