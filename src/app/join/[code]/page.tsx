import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Lock, Users, Wallet } from "lucide-react";
import { LockCountdown } from "@/components/tournament/lock-countdown";
import { normalizeCode } from "@/lib/core/codes";
import { formatCents, formatKickoff, matchupLabel, sportEmoji } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getTournamentPreview } from "@/lib/supabase/public";
import { getViewer } from "@/lib/supabase/queries";
import { JoinForm } from "./join-form";

export async function generateMetadata({ params }: PageProps<"/join/[code]">): Promise<Metadata> {
  const code = normalizeCode((await params).code);
  const t = await getTournamentPreview(code);
  if (!t) return { title: "Tournament not found" };
  const description = `${t.host_name} invited you: ${formatCents(t.starting_bankroll_cents)} play money, picks hidden till kickoff. ${t.participant_count} in so far.`;
  return {
    title: `Join ${t.title}`,
    description,
    openGraph: { title: `${sportEmoji(t.sport_key)} ${t.title}`, description, type: "website" },
    twitter: { card: "summary_large_image", title: t.title, description },
  };
}


export default function JoinPage(props: PageProps<"/join/[code]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Join {...props} />
    </Suspense>
  );
}

async function Join({ params, searchParams }: PageProps<"/join/[code]">) {
  await connection(); // per-request: auth cookies + clock (Cache Components)
  const raw = (await params).code;
  const { name: typedName, removed } = await searchParams; // name: pre-hydration native submit fallback
  const code = normalizeCode(raw);
  if (code !== raw) redirect(`/join/${code}`);

  const t = await getTournamentPreview(code);
  if (!t) notFound();

  const viewer = await getViewer();
  if (viewer) {
    // RLS only returns the tournament if the viewer is already in it.
    const supabase = await createClient();
    const { data: mine } = await supabase.from("tournaments").select("id").eq("code", code).maybeSingle();
    if (mine) redirect(`/t/${code}`);
  }

  const locked = t.is_locked;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-10 pb-8">
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{t.host_name}</strong> invited you to
      </p>
      <h1 className="mt-1 text-3xl font-bold text-balance">
        {sportEmoji(t.sport_key)} {t.title}
      </h1>

      <ul className="mt-5 space-y-1.5">
        {t.events.map((e) => (
          <li key={e.id} className="flex justify-between gap-3 text-sm">
            <span className="font-medium">{matchupLabel(e)}</span>
            <span className="shrink-0 text-muted-foreground">{formatKickoff(e.commence_time)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 grid grid-cols-3 gap-2 text-center text-sm">
        <Stat icon={<Wallet className="size-4" />} label="Bankroll" value={formatCents(t.starting_bankroll_cents)} />
        <Stat icon={<Users className="size-4" />} label="Players" value={String(t.participant_count)} />
        <Stat icon={<Lock className="size-4" />} label="Picks" value="Blind" />
      </div>

      <div className="mt-6 rounded-xl border border-border p-3 text-center text-sm">
        <LockCountdown lockTime={t.lock_time} isLocked={t.is_locked} />
      </div>

      <div className="mt-auto pt-8">
        {removed === "1" ? (
          // Sent here by the lobby when the host removes you (join_tournament would refuse anyway).
          <p className="rounded-xl bg-muted p-4 text-center text-sm">The host removed you from this tournament.</p>
        ) : locked ? (
          <p className="rounded-xl bg-muted p-4 text-center text-sm">
            Picks are locked. This one already kicked off. Ask {t.host_name} to start the next one!
          </p>
        ) : (
          <JoinForm
            code={code}
            defaultName={(typeof typedName === "string" ? typedName : null) ?? viewer?.profile?.display_name ?? ""}
          />
        )}
      </div>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-border">
      <div className="flex justify-center text-emerald-400">{icon}</div>
      <div className="mt-1 font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
