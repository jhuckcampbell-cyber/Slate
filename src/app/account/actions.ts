"use server";

import "server-only";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function deleteAccount(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: "Sign in again before deleting your account." };
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return { error: "Account deletion is unavailable. Please try again later." };
  // Narrow, local RPC type until the caller regenerates database types after migration 0038.
  const rpc = supabase.rpc.bind(supabase) as unknown as
    (name: "delete_my_account") => Promise<{ error: { message: string } | null }>;
  const { error: prepareError } = await rpc("delete_my_account");
  if (prepareError) return { error: prepareError.message.includes("ACCOUNT_HOSTS_ACTIVE_TOURNAMENT")
    ? "Delete or hand over your open or locked tournaments before deleting your account."
    : "We couldn't delete your account. Please try again." };
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
  if (deleteError) return { error: "We couldn't finish deleting your account. Please try again." };
  await supabase.auth.signOut();
  return {};
}
