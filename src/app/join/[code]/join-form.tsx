"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Stamp } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { ensureSession } from "@/lib/auth/ensure-session";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";

/**
 * The whole onboarding: type a name, tap once. Guest session is created in the browser
 * (so Supabase's per-IP anonymous sign-in limits apply to the user, not our server).
 *
 * The input is UNCONTROLLED so text typed before hydration survives on slow phones. If the
 * form is submitted before hydration, the native GET reloads with ?name=… and we prefill it.
 */
export function JoinForm({ code, defaultName }: { code: string; defaultName: string }) {
  const router = useRouter();
  const turnstile = useRef<TurnstileHandle>(null);
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setPending(true);
    try {
      await ensureSession(name, () => {
        if (!turnstile.current) throw new Error("CAPTCHA_FAILED");
        return turnstile.current.getToken();
      });
      const { error } = await createClient().rpc("join_tournament", { p_code: code });
      if (error) throw error;
      setJoined(true);
      toast.success("You joined the tournament.");
      router.replace(`/t/${code}`);
    } catch (err) {
      toast.error(friendlyError(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending}>
      <Turnstile ref={turnstile} />
      {joined && <div role="status" className="py-2 text-center"><Stamp className="stamp-in" tone="hype">You?re in</Stamp></div>}
      <Input
        name="name"
        aria-label="Your name"
        placeholder="Your name"
        autoComplete="nickname"
        autoFocus={!defaultName}
        required
        maxLength={24}
        defaultValue={defaultName}
        className="h-12 text-base"
      />
      <Button type="submit" className="h-14 w-full text-base font-semibold" disabled={pending}>
        {pending && <Loader2 className="motion-safe:animate-spin" />}
        {joined ? "Joined" : pending ? "Joining?" : "Join tournament"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No signup needed. Play money only. Save your account anytime.
      </p>
    </form>
  );
}
