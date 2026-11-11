"use client";

import { createClient } from "@/lib/supabase/client";
import { guestCaptchaToken, type CaptchaTokenProvider } from "./captcha";

/**
 * Frictionless auth for join/create: reuse the existing session, or create an anonymous guest
 * (claimable later from /account). Updates the display name if one is provided.
 */
export async function ensureSession(displayName?: string, getCaptchaToken?: CaptchaTokenProvider): Promise<string> {
  const supabase = createClient();
  const name = displayName?.trim().slice(0, 24) || undefined;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    const captchaToken = await guestCaptchaToken(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, getCaptchaToken);
    const { data, error } = await supabase.auth.signInAnonymously({
      options: { data: name ? { display_name: name } : {}, ...(captchaToken ? { captchaToken } : {}) },
    });
    if (error?.code === "captcha_failed") throw new Error("CAPTCHA_FAILED");
    if (error || !data.user) throw error ?? new Error("Could not start a guest session.");
    return data.user.id;
  }

  if (name) {
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", session.user.id);
    if (error) throw error;
  }
  return session.user.id;
}
