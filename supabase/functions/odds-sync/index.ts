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
import { fakeOddsResponse, fakeRoster } from "../_shared/fake-provider.ts";
import { normalizeOddsResponse } from "../_shared/normalize.ts";
import type { ApiEvent } from "../_shared/odds-api.ts";
import { oddsCallCost, usageFromHeaders, type Usage as HeaderUsage } from "../_shared/budget.ts";
import { fakeScoresResponse, normalizeScores, SCORES_CALL_COST, type ApiScoreEvent } from "../_shared/scores.ts";
import { SLEEPER_NFL_PLAYERS_URL, sleeperToRoster } from "../_shared/rosters.ts";
import { espnLiveUrl, fakeLiveGames, liveGamesFromScoreboard, type LiveGame } from "../_shared/live.ts";
import { espnBoxToStats, espnScoreboardUrl, espnSummaryUrl, fakeBoxStats, findEspnGame, type BoxStats } from "../_shared/stats.ts";

type Job =
  | { kind: "odds"; sport_key: string; markets: string[]; event_ids: string[] }
  | { kind: "scores"; sport_key: string; event_ids: string[] }
  | { kind: "props"; sport_key: string; event_id: string; markets: string[] }
  | { kind: "catalog"; sport_key: string }
  | {
      kind: "live";
      sport_key: string;
      events: { event_id: string; home_team: string; away_team: string; commence_time: string }[];
    }
  | {
      kind: "stats";
      sport_key: string;
      event_id: string;
      home_team: string;
      away_team: string;
      commence_time: string;
      provider_id: string | null;
    };

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
          : job.kind === "stats"
          ? { kind: job.kind, sport_key: job.sport_key, event_id: job.event_id, endpoint: "espn box score", cost: 0 }
          : job.kind === "live"
          ? { kind: job.kind, sport_key: job.sport_key, events: job.events.length, endpoint: "espn scoreboard", cost: 0 }
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
      await releaseLease(supabase, claim.holder);
    }
  }

  const results: unknown[] = [];
  let failed = false;
  try {
    for (const job of claim.jobs as Job[]) {
      const { data: renewed, error: renewError } = await supabase.rpc("odds_sync_renew", { p_holder: claim.holder });
      if (renewError || !renewed) {
        failed = true;
        results.push({ error: "LEASE_LOST" });
        break;
      }
      const started = Date.now();
      const { data: run, error: runError } = await supabase.from("odds_sync_runs").insert({
        kind: job.kind, sport_key: job.sport_key, event_id: "event_id" in job ? job.event_id : null,
      }).select("id").single();
      if (runError) { failed = true; results.push({ error: "run tracking failed" }); break; }
      // Recheck ownership immediately before each ingest, including jobs with many feed requests.
      const jobClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async (input, init) => {
          if (String(input).includes("_ingest")) {
            const { data, error } = await supabase.rpc("odds_sync_renew", { p_holder: claim.holder });
            if (error || !data) throw new Error("LEASE_LOST");
          }
          return fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });
        } },
      });
      let result: Record<string, unknown>;
      try {
        result = (
          job.kind === "scores"
            ? await runScoresJob(jobClient, job, provider)
            : job.kind === "stats"
            ? await runStatsJob(jobClient, job, provider)
            : job.kind === "live"
            ? await runLiveJob(jobClient, job, provider)
            : job.kind === "props"
            ? await runPropsJob(jobClient, job, provider, bookmakers)
            : await runJob(jobClient, job, provider, bookmakers)
        );
      } catch (e) {
        // One sport failing must not block the others; its state isn't advanced, so it retries.
        console.error(`[odds-sync] ${job.kind}/${job.sport_key} failed:`, safeError(e));
        result = { kind: job.kind, sport_key: job.sport_key, error: safeError(e) };
      }
      const ok = !result.error && !result.blocked && !(result.rosters as { error?: string } | null)?.error;
      failed ||= !ok;
      results.push(result);
      const { error: finishError } = await supabase.from("odds_sync_runs").update({
        finished_at: new Date().toISOString(), ok,
        error: ok ? null : safeError(result.error ?? result.blocked ?? (result.rosters as { error: string }).error),
        counts: result, latency_ms: Date.now() - started,
      }).eq("id", run.id);
      if (finishError) { failed = true; results.push({ error: "run tracking failed" }); }
    }
  } finally {
    await releaseLease(supabase, claim.holder);
  }

  return json({ provider, breaker_factor: claim.breaker_factor, results }, failed ? 502 : 200);
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
  const rosters = provider === "fake" ? await fakeRosters(supabase, job.sport_key) : await syncRosters(supabase, job.sport_key);
  return { kind: job.kind, sport_key: job.sport_key, event_id: job.event_id, skipped_markets: n.skippedMarkets, rosters, ...data };
}

/**
 * Which team each prop player is on (the Odds API doesn't say). Sleeper's free player list, at most once
 * a day per sport (rosters_due), only while props are being synced. Costs no Odds API credits. Never fails
 * the props job: a missing roster just means the board can't label teams.
 */
