import Link from "next/link";
import { Suspense } from "react";
import { EyeOff, LockOpen, Plus, Trophy, Zap } from "lucide-react";
import { AppBar, DisplayTitle, Eyebrow } from "@/components/brand";
import { InstallHint } from "@/components/install-hint";
import { MyTournamentsList } from "@/components/my-tournaments-list";
import { JoinCodeForm } from "@/components/tournament/join-code-form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: Zap, title: "In by text", body: "No signup, no download. One tap from the group chat." },
  { icon: EyeOff, title: "Blind picks", body: "Slips stay hidden until kickoff. No copycats." },
  { icon: Trophy, title: "Live sweat", body: "Real odds, one leaderboard, endless trash talk." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(env(safe-area-inset-top),12px)] pb-10">
      <AppBar />

      {/* Returning players: straight back into their tournaments (streams in; nothing for first-time visitors). */}
      <Suspense fallback={null}>
        <MyTournamentsList className="mt-6" />
      </Suspense>

      <section className="mt-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand ring-1 ring-brand/30">
          Play money · Real odds · Free
        </span>
        <DisplayTitle className="mt-4 text-[3.4rem]/[0.92]">
          Bet your <span className="text-brand">friends</span>.<br />
          Not your wallet.
        </DisplayTitle>
        <p className="mt-4 text-base text-muted-foreground">
          Spin up a tournament for tonight&apos;s game, drop the link in the group chat, and sweat it out together.
        </p>
      </section>

      <RevealPreview />

      <ul className="mt-6 grid grid-cols-3 gap-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-2xl bg-card p-3 ring-1 ring-border">
            <Icon className="size-5 text-brand" />
            <p className="mt-2 font-display text-lg leading-none font-bold uppercase">{title}</p>
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>

      <div className="mt-8 space-y-4">
        <Link href="/create" className={cn(buttonVariants(), "h-14 w-full text-base font-semibold")}>
          <Plus /> Start a tournament
        </Link>
        <div className="space-y-2">
          <Eyebrow className="text-center">Got a code?</Eyebrow>
          <JoinCodeForm />
        </div>
      </div>

      <InstallHint className="mt-8" />
    </main>
  );
}

/** Decorative: what the squad sees at kickoff. Static sample data, hidden from screen readers. */
function RevealPreview() {
  const backers = ["Mike", "Sam", "Jo", "Dee", "Ty", "Al"];
  return (
    <div aria-hidden className="relative mt-8">
      <div className="absolute inset-x-6 -bottom-2 h-full rotate-2 rounded-2xl bg-surface-2/70 ring-1 ring-border" />
      <div className="relative rounded-2xl bg-card p-4 shadow-2xl shadow-black/40 ring-1 ring-border">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-display text-lg font-bold text-hype uppercase">
            <LockOpen className="size-4" /> Picks are in
          </span>
          <span className="text-xs text-muted-foreground">7 players · $560 in play</span>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">BUF @ KC · Spread</span>
          <span className="font-display text-xl font-bold">6 of 7 on KC −3</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="w-[86%] bg-chart-1" />
          <div className="w-[14%] bg-chart-2" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {backers.map((n) => (
            <span key={n} className="rounded-full bg-muted px-2 py-0.5 text-xs ring-1 ring-border">
              {n}
            </span>
          ))}
          <span className="rounded-full bg-chart-2/15 px-2 py-0.5 text-xs text-chart-2 ring-1 ring-chart-2/40">
            You · BUF +3
          </span>
        </div>
      </div>
    </div>
  );
}
