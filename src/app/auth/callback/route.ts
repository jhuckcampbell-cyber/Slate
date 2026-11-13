import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";

/** Magic-link / email-change landing. Handles both PKCE `code` and `token_hash` styles. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const supabase = await createClient();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const type = rawType && ["signup", "invite", "magiclink", "recovery", "email_change", "email"].includes(rawType)
    ? rawType as EmailOtpType : null;

  let error: unknown = null;
  try {
  if (searchParams.has("error")) {
    error = new Error("provider refused");
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    error = new Error("missing token");
  }
  } catch { error = new Error("verification failed"); }

  const dest = new URL(error ? "/account" : next, origin);
  if (error) dest.searchParams.set("auth_error", "1");
  return NextResponse.redirect(dest);
}
