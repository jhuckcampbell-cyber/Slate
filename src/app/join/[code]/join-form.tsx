"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setPending(true);
    try {
      await ensureSession(name);
      const { error } = await createClient().rpc("join_tournament", { p_code: code });
      if (error) throw error;
      router.replace(`/t/${code}`);
    } catch (err) {
      toast.error(friendlyError(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
      <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        I&apos;m in
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No signup needed. Play money only. Save your account anytime.
      </p>
    </form>
  );
}
