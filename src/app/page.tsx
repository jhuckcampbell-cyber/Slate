import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { AppBar } from "@/components/brand";
import { InstallHint } from "@/components/install-hint";
import { InviteTeaser } from "@/components/invite-teaser";
import { MyTournamentsList, PastTournaments } from "@/components/my-tournaments-list";
import { SettingsButton } from "@/components/settings/settings-button";
import { JoinCodeForm } from "@/components/tournament/join-code-form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Sections ease in one after another (~60ms apart), only when motion is welcome. */
const enter = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(env(safe-area-inset-top),12px)] pb-10">
      <AppBar wiggle>
        <SettingsButton />
      </AppBar>

      <section className={cn("mt-10", enter)}>
        <h1 className="font-display text-[2.75rem]/[0.98] font-extrabold tracking-tight text-balance">
          Bet your friends,{" "}
          <span className="relative inline-block whitespace-nowrap">
            not your wallet.
            <svg
              aria-hidden
              viewBox="0 0 200 14"
              preserveAspectRatio="none"
              className="swash pointer-events-none absolute -bottom-[0.14em] left-[-2%] h-[0.24em] w-[100%]"
            >
              <path
                pathLength={1}
                d="M3 10.5C46 4.5 104 2.6 197 6.8"
                fill="none"
                stroke="var(--hype)"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </h1>
        <p className="mt-5 text-base/relaxed text-muted-foreground">
          A free game for watching sports with friends. Fake money, real odds, one leaderboard.
        </p>
        <p className="mt-1.5 text-sm font-medium">No real money, ever.</p>
      </section>

      <section className={cn("mt-7 space-y-5", enter, "motion-safe:delay-75")}>
        <Link href="/create" className={cn(buttonVariants(), "h-14 w-full rounded-2xl text-base font-semibold")}>
          <Plus /> Start a tournament
        </Link>
        <div className="ink-shadow rounded-2xl border-2 border-foreground bg-sky p-4">
          <h2 className="font-display text-xl/tight font-extrabold tracking-tight">Join a friend&apos;s tournament</h2>
          <p className="mb-2 text-sm text-muted-foreground">Your friend saved you a spot. Enter their invite code.</p>
          <JoinCodeForm />
        </div>
      </section>

      {/* Returning players: straight back into what's in play (streams in; nothing for first-time visitors). */}
      <Suspense fallback={null}>
        <MyTournamentsList className={cn("mt-9", enter, "motion-safe:delay-150")} />
      </Suspense>

      {/* The bottom of the page: your history, then the squad teaser. */}
      <div className={cn("mt-auto space-y-4 pt-10", enter, "motion-safe:delay-200")}>
        <Suspense fallback={null}>
          <PastTournaments />
        </Suspense>
        <InviteTeaser />
        <InstallHint />
      </div>
    </main>
  );
}
