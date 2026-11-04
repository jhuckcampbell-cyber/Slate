// odds-sync: the ONLY caller of The Odds API (CLAUDE.md rule 6).
// Triggered every minute by pg_cron (private.trigger_odds_sync) when work is due. Asks the DB
// what to fetch (odds_sync_claim → single-flight lease + due jobs), fetches, normalizes, and
// writes through odds_sync_ingest (diff-upsert).
//
// Credit safety (Phase 4): every PAID call reserves its cost with odds_budget_reserve() first;
// the DB refuses when paid calls are switched off, the monthly cap is reached, or the provider's
// own counter is low. The reservation is settled with the real cost from the response headers.
// POST {"dry_run": true} plans the run (calls, costs, budget) without calling the provider.
// Env:
//   ODDS_SYNC_SECRET   shared secret; must match Vault 'odds_sync_secret'
//   ODDS_PROVIDER      'fake' (local/CI, no credits) | 'the-odds-api'
//   ODDS_API_KEY       required for the-odds-api
//   ODDS_BOOKMAKERS    priority list, default "draftkings,fanduel,betmgm"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fakeOddsResponse } from "../_shared/fake-provider.ts";
import { normalizeOddsResponse } from "../_shared/normalize.ts";
import type { ApiEvent } from "../_shared/odds-api.ts";
import { oddsCallCost, usageFromHeaders, type Usage as HeaderUsage } from "../_shared/budget.ts";
import { fakeScoresResponse, normalizeScores, SCORES_CALL_COST, type ApiScoreEvent } from "../_shared/scores.ts";

type Job =
  | { kind: "odds"; sport_key: string; markets: string[]; event_ids: string[] }
  | { kind: "scores"; sport_key: string; event_ids: string[] }
  | { kind: "props"; sport_key: string; event_id: string; markets: string[] }
  | { kind: "catalog"; sport_key: string };

type Usage = { endpoint: string; credits_used: number | null; credits_remaining: number | null };
type Reserve = { ok: boolean; reason?: string; reservation_id?: number; budget?: unknown };

const ODDS_API = "https://api.the-odds-api.com/v4";

