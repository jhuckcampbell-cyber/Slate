// Odds API operator commands. Never prints the API key (it lives only in the Edge Function env).
//   npm run odds -- status     credits used/left this month, switch state, last calls
//   npm run odds -- dry-run    what the next sync WOULD call and what it would cost (no API calls)
//   npm run odds -- sync       run one sync now (paid calls still go through the DB budget)
//   npm run odds -- enable     allow paid calls (still capped)
//   npm run odds -- disable    block every paid call immediately
// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY from .env.local (point --env-file at
// another file for production) and ODDS_SYNC_SECRET (defaults to the local dev secret).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  process.exit(1);
}
const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const cmd = process.argv[2] ?? "status";

const rpc = async (name, args) => {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
};

const sync = async (body) => {
  const res = await fetch(`${url}/functions/v1/odds-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sync-secret": process.env.ODDS_SYNC_SECRET ?? "local-dev-sync-secret",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const printBudget = (b) =>
  console.log(
    `Paid calls: ${b.enabled ? "ON" : "OFF"} · used ${b.used_this_month}/${b.cap} this month · ` +
      `${b.left} left · provider says ${b.provider_remaining ?? "?"} of ${b.quota} remaining`,
  );

switch (cmd) {
  case "status": {
    const s = await rpc("odds_budget_status");
    printBudget(s.budget);
    console.log("Refresh tiers:", JSON.stringify(s.refresh_tiers));
    console.table(s.recent_calls);
    break;
  }
  case "dry-run":
    console.log(JSON.stringify(await sync({ dry_run: true }), null, 2));
    break;
  case "sync":
    console.log(JSON.stringify(await sync({}), null, 2));
    break;
  case "enable":
  case "disable":
    printBudget(await rpc("odds_set_paid_calls", { p_enabled: cmd === "enable" }));
    break;
  default:
    console.error(`Unknown command "${cmd}". Use status | dry-run | sync | enable | disable.`);
    process.exit(1);
}
