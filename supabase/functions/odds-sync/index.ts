// odds-sync: the ONLY caller of The Odds API (CLAUDE.md rule 6).
// Triggered every minute by pg_cron (private.trigger_odds_sync) when work is due. Asks the DB
// what to fetch (odds_sync_claim → single-flight lease + due jobs), fetches, normalizes, and
// writes through odds_sync_ingest (diff-upsert). Env:
//   ODDS_SYNC_SECRET   shared secret; must match Vault 'odds_sync_secret'
//   ODDS_PROVIDER      'fake' (local/CI, no credits) | 'the-odds-api'
//   ODDS_API_KEY       required for the-odds-api
//   ODDS_BOOKMAKERS    priority list, default "draftkings,fanduel,betmgm"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fakeOddsResponse } from "../_shared/fake-provider.ts";
import { normalizeOddsResponse } from "../_shared/normalize.ts";
import type { ApiEvent } from "../_shared/odds-api.ts";

type Job =
  | { kind: "odds"; sport_key: string; markets: string[]; event_ids: string[] }
  | { kind: "catalog"; sport_key: string };

type Usage = { endpoint: string; credits_used: number | null; credits_remaining: number | null };

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

  const { data: claim, error } = await supabase.rpc("odds_sync_claim", { p_lease_seconds: 120 });
  if (error) return json({ error: `claim failed: ${error.message}` }, 500);
  if (!claim?.claimed) return json({ skipped: "another sync holds the lease" });

  const bookmakers = (Deno.env.get("ODDS_BOOKMAKERS") ?? "draftkings,fanduel,betmgm")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

  const results: unknown[] = [];
  try {
    for (const job of claim.jobs as Job[]) {
      try {
        results.push(await runJob(supabase, job, provider, bookmakers));
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

async function runJob(
  supabase: SupabaseClient,
  job: Job,
  provider: "fake" | "the-odds-api",
  bookmakers: string[],
) {
  const fetchedAt = new Date().toISOString();
  let apiEvents: ApiEvent[] = [];
  let usage: Usage | null = null;

  if (job.kind === "catalog") {
    // /events is free (0 credits) on The Odds API. The fake provider has no catalog: seed.sql is.
    if (provider === "the-odds-api") {
      ({ body: apiEvents, usage } = await oddsApi(`/sports/${job.sport_key}/events`, { dateFormat: "iso" }));
    }
  } else if (provider === "fake") {
    const { data, error } = await supabase
      .from("events")
      .select("id, sport_key, sport_title, home_team, away_team, commence_time")
      .in("id", job.event_ids);
    if (error) throw error;
    apiEvents = fakeOddsResponse(data ?? [], job.markets, { nowMs: Date.now(), bookmaker: bookmakers[0] });
  } else {
    // Cost = markets × regions; up to 10 bookmakers count as one region. eventIds trims payload only.
    ({ body: apiEvents, usage } = await oddsApi(`/sports/${job.sport_key}/odds`, {
      markets: job.markets.join(","),
      oddsFormat: "american",
      dateFormat: "iso",
      bookmakers: bookmakers.join(","),
      eventIds: job.event_ids.join(","),
    }));
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

async function oddsApi(path: string, params: Record<string, string>): Promise<{ body: ApiEvent[]; usage: Usage }> {
  const url = new URL(ODDS_API + path);
  url.searchParams.set("apiKey", Deno.env.get("ODDS_API_KEY")!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url); // never log `url`: it carries the API key
  const remaining = res.headers.get("x-requests-remaining");
  const last = res.headers.get("x-requests-last");
  if (!res.ok) throw new Error(`The Odds API ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);

  return {
    body: (await res.json()) as ApiEvent[],
    usage: {
      endpoint: path,
      credits_used: last === null ? null : Math.round(Number(last)),
      credits_remaining: remaining === null ? null : Math.floor(Number(remaining)),
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
