"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, House, Plus } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { sportEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SwitcherItem = { code: string; title: string; sportKey: string; label: string; detail: string | null };

/** The code chip in a tournament's top bar: tap to hop to another of your tournaments, home, or start a new one. */
export function TournamentSwitcher({ current, items }: { current: string; items: SwitcherItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Switch tournament"
        className="flex h-10 items-center gap-1 rounded-full border-2 border-foreground bg-card pr-2.5 pl-3 font-mono text-sm tracking-widest transition-transform motion-safe:active:scale-95"
      >
        {current}
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="mx-auto max-h-[85dvh] w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl font-extrabold">Your tournaments</DrawerTitle>
          </DrawerHeader>
          <ul className="space-y-2 overflow-y-auto px-4">
            {items.map((t) => (
              <li key={t.code}>
                <Link
                  href={`/t/${t.code}`}
                  onClick={() => setOpen(false)}
                  aria-current={t.code === current ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-2xl border-2 px-3 py-2",
                    t.code === current ? "border-foreground bg-tab" : "border-foreground/25 bg-card",
                  )}
                >
                  <span className="text-xl" aria-hidden>
                    {sportEmoji(t.sportKey)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.detail ?? t.label} · <span className="font-mono tracking-wider">{t.code}</span>
                    </span>
                  </span>
                  {t.code === current && <Check className="size-4 text-brand" />}
                </Link>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-card text-sm font-medium"
            >
              <House className="size-4" /> Home
            </Link>
            <Link
              href="/create"
              onClick={() => setOpen(false)}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" /> New tournament
            </Link>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
