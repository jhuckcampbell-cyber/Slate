import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/queries";
import { AccountForms } from "./account-forms";

export const metadata: Metadata = { title: "Account" };


export default function AccountPage(props: PageProps<"/account">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Account {...props} />
    </Suspense>
  );
}

async function Account({ searchParams }: PageProps<"/account">) {
  await connection(); // per-request: auth cookies + clock (Cache Components)
  const authError = (await searchParams).auth_error === "1";
  const viewer = await getViewer();

  let email: string | null = null;
  let tournaments: { code: string; title: string }[] = [];
  if (viewer) {
    const supabase = await createClient();
    const [{ data: userData }, { data: ts }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("tournaments").select("code, title, lock_time").order("lock_time", { ascending: false }).limit(20),
    ]);
    email = userData.user?.email ?? null;
    tournaments = ts ?? [];
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-8 pb-10">
      <h1 className="text-2xl font-bold">Account</h1>
      {authError && (
        <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          We couldn&apos;t sign you in. That link may have expired or been used already. Try again below.
        </p>
      )}

      <AccountForms
        state={!viewer ? "signed_out" : viewer.profile?.is_guest ? "guest" : "member"}
        displayName={viewer?.profile?.display_name ?? ""}
        email={email}
      />

      {tournaments.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Your tournaments
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {tournaments.map((t) => (
              <li key={t.code}>
                <Link href={`/t/${t.code}`} className="flex min-h-12 justify-between p-3 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <span className="font-mono text-muted-foreground">{t.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
