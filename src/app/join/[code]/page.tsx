import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EyeOff, Users, Wallet } from "lucide-react";
import { AppBar, DisplayTitle, Eyebrow } from "@/components/brand";
import { LockCountdown } from "@/components/tournament/lock-countdown";
import { normalizeCode } from "@/lib/core/codes";
import { formatCents, sportEmoji, sportLabel } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
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
    openGraph: { title: `${t.host_name} invited you to ${t.title}`, description, type: "website" },
    twitter: { card: "summary_large_image", title: `${t.host_name} invited you to ${t.title}`, description },
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
  let wasRemoved = removed === "1";
  if (viewer) {
    // RLS only returns the tournament if the viewer is already in it.
    const supabase = await createClient();
    const [{ data: mine }, { data: removedFrom }] = await Promise.all([
      supabase.from("tournaments").select("id").eq("code", code).maybeSingle(),
      supabase.rpc("removed_from", { p_code: code }),
    ]);
    if (mine) redirect(`/t/${code}`);
    // However they got here (the live signal, a refresh racing it, an old text), tell a removed player why.
    wasRemoved ||= removedFrom === true;
  }

  const locked = t.is_locked;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(env(safe-area-inset-top),12px)] pb-8">
      <AppBar />

      <div className="mt-8 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-hype font-display text-lg font-bold text-hype-foreground">
          {t.host_name.slice(0, 1).toUpperCase()}
        </span>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{t.host_name}</strong> invited you to
        </p>
      </div>
      <Eyebrow className="mt-5">
        {sportEmoji(t.sport_key)} {sportLabel(t.sport_key)} · {t.events.length} {t.events.length === 1 ? "game" : "games"}
      </Eyebrow>
      <DisplayTitle className="mt-1.5">{t.title}</DisplayTitle>

      <ul className="mt-5 space-y-2">
        {t.events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border">
            <span className="min-w-0 font-medium">
              <span className="block truncate">{e.away_team}</span>
              <span className="block truncate text-muted-foreground">@ {e.home_team}</span>
            </span>
            <span className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium">
              <LocalTime iso={e.commence_time} />
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat icon={<Wallet className="size-4" />} label="Bankroll" value={formatCents(t.starting_bankroll_cents)} />
        <Stat icon={<Users className="size-4" />} label="Players" value={String(t.participant_count)} />
        <Stat icon={<EyeOff className="size-4" />} label="Picks" value="Blind" />
      </div>

      <div className="mt-4 flex justify-center">
        <span className="rounded-full bg-card px-4 py-2 text-sm ring-1 ring-border">
          <LockCountdown lockTime={t.lock_time} serverNow={t.server_now ?? undefined} isLocked={t.is_locked} />
        </span>
      </div>

      <div className="mt-auto pt-8">
        {wasRemoved ? (
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
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <div className="flex justify-center text-brand">{icon}</div>
      <div className="num mt-1 text-2xl leading-none font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
