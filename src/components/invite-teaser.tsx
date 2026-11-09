"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { StubTear, stub } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * "Bring your squad": a teaser for accounts (keep your record, invite friends with one link). For show only:
 * there are no accounts yet, so a tap just says so.
 */
export function InviteTeaser({ className }: { className?: string }) {
  const [told, setTold] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setTold((v) => !v)}
        aria-expanded={told}
        aria-controls="invite-teaser-note"
        className={stub("ghost", "w-full text-left transition-transform active:scale-[0.99]")}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3 pl-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
            <UserPlus className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Bring your squad</span>
            <span className="block text-xs leading-snug text-muted-foreground">
              Make an account to keep your record and invite friends with one link.
            </span>
          </span>
        </span>
        <StubTear>
          <span className="rounded-full bg-hype/12 px-2 py-0.5 text-[11px] font-bold tracking-wide text-foreground uppercase ring-1 ring-hype/40">
            Soon
          </span>
        </StubTear>
      </button>
      <p
        id="invite-teaser-note"
        role="status"
        className={cn(
          "mt-2 px-1 text-center text-xs text-muted-foreground",
          told ? "motion-safe:animate-in motion-safe:fade-in" : "sr-only",
        )}
      >
        {told ? "Accounts are coming soon. For now, share your tournament link in the group chat." : ""}
      </p>
    </div>
  );
}
