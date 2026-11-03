"use client";

import { CircleCheck, Crown, Hourglass, Loader2, UserMinus } from "lucide-react";
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
  /** Pre-lock: show who's submitted ("5/8 locked in") without revealing what. */
  showStatus: boolean;
  /** Host, pre-lock. */
  canRemove: boolean;
  children?: React.ReactNode;
};

export function SquadList({ tournamentId, members, viewerUserId, showStatus, canRemove, children }: Props) {
  const router = useRouter();
  const [removing, setRemoving] = useState<SquadMember | null>(null);
  const [pending, setPending] = useState(false);
  const submitted = members.filter((m) => m.has_submitted).length;

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

  return (
    <section className="mt-8" aria-labelledby="squad-heading">
      <h2 id="squad-heading" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Squad · {showStatus ? `${submitted}/${members.length} locked in` : members.length}
      </h2>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.user_id} className="flex min-h-15 items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-border">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15 font-semibold text-brand">
              {m.display_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {m.display_name}
              {m.user_id === viewerUserId && <span className="text-muted-foreground"> (you)</span>}
              {m.is_host && <Crown className="ml-1.5 inline size-4 text-warn" aria-label="Host" />}
            </span>
            {showStatus &&
              (m.has_submitted ? (
                <span className="flex items-center gap-1 text-xs text-brand">
                  <CircleCheck className="size-4" /> Picks in
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Hourglass className="size-4" /> Thinking…
                </span>
              ))}
            {canRemove && !m.is_host && (
              <Button
                variant="ghost"
                size="icon"
                className="-my-2 -mr-2 size-11 text-muted-foreground"
                aria-label={`Remove ${m.display_name}`}
                onClick={() => setRemoving(m)}
              >
                <UserMinus />
              </Button>
            )}
          </li>
        ))}
      </ul>
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
