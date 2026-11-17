"use client";

import { ChevronDown, CircleCheck, Crown, Loader2, Lock, UserMinus } from "lucide-react";
import { StubTear, stub } from "@/components/brand";
import { LocalTime } from "@/components/local-time";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type SquadMember = {
  user_id: string;
  display_name: string;
  is_host: boolean;
  has_submitted: boolean;
};

type Props = {
  tournamentId: string;
  members: SquadMember[];
  viewerUserId: string;
  /** Pre-lock: show who's submitted ("5/8 slips in") without revealing what. */
  showStatus: boolean;
  /** Host, pre-lock. */
  canRemove: boolean;
  /** Lock time: the heading says when everyone's slips are revealed. */
  revealIso?: string;
  /**
   * Lobby (pre-lock): the squad folds into one row of avatars (mint = picks in, yellow = still thinking) with the
   * count; tap it for the full list. `aside` sits at the row's right end (the host's "Host" button).
   */
  collapsible?: boolean;
  aside?: React.ReactNode;
  children?: React.ReactNode;
};

export function SquadList({
  tournamentId,
  members,
  viewerUserId,
  showStatus,
  canRemove,
  revealIso,
  collapsible = false,
  aside,
  children,
}: Props) {
  const router = useRouter();
  const [removing, setRemoving] = useState<SquadMember | null>(null);
  const [pending, setPending] = useState(false);
  const submitted = members.filter((m) => m.has_submitted).length;
  const fresh = useFreshlySubmitted(members);

  async function remove() {
    if (!removing) return;
    setPending(true);
    const { error } = await createClient().rpc("remove_participant", {
      p_tournament_id: tournamentId,
      p_user_id: removing.user_id,
    });
    setPending(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast(`${removing.display_name} was removed.`);
    setRemoving(null);
    router.refresh();
  }

  const label = (
    <>
      Squad · {showStatus ? `${submitted}/${members.length} slips in` : members.length}
      {revealIso && (
        <>
          {" "}
          · reveal <LocalTime iso={revealIso} />
        </>
      )}
    </>
  );
  const list = (
    <ul className="space-y-2">
        {members.map((m) => {
          const you = m.user_id === viewerUserId;
          return (
            <li key={m.user_id} className={stub(you ? "you" : "ghost", cn("min-h-15", fresh.has(m.user_id) && "print-in"))}>
              <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-1">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold">
                  {m.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className={cn("min-w-0 flex-1 truncate font-medium", !you && "text-foreground/80")}>
                  {m.display_name}
                  {you && <span className="text-muted-foreground"> (you)</span>}
                  {m.is_host && <Crown className="ml-1.5 inline size-4 text-warn" aria-label="Host" />}
                </span>
                {canRemove && !m.is_host && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 text-muted-foreground"
                    aria-label={`Remove ${m.display_name}`}
                    onClick={() => setRemoving(m)}
                  >
                    <UserMinus />
                  </Button>
                )}
              </div>
              {showStatus && (
                <StubTear
                  className={cn(
                    "rounded-r-[calc(var(--radius-2xl)-2px)] text-xs",
                    m.has_submitted ? "bg-mint-strong text-mint-foreground" : "bg-sand-strong text-sand-foreground",
                  )}
                >
                  {m.has_submitted ? (
                    fresh.has(m.user_id) ? (
                      // Just came in: the tear-off gets its "picks in" stamp as the stub finishes printing.
                      <span className="stamp-in flex flex-col items-center [animation-delay:600ms]">
                        {you ? <CircleCheck className="size-5" aria-hidden /> : <Lock className="size-4" aria-hidden />}
                        <span className="mt-0.5 font-semibold">{you ? "Slip in" : "Sealed"}</span>
                      </span>
                    ) : you ? (
                      <>
                        <CircleCheck className="size-5" aria-hidden />
                        <span className="mt-0.5 font-semibold">Slip in</span>
                      </>
                    ) : (
                      <>
                        <Lock className="size-4" aria-hidden />
                        <span className="mt-0.5 font-semibold">Sealed</span>
                        {/* Decoration only: says "there's a slip here", carries no pick data. */}
                        <span aria-hidden className="mt-1 flex gap-1 opacity-50 blur-[2px]">
                          <i className="block h-1.5 w-4 rounded-full bg-foreground" />
                          <i className="block h-1.5 w-6 rounded-full bg-foreground" />
                        </span>
                      </>
                    )
                  ) : (
                    <span className="font-semibold">thinking…</span>
                  )}
                </StubTear>
              )}
            </li>
          );
        })}
      </ul>
  );

  return (
    <section className={collapsible ? "relative mt-4" : "mt-8"} aria-labelledby="squad-heading">
      {collapsible ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 pr-28 [&::-webkit-details-marker]:hidden">
            <span className="flex shrink-0" aria-hidden>
              {members.slice(0, 6).map((m, i) => (
                <span
                  key={m.user_id}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border-2 border-foreground text-xs font-semibold",
                    i > 0 && "-ml-2",
                    fresh.has(m.user_id) && "avatar-pop",
                    m.has_submitted ? "bg-mint-strong" : "bg-sand-strong",
                  )}
                >
                  {m.display_name.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {members.length > 6 && (
                <span className="-ml-2 flex size-8 items-center justify-center rounded-full border-2 border-foreground bg-card text-[11px] font-semibold">
                  +{members.length - 6}
                </span>
              )}
            </span>
            <h2 id="squad-heading" className="min-w-0 text-xs leading-snug font-semibold tracking-wide text-muted-foreground uppercase">
              {label}
            </h2>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2">{list}</div>
        </details>
      ) : (
        <>
          <h2 id="squad-heading" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {label}
          </h2>
          {list}
        </>
      )}
      {aside && <div className="absolute top-0 right-0">{aside}</div>}
      {children}

      <Drawer open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DrawerContent className="mx-auto w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-lg font-bold">Remove {removing?.display_name}?</DrawerTitle>
            <DrawerDescription className="text-left">
              Their picks are deleted and they can&apos;t rejoin this tournament with the same account.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="grid grid-cols-2 gap-2 pt-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            <DrawerClose render={<Button variant="outline" className="h-12" />}>Cancel</DrawerClose>
            <Button variant="destructive" className="h-12" disabled={pending} onClick={remove}>
              {pending && <Loader2 className="animate-spin" />}
              Remove
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </section>
  );
}

/**
 * Players whose slip came in while this lobby was open (has_submitted flipped false → true on a roster refresh).
 * Their stub prints in and their avatar pops once; members already in at page load don't animate.
 */
function useFreshlySubmitted(members: SquadMember[]): ReadonlySet<string> {
  const ids = members.filter((m) => m.has_submitted).map((m) => m.user_id).join(",");
  const [prev, setPrev] = useState(ids);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  if (prev !== ids) {
    const before = new Set(prev.split(",").filter(Boolean));
    setFresh(new Set(ids.split(",").filter((id) => id && !before.has(id))));
    setPrev(ids);
  }
  return fresh;
}
