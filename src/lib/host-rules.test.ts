import { describe, expect, it } from "vitest";
import { draftFromRules, rulesChanges, type EditableRules } from "./host-rules";

const current: EditableRules = {
  title: "Sunday Sweat",
  // Seconds on purpose: the form only has minutes, so an untouched lock must not be re-sent.
  lockTime: "2026-11-08T18:00:30.000Z",
  maxBetCents: 2500,
  startingBankrollCents: 10000,
  markets: ["h2h", "spreads", "totals"],
  parlays: true,
  maxParlayLegs: 6,
  playerProps: false,
  sameGameParlays: true,
  allIn: false,
  minBets: 0,
};

describe("rulesChanges", () => {
  it("sends nothing when nothing changed", () => {
    expect(rulesChanges(current, draftFromRules(current))).toEqual({ ok: true, changes: {} });
  });

  it("ignores whitespace-only title edits", () => {
    const draft = { ...draftFromRules(current), title: "  Sunday Sweat " };
    expect(rulesChanges(current, draft)).toEqual({ ok: true, changes: {} });
  });

  it("sends a new max bet in cents, and null for no limit", () => {
    expect(rulesChanges(current, { ...draftFromRules(current), maxBet: "20" })).toEqual({
      ok: true,
      changes: { max_bet_cents: 2000 },
    });
    expect(rulesChanges(current, { ...draftFromRules(current), maxBet: "" })).toEqual({
      ok: true,
      changes: { max_bet_cents: null },
    });
  });

  it("sends the whole bet-type block when any part of it changes", () => {
    const draft = { ...draftFromRules(current), markets: ["totals", "h2h"], maxParlayLegs: 3 };
    expect(rulesChanges(current, draft)).toEqual({
      ok: true,
      changes: {
        allowed_bet_types: { markets: ["h2h", "totals"], parlays: true, max_parlay_legs: 3, player_props: false, same_game_parlays: true, all_in: false, min_bets: 0 },
      },
    });
  });

  it("turning player props on is a bet-type change", () => {
    expect(rulesChanges(current, { ...draftFromRules(current), playerProps: true })).toEqual({
      ok: true,
      changes: {
        allowed_bet_types: { markets: ["h2h", "spreads", "totals"], parlays: true, max_parlay_legs: 6, player_props: true, same_game_parlays: true, all_in: false, min_bets: 0 },
      },
    });
  });

  it("turning same-game parlays off is a bet-type change", () => {
    expect(rulesChanges(current, { ...draftFromRules(current), sameGameParlays: false })).toEqual({
      ok: true,
      changes: {
        allowed_bet_types: { markets: ["h2h", "spreads", "totals"], parlays: true, max_parlay_legs: 6, player_props: false, same_game_parlays: false, all_in: false, min_bets: 0 },
      },
    });
  });

  it("all-in and a minimum number of bets are bet-type changes", () => {
    expect(rulesChanges(current, { ...draftFromRules(current), allIn: true, minBets: 3 })).toEqual({
      ok: true,
      changes: {
        allowed_bet_types: {
          markets: ["h2h", "spreads", "totals"],
          parlays: true,
          max_parlay_legs: 6,
          player_props: false,
          same_game_parlays: true,
          all_in: true,
          min_bets: 3,
        },
      },
    });
  });

  it("minimum bets stays between 0 and 20", () => {
    expect(rulesChanges(current, { ...draftFromRules(current), minBets: 25 })).toEqual({ ok: false, error: "INVALID_MIN_BETS" });
    expect(rulesChanges(current, { ...draftFromRules(current), minBets: -1 })).toEqual({ ok: false, error: "INVALID_MIN_BETS" });
  });

  it("converts an edited lock time from the phone's local time to UTC", () => {
    const draft = { ...draftFromRules(current), lockTime: "2026-11-08T12:30" };
    expect(rulesChanges(current, draft)).toEqual({
      ok: true,
      changes: { lock_time: new Date(2026, 10, 8, 12, 30).toISOString() },
    });
  });

  it("sends a new starting bankroll in cents", () => {
    expect(rulesChanges(current, { ...draftFromRules(current), bankroll: "250" })).toEqual({
      ok: true,
      changes: { starting_bankroll_cents: 25000 },
    });
  });

  it.each([
    [{ title: "   " }, "INVALID_TITLE"],
    [{ maxBet: "twenty" }, "INVALID_MAX_BET"],
    [{ bankroll: "0" }, "INVALID_BANKROLL"],
    [{ markets: [] }, "INVALID_RULES"],
    [{ lockTime: "" }, "INVALID_LOCK_TIME"],
  ])("rejects %o with %s", (patch, error) => {
    expect(rulesChanges(current, { ...draftFromRules(current), ...patch })).toEqual({ ok: false, error });
  });
});
