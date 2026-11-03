import "server-only";
import { createClient } from "./server";

/** Current user id + profile on the server (null when signed out). */
export async function getViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, is_guest")
    .eq("id", userId)
    .maybeSingle();

  return { userId, profile };
}
