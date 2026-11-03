import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cache } from "react";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";

/** Cookie-less anon client for public data (share previews, OG images). */
function publicClient() {
  return createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type PreviewEvent = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
};

/** Public tournament preview by invite code (deduped per request). Null if not found. */
export const getTournamentPreview = cache(async (code: string) => {
  const { data, error } = await publicClient()
    .rpc("get_tournament_preview", { p_code: code })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, events: (data.events ?? []) as PreviewEvent[] };
});
