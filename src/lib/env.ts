/**
 * Public (browser-safe) env. Accessed with literal `process.env.NEXT_PUBLIC_*` so Next inlines them.
 * Server-only secrets (SUPABASE_SECRET_KEY, ODDS_API_KEY) must never be read from this module.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing env var ${name}. Copy .env.example to .env.local.`);
  return value;
}

export const publicEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  },
};
