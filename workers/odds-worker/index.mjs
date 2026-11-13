import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createOddsHandler } from "../../supabase/functions/odds-sync/engine.ts";
import { cycle, healthy } from "./logic.mjs";

const env = { get: (name) => process.env[name] };
for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ODDS_SYNC_SECRET", "ODDS_PROVIDER"]) {
  if (!env.get(name)) throw new Error(`Missing ${name}`);
}
if (!["fake", "the-odds-api"].includes(env.get("ODDS_PROVIDER"))) throw new Error("INVALID_PROVIDER");
if (env.get("ODDS_PROVIDER") === "the-odds-api" && !env.get("ODDS_API_KEY")) throw new Error("Missing ODDS_API_KEY");
const pollMs = Number(process.env.ODDS_WORKER_POLL_MS ?? 1000);
if (!Number.isFinite(pollMs) || pollMs < 250 || pollMs > 10000) throw new Error("INVALID_POLL_INTERVAL");
const admin = createClient(env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
});
const handler = createOddsHandler(createClient, env);
const workerId = randomUUID();
let lastSuccess = null;
let stopping = false;
const sleep = new AbortController();
const server = createServer((req, res) => {
  const ok = !stopping && healthy(lastSuccess, Date.now());
  res.writeHead(req.url === "/health" ? (ok ? 200 : 503) : 404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok, last_success_at: lastSuccess }));
});
server.listen(Number(process.env.PORT ?? 8080), process.env.ODDS_WORKER_HOST ?? "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  stopping = true;
  sleep.abort();
  server.close();
  // Let the active handler settle reservations and release its lease. A hung dependency is bounded.
  setTimeout(() => process.exit(1), 120000).unref();
});
while (!stopping) {
  try {
    await cycle(handler, async () => {
      const { error } = await admin.rpc("odds_worker_beat", { p_worker_id: workerId });
      if (error) throw new Error("HEARTBEAT_FAILED");
    }, env.get("ODDS_SYNC_SECRET"));
    lastSuccess = Date.now();
  } catch {
    // Never log transport errors: request URLs may carry credentials.
    console.error("[odds-worker] cycle failed; retrying");
  }
  await delay(pollMs, undefined, { signal: sleep.signal }).catch(() => {});
}
server.close();
