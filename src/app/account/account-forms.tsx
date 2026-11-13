"use client";

import { Loader2, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { guestCaptchaToken } from "@/lib/auth/captcha";
import { deleteAccount } from "./actions";

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
  const [pending, setPending] = useState<null | "name" | "email" | "signout" | "google">(null);
  const [returning, setReturning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const captcha = useRef<TurnstileHandle>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const callback = () => `${window.location.origin}/auth/callback`;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setPending("name");
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setPending(null); return toast.error("Sign in again to save your name."); }
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
    // Link email to the existing guest ID to keep tournaments.
    // Returning players sign in to their existing account.
    try {
    const captchaToken = await guestCaptchaToken(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, () => captcha.current!.getToken());
    const { error } =
      state === "guest" && !returning
        ? await supabase.auth.updateUser({ email: address }, { emailRedirectTo: callback() })
        : await supabase.auth.signInWithOtp({
            email: address,
            options: { emailRedirectTo: callback(), shouldCreateUser: false, captchaToken },
          });
    setPending(null);
    if (error) return toast.error(friendlyError(error));
    setSentTo(address);
    } catch { setPending(null); toast.error("We couldn't check that you're a person. Please try again."); }
  }

  async function google() {
    setPending("google");
    try {
      const auth = createClient().auth;
      const result = state === "guest" && !returning
        ? await auth.linkIdentity({ provider: "google", options: { redirectTo: callback() } })
        : await auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
      if (result.error) toast.error("Google sign-in couldn't start. Try email instead.");
    } catch { toast.error("Google sign-in couldn't start. Try email instead."); }
    setPending(null);
  }

  async function signOut() {
    setPending("signout");
    const { error } = await createClient().auth.signOut();
    if (error) { setPending(null); return toast.error("We couldn't sign you out. Please try again."); }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-8">
      <Turnstile ref={captcha} />
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
        <p className="flex gap-2 rounded-xl bg-brand/10 p-4 text-sm">
          <MailCheck className="size-5 shrink-0 text-brand" />
          Check {sentTo} for a link to {state === "guest" && !returning ? "save your account" : "sign in"}.
        </p>
      ) : (
        <form onSubmit={sendEmail} className="space-y-2">
          <Label htmlFor="email">
            {state === "guest" && !returning ? "Save your account" : "Sign in with email"}
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
      {state !== "member" && (
        <div className="space-y-3">
          <Button variant="outline" className="min-h-12 w-full" disabled={pending !== null} onClick={google}>
            {state === "guest" && !returning ? "Save with Google" : "Sign in with Google"}
          </Button>
          {state === "guest" && <>
            <Button variant="outline" className="min-h-12 w-full" disabled={pending !== null} onClick={() => { setReturning(!returning); setSentTo(null); }}>
              {returning ? "Save this guest account instead" : "Sign in to an existing account"}
            </Button>
            {returning && <p className="text-sm text-muted-foreground">Signing in switches accounts. This guest&apos;s tournaments stay with this guest and won&apos;t move to your existing account. Save this guest first if you want to keep access.</p>}
          </>}
        </div>
      )}
      {state !== "signed_out" && <div className="space-y-3">
        {state === "guest" && <Button variant="outline" className="min-h-12 w-full" disabled={pending !== null} onClick={signOut}>Sign out</Button>}
        <p className="text-sm text-muted-foreground">Deleting your account removes your sign-in and name. Your bets and past standings stay as Deleted player.</p>
        {confirmDelete ? <>
          <p className="text-sm">This cannot be undone. Delete your account?</p>
          <Button variant="destructive" className="min-h-12 w-full" disabled={deleting || pending !== null} onClick={() => startDelete(async () => {
            const result = await deleteAccount();
            if (result.error) { toast.error(result.error); return; }
            router.replace("/"); router.refresh();
          })}>Delete my account permanently</Button>
          <Button variant="outline" className="min-h-12 w-full" disabled={deleting} onClick={() => setConfirmDelete(false)}>Keep my account</Button>
        </> : <Button variant="outline" className="min-h-12 w-full text-destructive" onClick={() => setConfirmDelete(true)}>Delete account</Button>}
      </div>}
    </div>
  );
}
