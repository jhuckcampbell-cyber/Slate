/**
 * Phase 4: parallel odds-sync runs can't overspend the Odds API budget. Fires many concurrent
 * reservations through PostgREST (pgTAP is single-session, so it can't race) and checks the
 * total reserved never exceeds what was left. Leaves the ledger as it found it: every test
 * reservation is settled at 0 credits and the paid-call switch is restored.
 * Requires: `npx supabase start` + `.env.local`. Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

type Budget = {
  enabled: boolean;
  cap: number;
  used_this_month: number;
  left: number;
  settlement_reserved: number;
  mode: string;
  profile: string;
  today_left: number;
  week_left: number;
  days_left: number;
};
type Reserve = { ok: boolean; reason?: string; reservation_id?: number };

let admin: SupabaseClient<Database>;
let wasEnabled = false;
const reservations: number[] = [];

const budget = async () => {
  const { data, error } = await admin.rpc("odds_budget_status");
  if (error) throw error;
  return (data as { budget: Budget }).budget;
};

beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Missing Supabase env (.env.local)");
  admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });
  wasEnabled = (await budget()).enabled;
  const { error } = await admin.rpc("odds_set_paid_calls", { p_enabled: true });
  if (error) throw error;
});

afterAll(async () => {
  await Promise.all(
    reservations.map((id) =>
      admin.rpc("odds_budget_settle", { p_reservation_id: id, p_credits_used: 0 }),
    ),
  );
  await admin.rpc("odds_set_paid_calls", { p_enabled: wasEnabled });
});

it("concurrent reservations never reserve more than the budget has left", async () => {
  const initial = await budget();
  const before = initial.left;
  // Status exposes app_settings and odds_budget()'s provider, settlement and pacing limits.
  // Non-score calls must leave both the monthly and daily settlement pools intact.
  const monthlyAvailable = Math.max(0, Math.min(before, initial.cap - initial.used_this_month)
    - initial.settlement_reserved);
  const dailyReserve = Math.max(2, Math.ceil(initial.settlement_reserved / initial.days_left));
  const available = initial.profile === "beta" ? 0 : initial.mode === "auto"
    ? Math.max(0, Math.min(monthlyAvailable, initial.today_left - dailyReserve, initial.week_left - dailyReserve))
    : monthlyAvailable;
  const cost = 10; // Maximum valid estimate; avoid thousands of HTTP requests on larger plans.
  const expectedGrants = Math.floor(available / cost);
  const attempts = expectedGrants + 5; // race more callers than the current policy can serve

  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      admin.rpc("odds_budget_reserve", { p_sport_key: "it_budget_race", p_endpoint: "race", p_cost: cost }),
    ),
  );
  const granted = results.map((r) => r.data as Reserve | null).filter((r): r is Reserve => !!r?.ok);
  reservations.push(...granted.map((r) => r.reservation_id!));

  expect(results.map((r) => r.error).filter(Boolean)).toEqual([]);
  const refused = results.map((r) => r.data as Reserve).filter((r) => !r.ok);
  expect(refused).toHaveLength(attempts - expectedGrants);
  for (const result of refused) {
    expect(["BUDGET_EXHAUSTED", "SETTLEMENT_RESERVED", "PACING_LIMIT", "PROFILE_BLOCKED"]).toContain(result.reason);
  }
  expect(granted.length * cost).toBeLessThanOrEqual(available);
  expect(granted.length).toBe(expectedGrants);
  expect((await budget()).left).toBe(before - granted.length * cost);
});
