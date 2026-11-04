// Closed-beta numbers: `npm run metrics`. The feasibility test is repeat_rate: the share of
// finished tournaments whose group (2+ of the same players) started another one.
// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (.env.local; point --env-file at prod for real numbers).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  process.exit(1);
}
const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const { data, error } = await admin.rpc("beta_metrics");
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.table(data);
console.log(
  `Repeat rate: ${Math.round(Number(data.repeat_rate) * 100)}% of ${data.tournaments_finished} finished tournaments ` +
    `led to the same group playing again.`,
);
