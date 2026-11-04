/**
 * Host "Edit rules" form ⇄ update_tournament's p_changes. Only changed fields are sent, so an
 * untouched lock time (stored with seconds, edited in minutes) is never silently rounded.
 * Error codes match the RPC's so src/lib/errors.ts has one message per problem.
 */
import { dollarsToCents, fromDateTimeLocal, toDateTimeLocal } from "./format";

export type EditableRules = {
  title: string;
  lockTime: string;
  maxBetCents: number | null;
  startingBankrollCents: number;
  markets: readonly string[];
  parlays: boolean;
  maxParlayLegs: number;
  playerProps: boolean;
};

/** Form state: strings as typed. maxBet "" = no limit; lockTime is a datetime-local value. */
export type RulesDraft = {
  title: string;
  lockTime: string;
  maxBet: string;
  bankroll: string;
  markets: string[];
  parlays: boolean;
  maxParlayLegs: number;
  playerProps: boolean;
};

export type TournamentChanges = {
  title?: string;
  lock_time?: string;
  max_bet_cents?: number | null;
  starting_bankroll_cents?: number;
  allowed_bet_types?: { markets: string[]; parlays: boolean; max_parlay_legs: number; player_props: boolean };
};

export type RulesChangesResult = { ok: true; changes: TournamentChanges } | { ok: false; error: string };

const centsToInput = (cents: number) => String(cents / 100);
const sorted = (xs: readonly string[]) => [...xs].sort();

export function draftFromRules(r: EditableRules): RulesDraft {
  return {
    title: r.title,
    lockTime: toDateTimeLocal(r.lockTime),
    maxBet: r.maxBetCents === null ? "" : centsToInput(r.maxBetCents),
    bankroll: centsToInput(r.startingBankrollCents),
    markets: [...r.markets],
    parlays: r.parlays,
    maxParlayLegs: r.maxParlayLegs,
    playerProps: r.playerProps,
  };
}

export function rulesChanges(r: EditableRules, d: RulesDraft): RulesChangesResult {
  const changes: TournamentChanges = {};

  const title = d.title.trim();
  if (!title || title.length > 60) return { ok: false, error: "INVALID_TITLE" };
  if (title !== r.title) changes.title = title;

  if (d.lockTime !== toDateTimeLocal(r.lockTime)) {
    const iso = fromDateTimeLocal(d.lockTime);
    if (!iso) return { ok: false, error: "INVALID_LOCK_TIME" };
    changes.lock_time = iso;
  }

  const bankroll = dollarsToCents(d.bankroll);
  if (bankroll === null || bankroll < 100) return { ok: false, error: "INVALID_BANKROLL" };
  if (bankroll !== r.startingBankrollCents) changes.starting_bankroll_cents = bankroll;

  let maxBet: number | null = null;
  if (d.maxBet.trim() !== "") {
    maxBet = dollarsToCents(d.maxBet);
    if (maxBet === null || maxBet < 100 || maxBet > bankroll) return { ok: false, error: "INVALID_MAX_BET" };
  }
  if (maxBet !== r.maxBetCents) changes.max_bet_cents = maxBet;

  if (d.markets.length === 0) return { ok: false, error: "INVALID_RULES" };
  const markets = sorted(d.markets);
  if (
    markets.join() !== sorted(r.markets).join() ||
    d.parlays !== r.parlays ||
    d.maxParlayLegs !== r.maxParlayLegs ||
    d.playerProps !== r.playerProps
  ) {
    changes.allowed_bet_types = {
      markets,
      parlays: d.parlays,
      max_parlay_legs: d.maxParlayLegs,
      player_props: d.playerProps,
    };
  }

  return { ok: true, changes };
}
