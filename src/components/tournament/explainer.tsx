"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import type { ExplainSection } from "@/lib/plain-english";

/**
 * The tournament's title is a button: tap it (or "How this works") for a plain-English sheet about what you're
 * getting into: fake money, secret picks, how to win, the bets allowed, and how to read odds. For first-timers.
 */
export function TournamentTitle({
  title,
  sections,
  meta,
  rules,
}: {
  title: string;
  sections: ExplainSection[];
  /** One quiet line under the title ("🏀 NBA · 2 games · $100 each"). */
  meta?: React.ReactNode;
  /**
   * The rules disclosure (a <details> whose summary reads "Rules"). "How it works" sits beside its summary as a
   * second text link, so the lobby's top is two links instead of two chips.
   */
  rules?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 block text-left" aria-label={`${title}: how this works`}>
        <h1 className="font-display text-[2.4rem]/[1] font-extrabold tracking-tight text-balance">{title}</h1>
      </button>
      {meta && <p className="mt-1 text-sm text-muted-foreground">{meta}</p>}
      {rules ? (
        <div className="relative mt-1">
          {rules}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="absolute top-0 left-24 inline-flex h-11 items-center gap-1.5 text-sm font-semibold underline decoration-2 underline-offset-4"
          >
            <CircleHelp className="size-4" aria-hidden /> How it works
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="press-ink mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-foreground bg-sky px-4 text-sm font-semibold"
        >
          <CircleHelp className="size-4" /> New to this? How it works
        </button>
      )}
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