async function syncRosters(supabase: SupabaseClient, sportKey: string) {
  if (!sportKey.startsWith("americanfootball_nfl")) return null;
  try {
    const { data: due, error } = await supabase.rpc("rosters_due", { p_sport_key: sportKey });
    if (error || !due) return null;
    const res = await fetch(SLEEPER_NFL_PLAYERS_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { error: `sleeper ${res.status}` };
    const players = sleeperToRoster(await res.json());
    if (players.length < 500) return { error: `sleeper roster too small (${players.length})` }; // don't wipe on a bad reply
    const { data, error: ingestError } = await supabase.rpc("rosters_ingest", { p_sport_key: sportKey, p_players: players });
    return ingestError ? { error: ingestError.message } : data;
  } catch (e) {
    return { error: String(e) };
  }
}

/** Local dev: the fake players' teams for every recent game of the sport (so the board groups them like prod). */
async function fakeRosters(supabase: SupabaseClient, sportKey: string) {
  const { data, error } = await supabase
    .from("events")
    .select("home_team, away_team")
    .eq("sport_key", sportKey)
    .gt("commence_time", new Date(Date.now() - 86_400_000).toISOString());
  if (error) return { error: error.message };
  const players = (data ?? []).flatMap((e) => fakeRoster([e.away_team, e.home_team]));
  const { data: res, error: ingestError } = await supabase.rpc("rosters_ingest", { p_sport_key: sportKey, p_players: players });
  return ingestError ? { error: ingestError.message } : res;
}

async function runJob(
  supabase: SupabaseClient,
  job: Exclude<Job, { kind: "scores" | "props" | "stats" | "live" }>,
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

/**
 * Live player stats for a game in play that someone bet a prop on: ESPN's public box score (free, no Odds API
 * credits). The game is matched once by date + teams, then fetched by id. No match yet still records the attempt,
 * so a game the feed doesn't have is retried once a minute, not in a loop. Fake provider: a made-up box score.
 */
async function runStatsJob(
  supabase: SupabaseClient,
  job: Extract<Job, { kind: "stats" }>,
  provider: "fake" | "the-odds-api",
) {
  let providerId = job.provider_id;
  let box: BoxStats = { final: false, stats: [], remaining: null };
  if (provider === "fake") {
    const { data, error } = await supabase
      .from("wager_legs")
      .select("participant_name, market_key")
      .eq("event_id", job.event_id)
      .neq("participant_name", "");
    if (error) throw error;
    const players = new Map<string, { name: string; market_key: string }>();
    for (const l of data ?? []) {
      const market_key = l.market_key.replace(/_alternate$/, "");
      players.set(`${l.participant_name}|${market_key}`, { name: l.participant_name, market_key });
    }
    providerId ??= "fake";
    box = fakeBoxStats([...players.values()], Date.parse(job.commence_time), Date.now());
  } else {
    providerId ??= findEspnGame(await getJson(espnScoreboardUrl(job.sport_key, job.commence_time)), job);
    if (providerId) box = espnBoxToStats(await getJson(espnSummaryUrl(job.sport_key, providerId)), job.sport_key);
  }
  const { data, error } = await supabase.rpc("stats_ingest", {
    p_event_id: job.event_id,
    p_provider_id: providerId,
    p_final: box.final,
    p_stats: box.stats,
    p_remaining: box.remaining,
  });
  if (error) throw new Error(`stats ingest failed: ${error.message}`);
  return { kind: job.kind, event_id: job.event_id, matched: providerId !== null, final: box.final, ...data };
}

/**
 * Live game updates: ESPN's scoreboard, one call per sport per game date (free). Fake provider: a made-up clock and
 * plays, with the scores already in the database (the fake scores job / tests own those).
 */
async function runLiveJob(
  supabase: SupabaseClient,
  job: Extract<Job, { kind: "live" }>,
  provider: "fake" | "the-odds-api",
) {
  let games: LiveGame[] = [];
  if (provider === "fake") {
    const { data, error } = await supabase
      .from("events")
      .select("id, home_score, away_score")
      .in("id", job.events.map((e) => e.event_id));
    if (error) throw error;
    const scores = new Map((data ?? []).map((e) => [e.id, e]));
    games = fakeLiveGames(job.events, job.sport_key, Date.now()).map((g) => ({
      ...g,
      home_score: scores.get(g.event_id)?.home_score ?? null,
      away_score: scores.get(g.event_id)?.away_score ?? null,
    }));
  } else {
    const urls = new Set(job.events.map((e) => espnLiveUrl(job.sport_key, e.commence_time)).filter((u) => u !== null));
    for (const url of urls) games.push(...liveGamesFromScoreboard(await getJson(url), job.events));
  }
  const { data, error } = await supabase.rpc("live_ingest", { p_sport_key: job.sport_key, p_games: games });
  if (error) throw new Error(`live ingest failed: ${error.message}`);
  return { kind: job.kind, sport_key: job.sport_key, games: games.length, ...data };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`stats feed ${res.status}`);
  return res.json();
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
    const { error: settleError } = await supabase.rpc("odds_budget_settle", {
      p_reservation_id: r.reservation_id!,
      p_credits_used: headerUsage.creditsUsed ?? undefined,
      p_credits_remaining: headerUsage.creditsRemaining ?? undefined,
    });
    if (settleError) throw new Error(`budget settle failed: ${settleError.code ?? "RPC_ERROR"}`);
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

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }); // never log `url`: it carries the API key
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

async function releaseLease(supabase: SupabaseClient, holder: string) {
  const { error } = await supabase.rpc("odds_sync_release", { p_holder: holder });
  if (error) throw new Error(`lease release failed: ${error.code ?? "RPC_ERROR"}`);
}

function safeError(value: unknown): string {
  const key = Deno.env.get("ODDS_API_KEY");
  const text = String(value);
  return (key ? text.replaceAll(key, "[redacted]") : text).slice(0, 500);
}
