import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createOddsHandler } from "../odds-sync/engine.ts";
import { cycle, healthy } from "../../../workers/odds-worker/logic.mjs";

afterEach(() => vi.unstubAllGlobals());
const event = { id: "game", sport_key: "basketball_nba", home_team: "Home", away_team: "Away", commence_time: "2026-11-13T12:00:00Z" };
function fixture(provider = "fake", reserve = true, loseLease = false, malformed = false) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.split("/").pop()!;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, body });
    if (url.host === "api.the-odds-api.com") {
      if (malformed) return new Response("invalid json", { headers: { "x-requests-last": "1", "x-requests-remaining": "19999" } });
      throw new Error("network failed");
    }
    const data = path === "odds_sync_claim" ? { claimed: true, holder: "holder", jobs: [{ kind: "odds", sport_key: event.sport_key, event_ids: [event.id], markets: ["h2h"] }] }
      : path === "odds_sync_renew" ? !loseLease
      : path === "odds_budget_reserve" ? { ok: reserve, reason: "PAID_CALLS_DISABLED", reservation_id: 1 }
      : path === "events" ? [event]
      : path === "odds_sync_runs" ? (init?.method === "POST" ? { id: 1 } : null)
      : {};
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const values: Record<string,string> = { SUPABASE_URL: "http://db.test", SUPABASE_SERVICE_ROLE_KEY: "test-service", ODDS_SYNC_SECRET: "secret", ODDS_PROVIDER: provider, ODDS_API_KEY: "test-only" };
  return { calls, handler: createOddsHandler(createClient, { get: (name) => values[name] }) };
}
const request = () => new Request("http://worker", { method: "POST", headers: { "x-sync-secret": "secret" }, body: "{}" });

describe("always-on worker", () => {
  it("marks only completed successful cycles healthy", async () => {
    const beat = vi.fn();
    await cycle(async () => new Response("{}"), beat, "secret");
    expect(beat).toHaveBeenCalledOnce();
    await expect(cycle(async () => new Response("{}", { status: 502 }), beat, "secret")).rejects.toThrow("SYNC_FAILED");
    expect(beat).toHaveBeenCalledOnce();
    expect(healthy(null, 100)).toBe(false);
    expect(healthy(100, 45099)).toBe(true);
    expect(healthy(100, 45100)).toBe(false);
  });
  it("runs fake -> normalize -> ingest and releases the lease without paid calls", async () => {
    const { handler, calls } = fixture();
    expect((await handler(request())).status).toBe(200);
    const ingest = calls.find((c) => c.path === "odds_sync_ingest")!;
    expect(ingest.body.p_outcomes).toHaveLength(2);
    expect(calls.some((c) => c.path === "odds_budget_reserve")).toBe(false);
    expect(calls.at(-1)?.path).toBe("odds_sync_release");
  });
  it("never calls the provider when the paid switch refuses reservation", async () => {
    const { handler, calls } = fixture("the-odds-api", false);
    expect((await handler(request())).status).toBe(502);
    expect(calls.some((c) => c.path === "odds_budget_reserve")).toBe(true);
    expect(calls.some((c) => c.path === "odds")).toBe(false);
    expect(calls.at(-1)?.path).toBe("odds_sync_release");
  });
  it("settles an uncertain paid failure with the estimate retained", async () => {
    const { handler, calls } = fixture("the-odds-api");
    expect((await handler(request())).status).toBe(502);
    const settle = calls.find((c) => c.path === "odds_budget_settle")!;
    expect(settle.body.p_reservation_id).toBe(1);
    expect(settle.body.p_credits_used).toBeUndefined();
    expect(calls.at(-1)?.path).toBe("odds_sync_release");
  });
  it("honors charged headers even when provider JSON is malformed", async () => {
    const { handler, calls } = fixture("the-odds-api", true, false, true);
    expect((await handler(request())).status).toBe(502);
    const settle = calls.find((c) => c.path === "odds_budget_settle")!;
    expect(settle.body.p_credits_used).toBe(1);
    expect(settle.body.p_credits_remaining).toBe(19999);
  });
  it("stops work when the single-writer lease is lost", async () => {
    const { handler, calls } = fixture("fake", true, true);
    expect((await handler(request())).status).toBe(502);
    expect(calls.some((c) => c.path === "odds_sync_ingest")).toBe(false);
    expect(calls.at(-1)?.path).toBe("odds_sync_release");
  });
});
