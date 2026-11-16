import { cn } from "@/lib/utils";
import { stub, StubTear } from "@/components/brand";

function Bone({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded bg-surface-2", className)} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main aria-busy="true" aria-label="Loading page" className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 pt-8 pb-10">
      <div aria-hidden="true" className="space-y-4">
        <Bone className="h-5 w-24" /><Bone className="h-9 w-3/4" /><Bone className="h-4 w-1/2" />
        {children}
      </div>
    </main>
  );
}

function StubRows() {
  return <div className="space-y-2">{[0, 1, 2].map((row) => (
    <div key={row} className={stub("default")}>
      <div className="flex flex-1 items-center gap-3 p-3">
        <Bone className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Bone className="h-4 w-3/4" /><Bone className="h-3 w-1/2" /></div>
      </div>
      <StubTear><Bone className="h-6 w-12" /></StubTear>
    </div>
  ))}</div>;
}

/** Tournament list / player ticket rows. */
export function StubListSkeleton() {
  return <Shell><div className="mt-8"><StubRows /></div></Shell>;
}

/** Games: matchup heading, two teams and three game-line columns. */
export function BoardSkeleton() {
  return <Shell>
    <Bone className="mt-6 h-11 w-full rounded-full" />
    {[0, 1].map((game) => <div key={game} className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <Bone className="h-3 w-1/3" />
      {[0, 1].map((team) => <div key={team} className="flex items-center gap-3">
        <Bone className="h-6 w-1/3" />
        <div className="grid flex-1 grid-cols-3 gap-2">{[0, 1, 2].map((line) => <Bone key={line} className="h-13 rounded-lg" />)}</div>
      </div>)}
    </div>)}
  </Shell>;
}

/** Lobby: lock countdown, bankroll/rules card, then squad tickets. */
export function LobbySkeleton() {
  return <Shell>
    <Bone className="mt-6 h-16 w-full rounded-2xl" />
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <Bone className="h-8 w-1/2" /><Bone className="h-4 w-full" /><Bone className="h-4 w-3/4" />
    </div>
    <Bone className="h-11 w-full rounded-full" />
    <div className="pt-4"><Bone className="mb-3 h-3 w-20" /><StubRows /></div>
  </Shell>;
}

/** Static-shell fallback for per-user pages. */
export function PageSkeleton() {
  return <StubListSkeleton />;
}

export default PageSkeleton;
