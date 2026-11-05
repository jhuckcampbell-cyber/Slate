"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DoorOpen, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { markLeaving } from "@/components/tournament/tournament-live";

/**
 * Before lock: a player can leave (joined by accident), the host can delete the whole tournament.
 * After lock neither is possible (the database refuses: friends are sweating those picks).
 */
export function ExitTournament({ tournamentId, isHost, title }: { tournamentId: string; isHost: boolean; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    markLeaving(tournamentId);
    const supabase = createClient();
    const { error } = await supabase.rpc(isHost ? "delete_tournament" : "leave_tournament", {
      p_tournament_id: tournamentId,
    });
    if (error) {
      setPending(false);
      toast.error(friendlyError(error));
      return;
    }
    toast.success(isHost ? `Deleted "${title}"` : `You left "${title}"`);
    router.replace("/");
    router.refresh();
  }

  const Icon = isHost ? Trash2 : DoorOpen;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-6 flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-muted-foreground hover:text-loss"
      >
        <Icon className="size-4" /> {isHost ? "Delete tournament" : "Leave tournament"}
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="mx-auto w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl font-extrabold">
              {isHost ? "Delete this tournament?" : "Leave this tournament?"}
            </DrawerTitle>
            <DrawerDescription>
              {isHost
                ? "It's gone for everyone: the invite link stops working and all picks are erased. This can't be undone."
                : "Your picks are erased and you're out of the squad. You can rejoin with the link before picks lock."}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="grid grid-cols-2 gap-2 pb-[max(env(safe-area-inset-bottom),16px)]">
            <Button variant="outline" className="h-12" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" className="h-12" disabled={pending} onClick={confirm}>
              {pending ? <Loader2 className="animate-spin" /> : <Icon />}
              {isHost ? "Delete" : "Leave"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
