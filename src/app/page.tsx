import Link from "next/link";
import { EyeOff, Plus, Trophy, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { JoinCodeForm } from "@/components/tournament/join-code-form";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-16 pb-10">
      <div className="flex-1">
        <p className="text-sm font-semibold tracking-widest text-emerald-400 uppercase">
          SquadBets
        </p>
        <h1 className="mt-3 text-4xl leading-tight font-bold text-balance">
          Bet against your friends. Not your wallet.
        </h1>
        <p className="mt-4 text-muted-foreground">
          Spin up a play-money tournament for tonight&apos;s game, text the link to the group chat,
          and sweat it out together.
        </p>

        <ul className="mt-8 space-y-4 text-sm">
          <li className="flex gap-3">
            <Zap className="size-5 shrink-0 text-emerald-400" />
            <span>
              <strong>Join in seconds.</strong> No signup, no download, no real money.
            </span>
          </li>
          <li className="flex gap-3">
            <EyeOff className="size-5 shrink-0 text-emerald-400" />
            <span>
              <strong>Blind picks.</strong> Nobody sees your slip until kickoff. No copycats.
            </span>
          </li>
          <li className="flex gap-3">
            <Trophy className="size-5 shrink-0 text-emerald-400" />
            <span>
              <strong>Live sweat.</strong> Real odds, live win probability, one leaderboard.
            </span>
          </li>
        </ul>
      </div>

      <div className="mt-10 space-y-4">
        <Link href="/create" className={cn(buttonVariants(), "h-12 w-full text-base")}>
          <Plus /> Start a tournament
        </Link>
        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">Got a code?</p>
          <JoinCodeForm />
        </div>
      </div>
    </main>
  );
}
