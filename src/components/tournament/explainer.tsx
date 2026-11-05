"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import type { ExplainSection } from "@/lib/plain-english";

/**
 * The tournament's title is a button: tap it (or "How this works") for a plain-English sheet about what you're
 * getting into: fake money, secret picks, how to win, the bets allowed, and how to read odds. For first-timers.
 */
export function TournamentTitle({ title, sections }: { title: string; sections: ExplainSection[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-1.5 block text-left" aria-label={`${title}: how this works`}>
        <h1 className="font-display text-[2.4rem]/[1] font-extrabold tracking-tight text-balance">{title}</h1>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand/10 px-3 text-sm font-medium text-brand ring-1 ring-brand/30"
      >
        <CircleHelp className="size-4" /> New to this? How it works
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="mx-auto max-h-[88dvh] w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl font-extrabold">How it works</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)]">
            {sections.map((s, i) => (
              <section key={s.title}>
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <span className="num flex size-6 items-center justify-center rounded-full bg-brand/15 text-sm text-brand">
                    {i + 1}
                  </span>
                  {s.title}
                </h3>
                <ul className="mt-1.5 space-y-1.5 pl-8 text-sm leading-relaxed text-muted-foreground">
                  {s.body.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground"
            >
              Got it
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
