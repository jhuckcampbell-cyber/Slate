import Link from "next/link";
import { Suspense } from "react";
import { EyeOff, MessageCircle, Plus, Trophy } from "lucide-react";
import { AppBar, Eyebrow } from "@/components/brand";
import { InstallHint } from "@/components/install-hint";
import { MyTournamentsList } from "@/components/my-tournaments-list";
import { SettingsButton } from "@/components/settings/settings-button";
import { JoinCodeForm } from "@/components/tournament/join-code-form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: MessageCircle, title: "Text the link", body: "Pick tonight's game and drop the invite in the group chat. Friends join in one tap." },
  { icon: EyeOff, title: "Pick in secret", body: "Everyone gets $100 of fake money to bet. Picks stay hidden until kickoff." },
  { icon: Trophy, title: "Sweat it together", body: "Watch the score and the leaderboard move live. Most money at the end wins." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(env(safe-area-inset-top),12px)] pb-10">
      <AppBar>
        <SettingsButton />
      </AppBar>

      {/* Returning players: straight back into their tournaments (streams in; nothing for first-time visitors). */}
      <Suspense fallback={null}>
        <MyTournamentsList className="mt-6" />
      </Suspense>

      <section className="mt-8">
        <h1 className="font-display text-[2.6rem]/[1.02] font-extrabold tracking-tight text-balance">
          Bet your friends, <span className="bg-gradient-to-r from-brand to-hype bg-clip-text text-transparent">not your wallet.</span>
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          A free game for watching sports with friends. Fake money, real odds, one leaderboard.
        </p>
      </section>

      <div className="mt-6 space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border">
        <Link href="/create" className={cn(buttonVariants(), "h-14 w-full rounded-2xl text-base font-semibold")}>
          <Plus /> Start a tournament
        </Link>
        <div className="space-y-2">
          <Eyebrow className="text-center">Got a code from a friend?</Eyebrow>
          <JoinCodeForm />
        </div>
      </div>

      <section className="mt-8" aria-labelledby="how-it-works">
        <Eyebrow>
          <span id="how-it-works">How it works</span>
        </Eyebrow>
        <ol className="mt-3 space-y-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex gap-3">
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-brand ring-1 ring-brand/25">
                <Icon className="size-5" />
                <span className="num absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-hype text-[11px] font-bold text-hype-foreground">
                  {i + 1}
                </span>
              </span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm leading-snug text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">No real money, ever. Nothing to buy, nothing to deposit.</p>
      </section>

      <InstallHint className="mt-8" />
    </main>
  );
}
