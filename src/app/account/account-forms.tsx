"use client";

import { Loader2, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";

type State = "signed_out" | "guest" | "member";

export function AccountForms({
  state,
  displayName,
  email,
}: {
  state: State;
  displayName: string;
  email: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [emailInput, setEmailInput] = useState("");
  const [pending, setPending] = useState<null | "name" | "email" | "signout">(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const callback = () => `${window.location.origin}/auth/callback?next=/account`;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setPending("name");
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name.trim() })
      .eq("id", data.session!.user.id);
    setPending(null);
    if (error) return toast.error(friendlyError(error));
    toast.success("Name updated");
    router.refresh();
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    const address = emailInput.trim();
    if (!address) return;
    setPending("email");
    const supabase = createClient();
    // Guest → link email to the existing anonymous user (keeps all tournaments).
    // Signed out → magic-link sign-in to an existing account.
    const { error } =
      state === "guest"
        ? await supabase.auth.updateUser({ email: address }, { emailRedirectTo: callback() })
        : await supabase.auth.signInWithOtp({
            email: address,
            options: { emailRedirectTo: callback(), shouldCreateUser: true },
          });
    setPending(null);
    if (error) return toast.error(friendlyError(error));
    setSentTo(address);
  }

  async function signOut() {
    setPending("signout");
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-8">
      {state !== "signed_out" && (
        <form onSubmit={saveName} className="space-y-2">
          <Label htmlFor="name">Display name</Label>
          <div className="flex gap-2">
            <Input
              id="name"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 text-base"
            />
            <Button
              type="submit"
              variant="secondary"
              className="h-12"
              disabled={pending !== null || !name.trim() || name.trim() === displayName}
            >
              {pending === "name" ? <Loader2 className="animate-spin" /> : "Save"}
            </Button>
          </div>
        </form>
      )}

      {state === "member" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <strong className="text-foreground">{email}</strong>
          </p>
          <Button variant="outline" className="h-12 w-full" onClick={signOut} disabled={pending !== null}>
            Sign out
          </Button>
        </div>
      ) : sentTo ? (
        <p className="flex gap-2 rounded-xl bg-emerald-500/10 p-4 text-sm">
          <MailCheck className="size-5 shrink-0 text-emerald-400" />
          Check {sentTo} for a link to {state === "guest" ? "save your account" : "sign in"}.
        </p>
      ) : (
        <form onSubmit={sendEmail} className="space-y-2">
          <Label htmlFor="email">
            {state === "guest" ? "Save your account" : "Sign in with email"}
          </Label>
          <p className="text-xs text-muted-foreground">
            {state === "guest"
              ? "You're playing as a guest. Add an email to keep your tournaments on any device."
              : "We'll email you a magic link. No password."}
          </p>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="h-12 text-base"
          />
          <Button type="submit" className="h-12 w-full" disabled={pending !== null || !emailInput.trim()}>
            {pending === "email" && <Loader2 className="animate-spin" />}
            Send link
          </Button>
        </form>
      )}
    </div>
  );
}
