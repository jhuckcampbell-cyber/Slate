/**
 * Phase 2 exit criterion: concurrent slip submissions can't overdraw a bankroll, and concurrent
 * cancels can't double-refund. Real parallel HTTP requests through PostgREST against the local
 * stack (pgTAP runs in a single session, so it can't test this).
 * Requires: `npx supabase start` + `.env.local`. Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = `${Date.now()}`;
const eventId = `it-race-${run}`;
let admin: SupabaseClient<Database>;
let player: SupabaseClient<Database>;
let userId: string;
let tournamentId: string;
let oddsId: number;
let price: number;

beforeAll(async () => {
  if (!url || !publishableKey || !secretKey) throw new Error("Missing Supabase env (.env.local)");
  admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });

  const email = `race-${run}@test.dev`;
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
      { event_id: eventId, market_key: "h2h", outcome_name: "Home Racers", price_american: -110, bookmaker: "it" },
      { event_id: eventId, market_key: "h2h", outcome_name: "Away Racers", price_american: -110, bookmaker: "it" },
    ],
    p_markets: [{ event_id: eventId, market_key: "h2h", bookmaker: "it" }],
  });
  if (ingestErr) throw ingestErr;

  const { data: t, error: tErr } = await player
    .rpc("create_tournament", { p_title: "Race", p_event_ids: [eventId], p_code_prefix: "RACE" })
    .single();
  if (tErr) throw tErr;
  tournamentId = t.id;

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
  await admin.from("events").delete().eq("id", eventId);
});

async function bankroll() {
  const { data, error } = await admin
    .from("tournament_participants")
    .select("remaining_bankroll_cents, total_potential_payout_cents")
    .eq("tournament_id", tournamentId)
    .single();
  if (error) throw error;
  return { remaining: Number(data.remaining_bankroll_cents), potential: Number(data.total_potential_payout_cents) };
}

describe("place_wagers under concurrency", () => {
  it("10 parallel $20 bets on a $100 bankroll: exactly 5 book, never below $0", async () => {
    const slip = [{ amount_cents: 2000, legs: [{ odds_id: oddsId, price_american: price, point: null }] }];
    const results = await Promise.all(
      Array.from({ length: 10 }, () => player.rpc("place_wagers", { p_tournament_id: tournamentId, p_slip: slip })),
    );

    const ok = results.filter((r) => !r.error);
    const rejected = results.filter((r) => r.error);
    expect(ok).toHaveLength(5);
    expect(rejected.map((r) => r.error!.message)).toEqual(Array(5).fill("INSUFFICIENT_BANKROLL"));

    expect(await bankroll()).toEqual({ remaining: 0, potential: 5 * 3818 }); // $20 at -110 → $38.18
    const { count } = await admin
      .from("wagers")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);
    expect(count).toBe(5);
  });

  it("5 parallel cancels of one bet refund it exactly once", async () => {
    const { data: wager } = await admin
      .from("wagers")
      .select("id")
      .eq("tournament_id", tournamentId)
      .limit(1)
      .single();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => player.rpc("cancel_wager", { p_wager_id: wager!.id })),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error).map((r) => r.error!.message)).toEqual(Array(4).fill("WAGER_NOT_FOUND"));
    expect(await bankroll()).toEqual({ remaining: 2000, potential: 4 * 3818 });
  });
});