Deno.serve(async (req) => {
  const secret = Deno.env.get("ODDS_SYNC_SECRET");
  if (!secret || req.headers.get("x-sync-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const provider = Deno.env.get("ODDS_PROVIDER");
  if (provider !== "fake" && provider !== "the-odds-api") {
    return json({ error: "ODDS_PROVIDER must be 'fake' or 'the-odds-api'" }, 500);
  }
  if (provider === "the-odds-api" && !Deno.env.get("ODDS_API_KEY")) {
    return json({ error: "ODDS_API_KEY is not set" }, 500);
  }

  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  const { data: claim, error } = await supabase.rpc("odds_sync_claim", { p_lease_seconds: 120 });
  if (error) return json({ error: `claim failed: ${error.message}` }, 500);
  if (!claim?.claimed) return json({ skipped: "another sync holds the lease" });

  const bookmakers = (Deno.env.get("ODDS_BOOKMAKERS") ?? "draftkings,fanduel,betmgm")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

  if (dryRun) {
    try {
      const { data: status } = await supabase.rpc("odds_budget_status");
      const plan = (claim.jobs as Job[]).map((job) =>
        job.kind === "catalog"
          ? { kind: job.kind, sport_key: job.sport_key, endpoint: `/sports/${job.sport_key}/events`, cost: 0 }
          : job.kind === "props"
          ? {
              kind: job.kind,
              sport_key: job.sport_key,
              endpoint: `/sports/${job.sport_key}/events/${job.event_id}/odds`,
              markets: job.markets,
              cost: provider === "fake" ? 0 : oddsCallCost(job.markets, bookmakers),
            }
          : job.kind === "scores"
          ? {
              kind: job.kind,
              sport_key: job.sport_key,
              endpoint: `/sports/${job.sport_key}/scores`,
              events: job.event_ids.length,
              cost: provider === "fake" ? 0 : SCORES_CALL_COST,
            }
          : {
              kind: job.kind,
              sport_key: job.sport_key,
              endpoint: `/sports/${job.sport_key}/odds`,
              markets: job.markets,
              events: job.event_ids.length,
              cost: provider === "fake" ? 0 : oddsCallCost(job.markets, bookmakers),
            },
      );
      return json({ dry_run: true, provider, plan, budget: status?.budget ?? null });
    } finally {
      await supabase.rpc("odds_sync_release", { p_holder: claim.holder });
    }
  }

  const results: unknown[] = [];
  try {
    for (const job of claim.jobs as Job[]) {
      try {
        results.push(
          job.kind === "scores"
            ? await runScoresJob(supabase, job, provider)
            : job.kind === "props"
            ? await runPropsJob(supabase, job, provider, bookmakers)
            : await runJob(supabase, job, provider, bookmakers),
        );
      } catch (e) {
        // One sport failing must not block the others; its state isn't advanced, so it retries.
        console.error(`[odds-sync] ${job.kind}/${job.sport_key} failed:`, e);
        results.push({ kind: job.kind, sport_key: job.sport_key, error: String(e) });
      }
    }
  } finally {
    await supabase.rpc("odds_sync_release", { p_holder: claim.holder });
  }

  return json({ provider, breaker_factor: claim.breaker_factor, results });
});

/** Player props: one game per call on the per-event endpoint (cost = prop markets × regions). */
async function runPropsJob(
  supabase: SupabaseClient,
  job: Extract<Job, { kind: "props" }>,
  provider: "fake" | "the-odds-api",
  bookmakers: string[],
) {
  const fetchedAt = new Date().toISOString();
  let apiEvents: ApiEvent[];
  if (provider === "fake") {
    const { data, error } = await supabase
      .from("events")
      .select("id, sport_key, sport_title, home_team, away_team, commence_time")
      .eq("id", job.event_id);
    if (error) throw error;
    apiEvents = fakeOddsResponse(data ?? [], job.markets, { nowMs: Date.now(), bookmaker: bookmakers[0] });
  } else {
    const res = await paidCall<ApiEvent>(supabase, job.sport_key,
      `/sports/${job.sport_key}/events/${job.event_id}/odds`, oddsCallCost(job.markets, bookmakers), {
        markets: job.markets.join(","),
        oddsFormat: "american",
        dateFormat: "iso",
        bookmakers: bookmakers.join(","),
      });
    if ("blocked" in res) return { kind: job.kind, sport_key: job.sport_key, event_id: job.event_id, ...res };
    apiEvents = [res.body];
  }

  const n = normalizeOddsResponse(apiEvents, { markets: job.markets, bookmakers });
  const { data, error } = await supabase.rpc("odds_sync_ingest", {
    p_kind: "props",
    p_sport_key: job.sport_key,
    p_fetched_at: fetchedAt,
    p_events: n.events,
    p_outcomes: n.outcomes,
    p_markets: n.markets,
    p_usage: null,
  });
  if (error) throw new Error(`props ingest failed: ${error.message}`);
  return { kind: job.kind, sport_key: job.sport_key, event_id: job.event_id, skipped_markets: n.skippedMarkets, ...data };
}

async function runJob(
  supabase: SupabaseClient,
  job: Exclude<Job, { kind: "scores" | "props" }>,
  provider: "fake" | "the-odds-api",
  bookmakers: string[],
) {
  const fetchedAt = new Date().toISOString();
  let apiEvents: ApiEvent[] = [];
  let usage: Usage | null = null;

  if (job.kind === "catalog") {
    // /events is free (0 credits) on The Odds API. The fake provider has no catalog: seed.sql is.
    if (provider === "the-odds-api") {
      const path = `/sports/${job.sport_key}/events`;
      const res = await oddsApi(path, { dateFormat: "iso" });
      apiEvents = res.body;
      usage = {
        endpoint: path,
        credits_used: res.headerUsage.creditsUsed,
        credits_remaining: res.headerUsage.creditsRemaining,
      };
    }
  } else if (provider === "fake") {
    const { data, error } = await supabase
      .from("events")
      .select("id, sport_key, sport_title, home_team, away_team, commence_time")
      .in("id", job.event_ids);
    if (error) throw error;
    apiEvents = fakeOddsResponse(data ?? [], job.markets, { nowMs: Date.now(), bookmaker: bookmakers[0] });
  } else {
    // PAID. Cost = markets × regions either way; eventIds only trims the payload.
    const res = await paidCall<ApiEvent[]>(supabase, job.sport_key, `/sports/${job.sport_key}/odds`,
      oddsCallCost(job.markets, bookmakers), {
        markets: job.markets.join(","),
        oddsFormat: "american",
        dateFormat: "iso",
        bookmakers: bookmakers.join(","),
        eventIds: job.event_ids.join(","),
      });
    if ("blocked" in res) return { kind: job.kind, sport_key: job.sport_key, ...res };
    apiEvents = res.body;
  }

  const n = normalizeOddsResponse(apiEvents, {
    markets: job.kind === "odds" ? job.markets : [],
    bookmakers,
  });

  const { data, error } = await supabase.rpc("odds_sync_ingest", {
    p_kind: job.kind,
    p_sport_key: job.sport_key,
    p_fetched_at: fetchedAt,
    p_events: n.events,
    p_outcomes: n.outcomes,
    p_markets: n.markets,
    p_usage: usage,
  });
  if (error) throw new Error(`ingest failed: ${error.message}`);

  return { kind: job.kind, sport_key: job.sport_key, skipped_markets: n.skippedMarkets, ...data };
}

async function runScoresJob(
  supabase: SupabaseClient,
  job: Extract<Job, { kind: "scores" }>,
  provider: "fake" | "the-odds-api",
) {
  const fetchedAt = new Date().toISOString();
  let apiScores: ApiScoreEvent[];
  if (provider === "fake") {
    const { data, error } = await supabase
      .from("events")
      .select("id, sport_key, sport_title, home_team, away_team, commence_time")
      .in("id", job.event_ids);
    if (error) throw error;
    apiScores = fakeScoresResponse(data ?? [], { nowMs: Date.now() });
  } else {
    // daysFrom=1 so games that just finished are included (2 credits instead of 1).
    const res = await paidCall<ApiScoreEvent[]>(supabase, job.sport_key, `/sports/${job.sport_key}/scores`,
      SCORES_CALL_COST, { daysFrom: "1", dateFormat: "iso", eventIds: job.event_ids.join(",") });
    if ("blocked" in res) return { kind: job.kind, sport_key: job.sport_key, ...res };
    apiScores = res.body;
  }

  const { data, error } = await supabase.rpc("scores_ingest", {
    p_sport_key: job.sport_key,
    p_fetched_at: fetchedAt,
    p_scores: normalizeScores(apiScores, job.event_ids),
  });
  if (error) throw new Error(`scores ingest failed: ${error.message}`);
  return { kind: job.kind, sport_key: job.sport_key, ...data };
}

/** Every PAID call: reserve in the DB first (it can say no), call, then settle with the real cost. */
async function paidCall<T>(
  supabase: SupabaseClient,
  sportKey: string,
  path: string,
  cost: number,
  params: Record<string, string>,
): Promise<{ body: T } | { blocked: string | undefined; budget: unknown }> {
  const { data: reserve, error: reserveErr } = await supabase.rpc("odds_budget_reserve", {
    p_sport_key: sportKey,
    p_endpoint: path,
    p_cost: cost,
  });
  if (reserveErr) throw new Error(`reserve failed: ${reserveErr.message}`);
  const r = reserve as Reserve;
  if (!r.ok) return { blocked: r.reason, budget: r.budget };

  let headerUsage: HeaderUsage = { creditsUsed: null, creditsRemaining: null };
  try {
    const res = await oddsApi<T>(path, params);
    headerUsage = res.headerUsage;
    return { body: res.body };
  } catch (e) {
    headerUsage = (e as { headerUsage?: HeaderUsage }).headerUsage ?? headerUsage;
    throw e;
  } finally {
    // Always settle. A null cost (network error, no headers) keeps the estimate charged.
    await supabase.rpc("odds_budget_settle", {
      p_reservation_id: r.reservation_id!,
      p_credits_used: headerUsage.creditsUsed ?? undefined,
      p_credits_remaining: headerUsage.creditsRemaining ?? undefined,
    });
    if (headerUsage.creditsUsed !== null && headerUsage.creditsUsed > cost) {
      console.warn(`[odds-sync] ${path} cost ${headerUsage.creditsUsed} > reserved ${cost}`);
    }
  }
}

async function oddsApi<T = ApiEvent[]>(
  path: string,
  params: Record<string, string>,
): Promise<{ body: T; headerUsage: HeaderUsage }> {
  const key = Deno.env.get("ODDS_API_KEY")!;
  const url = new URL(ODDS_API + path);
  url.searchParams.set("apiKey", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url); // never log `url`: it carries the API key
  const headerUsage = usageFromHeaders(res.headers);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200).replaceAll(key, "[redacted]");
    const err = new Error(`The Odds API ${res.status} on ${path}: ${text}`) as Error & { headerUsage?: HeaderUsage };
    err.headerUsage = headerUsage;
    throw err;
  }
  return { body: (await res.json()) as T, headerUsage };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
