/**
 * Phase 2 exit criterion: concurrent slip submissions can't overdraw a bankroll, and concurrent
 * cancels can't double-refund. Real parallel HTTP requests through PostgREST against the local
 * stack (pgTAP runs in a single session, so it can't test this).
 * Requires: `npx supabase start` + `.env.local`. Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { americanToDecimalE4, payoutCents } from "@/lib/core/odds";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = `${Date.now()}`;
const eventId = `it-w5-${run}`;
let admin: SupabaseClient<Database>;
let player: SupabaseClient<Database>;
let userId: string;
let tournamentId: string;
let oddsId: number;
let price: number;

beforeAll(async () => {
  if (!url || !publishableKey || !secretKey) throw new Error("Missing Supabase env (.env.local)");
  admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });

  const email = `w5-${run}@test.dev`;
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


describe("capacity and cancel/grade concurrency", () => {
  it("parallel joins stop at 100 participants", async () => {
    const {data: t,error} = await player.rpc("create_tournament", {p_title:"Capacity",p_event_ids:[eventId],p_code_prefix:"W5J"}).single();
    if(error) throw error;
    const ids: string[] = [];
    try {
      // Seed 97 existing members through the admin API; race five real authenticated joins.
      // Avoid anonymous-signup IP quotas masking the database capacity race.
      const password=`W5-capacity-${run}-Aa1!`;
      // Bound Auth setup concurrency independently of the join race below.
      for (let start = 0; start < 102; start += 10) {
        const created = await Promise.all(Array.from({ length: Math.min(10, 102 - start) }, (_, offset) => {
          const i = start + offset;
          return admin.auth.admin.createUser({
            email: `capacity-${run}-${i}@test.dev`, password, email_confirm: true,
            user_metadata: { display_name: `Join ${i}` },
          });
        }));
        for (const result of created) if (result.data.user) ids.push(result.data.user.id);
        for (const result of created) if (result.error) throw result.error;
      }
      const seed=await admin.from("tournament_participants").insert(ids.slice(0,97).map(user_id=>({
        tournament_id:t.id,user_id,remaining_bankroll_cents:10000,
      })));
      if(seed.error) throw seed.error;
      const clients=await Promise.all(Array.from({length:5},async(_,i)=>{
        const client=createClient<Database>(url,publishableKey,{auth:{persistSession:false}});
        const signed=await client.auth.signInWithPassword({email:`capacity-${run}-${97+i}@test.dev`,password});
        if(signed.error) throw signed.error;
        return client;
      }));
      const joined=await Promise.all(clients.map(c=>c.rpc("join_tournament",{p_code:t.code})));
      expect(joined.filter(r=>!r.error)).toHaveLength(2);
      expect(joined.filter(r=>r.error).map(r=>r.error!.message)).toEqual(Array(3).fill("TOURNAMENT_FULL"));
      const counted=await admin.from("tournament_participants").select("id",{count:"exact",head:true}).eq("tournament_id",t.id);
      if(counted.error) throw counted.error;
      expect(counted.count).toBe(100);
    } finally {
      for (let start = 0; start < ids.length; start += 10) {
        const removed = await Promise.all(ids.slice(start, start + 10).map(id => admin.auth.admin.deleteUser(id)));
        for (const result of removed) if (result.error) throw result.error;
      }
    }
  },120000);

  it("cancel racing lock and grade either refunds or pays once", async () => {
    const raceEvent=`${eventId}-cancel`;
    try {
      const ev=await admin.from("events").insert({id:raceEvent,sport_key:"americanfootball_nfl",home_team:"Home",away_team:"Away",commence_time:new Date(Date.now()+86400000).toISOString()});
      if(ev.error) throw ev.error;
      const ingest=await admin.rpc("odds_sync_ingest",{p_kind:"odds",p_sport_key:"americanfootball_nfl",p_fetched_at:new Date().toISOString(),p_outcomes:[{event_id:raceEvent,market_key:"h2h",outcome_name:"Home",price_american:100,bookmaker:"test"}],p_markets:[{event_id:raceEvent,market_key:"h2h",bookmaker:"test"}]});
      if(ingest.error) throw ingest.error;
      const odds=await admin.from("odds_cache").select("id").eq("event_id",raceEvent).single();
      if(odds.error) throw odds.error;
      const made=await player.rpc("create_tournament",{p_title:"Cancel grade",p_event_ids:[raceEvent],p_code_prefix:"W5C"}).single();
      if(made.error) throw made.error;
      const bet=await player.rpc("place_wagers",{p_tournament_id:made.data.id,p_slip:[{amount_cents:1000,legs:[{odds_id:odds.data.id,price_american:100,point:null}]}]});
      if(bet.error) throw bet.error;
      const [cancel,graded]=await Promise.all([
        player.rpc("cancel_wager",{p_wager_id:bet.data![0].id}),
        (async()=>{
          const locked=await player.rpc("lock_tournament_now",{p_tournament_id:made.data.id});
          if(locked.error) throw locked.error;
          return admin.rpc("scores_ingest",{p_sport_key:"americanfootball_nfl",p_fetched_at:new Date().toISOString(),p_scores:[{event_id:raceEvent,completed:true,home_score:21,away_score:7}]});
        })(),
      ]);
      expect(graded.error).toBeNull();
      if(cancel.error) expect(cancel.error.message).toBe("TOURNAMENT_LOCKED");
      const cash=await admin.from("tournament_participants").select("remaining_bankroll_cents").eq("tournament_id",made.data.id).single();
      if(cash.error) throw cash.error;
      expect(Number(cash.data.remaining_bankroll_cents)).toBe(cancel.error ? 11000 : 10000);
    } finally {
      // Host cleanup below cascades the tournament; events can be removed afterwards.
      const ts=await admin.from("tournament_events").select("tournament_id").eq("event_id",raceEvent);
      for(const row of ts.data??[]) await admin.from("tournaments").delete().eq("id",row.tournament_id);
      await admin.from("events").delete().eq("id",raceEvent);
    }
  });
});

describe("grading correctness races", () => {
  it("generated stake cases match SQL booking and settlement; parallel finals never pay twice", async () => {
    const stakes = [100, 101, 109, 111, 127, 199, 211, 257, 313, 401];
    // The previous cancel left 2000 cents. Use a fresh tournament for these cases.
    const { data: t, error } = await player.rpc("create_tournament", {
      p_title: "Generated payout cases", p_event_ids: [eventId], p_code_prefix: "W5M",
    }).single();
    if (error) throw error;
    const slip = stakes.map((amount_cents) => ({ amount_cents, legs: [{ odds_id: oddsId, price_american: price, point: null }] }));
    const booked = await player.rpc("place_wagers", { p_tournament_id: t.id, p_slip: slip });
    if (booked.error) throw booked.error;
    const expected = stakes.map((stake) => payoutCents(stake, americanToDecimalE4(price))).sort((a,b) => a-b);
    expect(booked.data!.map((w) => Number(w.potential_payout_cents)).sort((a,b) => a-b)).toEqual(expected);
    const locked = await player.rpc("lock_tournament_now", { p_tournament_id: t.id });
    if (locked.error) throw locked.error;
    const final = { p_sport_key: "americanfootball_nfl", p_fetched_at: new Date().toISOString(),
      p_scores: [{ event_id: eventId, completed: true, home_score: 21, away_score: 7 }] };
    const settled = await Promise.all(Array.from({length: 8}, () => admin.rpc("scores_ingest", final)));
    for (const result of settled) expect(result.error).toBeNull();
    const { data: cash, error: cashError } = await admin.from("tournament_participants")
      .select("remaining_bankroll_cents").eq("tournament_id", t.id).single();
    if (cashError) throw cashError;
    expect(Number(cash.remaining_bankroll_cents)).toBe(10000 - stakes.reduce((a,b)=>a+b,0) + expected.reduce((a,b)=>a+b,0));
    const {data: wagers, error: wagersError} = await admin.from("wagers").select("payout_cents,status").eq("tournament_id",t.id);
    if (wagersError) throw wagersError;
    expect(wagers!.every(w => w.status === "won")).toBe(true);
    expect(wagers!.map(w => Number(w.payout_cents)).sort((a,b)=>a-b)).toEqual(expected);
  });
});
