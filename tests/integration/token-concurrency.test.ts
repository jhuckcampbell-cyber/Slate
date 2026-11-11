/** Token multiset races through real parallel PostgREST requests. Requires local Supabase + .env.local. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = `${Date.now()}`;
const eventId = `it-token-race-${run}`;
let admin: SupabaseClient<Database>;
let player: SupabaseClient<Database>;
let userId: string;
let tournamentId: string;
let oddsId: number;
let price: number;

beforeAll(async () => {
  if (!url || !publishableKey || !secretKey) throw new Error("Missing Supabase env (.env.local)");
  admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });

  const email = `token-race-${run}@test.dev`;
  const password = `pw-${run}-Aa1!`;
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Racer" },
  });
  if (userErr) throw userErr;
  userId = created.user.id;

  player = createClient<Database>(url, publishableKey, { auth: { persistSession: false } });
  const { error: signInErr } = await player.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;

  const commence = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const { error: evErr } = await admin.from("events").insert({
    id: eventId,
    sport_key: "americanfootball_nfl",
    home_team: "Home Racers",
    away_team: "Away Racers",
    commence_time: commence,
  });
  if (evErr) throw evErr;

  const { error: ingestErr } = await admin.rpc("odds_sync_ingest", {
    p_kind: "odds",
    p_sport_key: "americanfootball_nfl",
    p_fetched_at: new Date().toISOString(),
    p_outcomes: [
      {
        event_id: eventId,
        market_key: "h2h",
        outcome_name: "Home Racers",
        price_american: -110,
        bookmaker: "it",
      },
      {
        event_id: eventId,
        market_key: "h2h",
        outcome_name: "Away Racers",
        price_american: -110,
        bookmaker: "it",
      },
    ],
    p_markets: [{ event_id: eventId, market_key: "h2h", bookmaker: "it" }],
  });
  if (ingestErr) throw ingestErr;

  const { data: t, error: tErr } = await player
    .rpc("create_tournament", { p_title: "Race", p_event_ids: [eventId], p_code_prefix: "RACE" })
    .single();
  if (tErr) throw tErr;
  tournamentId = t.id;
  const { error: tokensError } = await player.rpc("set_tournament_tokens", {
    p_tournament_id: tournamentId,
    p_tokens: [2000, 2000, 6000],
  });
  if (tokensError) throw tokensError;

  const { data: odds, error: oddsErr } = await admin
    .from("odds_cache")
    .select("id, price_american")
    .eq("event_id", eventId)
    .eq("outcome_name", "Home Racers")
    .single();
  if (oddsErr) throw oddsErr;
  oddsId = odds.id;
  price = odds.price_american;
});

afterAll(async () => {
  // Deleting the user cascades profile → hosted tournament → participants → wagers/legs.
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (admin) await admin.from("events").delete().eq("id", eventId);
});

const bet = (amount: number) => ({
  amount_cents: amount,
  legs: [{ odds_id: oddsId, price_american: price, point: null }],
});

async function race(amounts: number[]) {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      player.rpc("place_wagers", {
        p_tournament_id: tournamentId,
        p_slip: amounts.map(bet),
      }),
    ),
  );
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  // A stale token snapshot could instead fail later with INSUFFICIENT_BANKROLL.
  // Require the token guard itself to see the winner's committed wagers.
  expect(results.filter((r) => r.error).map((r) => r.error!.message)).toEqual(
    Array(9).fill("TOKEN_NOT_AVAILABLE"),
  );
}

async function assertTokensSpent() {
  const { data: wagers, error } = await admin
    .from("wagers")
    .select("id, amount_cents, potential_payout_cents")
    .eq("tournament_id", tournamentId);
  if (error) throw error;
  // Includes duplicate denominations: two $20 tokens, exactly one $60 token.
  expect(wagers.map((w) => Number(w.amount_cents)).sort((a, b) => a - b)).toEqual([
    2000, 2000, 6000,
  ]);
  const { data: participant, error: participantError } = await admin
    .from("tournament_participants")
    .select("remaining_bankroll_cents, total_potential_payout_cents")
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId)
    .single();
  if (participantError) throw participantError;
  expect(Number(participant.remaining_bankroll_cents)).toBe(0);
  expect(Number(participant.total_potential_payout_cents)).toBe(
    wagers.reduce((sum, w) => sum + Number(w.potential_payout_cents), 0),
  );
  return wagers;
}

it("parallel slips cannot spend a token twice or exceed the dealt token count", async () => {
  // Token mode enforces all-in, so the initial submissions must spend the whole multiset.
  await race([2000, 2000, 6000]);
  const wagers = await assertTokensSpent();

  // Restore just one token: all ten calls now race for that same unused token.
  const restored = wagers.find((w) => Number(w.amount_cents) === 2000)!;
  const { error } = await player.rpc("cancel_wager", { p_wager_id: restored.id });
  expect(error).toBeNull();
  await race([2000]);
  const after = await assertTokensSpent();
  expect(after.some((w) => w.id === restored.id)).toBe(false);
  for (const retained of wagers.filter((w) => w.id !== restored.id)) {
    expect(after.some((w) => w.id === retained.id)).toBe(true);
  }
});
