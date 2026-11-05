"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Settings, UserRound } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { oddsMeaning } from "@/lib/plain-english";
import { setOddsFormat, useOddsFormat } from "@/lib/prefs";
import { cn } from "@/lib/utils";

/** Gear in the top bar → Settings sheet: odds as % or American, plus your name/account. */
export function SettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const format = useOddsFormat();
  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        className={cn("flex size-10 items-center justify-center rounded-full bg-card ring-1 ring-border", className)}
      >
        <Settings className="size-[18px]" />
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="mx-auto w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl font-extrabold">Settings</DrawerTitle>
            <DrawerDescription>Saved on this phone.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-5 px-4 pb-8">
            <section aria-labelledby="odds-format">
              <h3 id="odds-format" className="text-sm font-semibold">
                Show odds as
              </h3>
              <div role="radiogroup" aria-labelledby="odds-format" className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    ["american", "-110 / +250", "Classic odds"],
                    ["percent", "52% / 29%", "Chance to win"],
                  ] as const
                ).map(([value, sample, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={format === value}
                    aria-label={label}
                    onClick={() => setOddsFormat(value)}
                    className={cn(
                      "rounded-2xl p-3 text-left ring-1 transition-colors",
                      format === value ? "bg-brand/12 ring-brand" : "bg-card ring-border",
                    )}
                  >
                    <span className="num block text-lg font-bold">{sample}</span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {format === "percent"
                  ? "Each pick shows the chance the sportsbook gives it. Lower chance = bigger payout."
                  : `${oddsMeaning(-110)}. ${oddsMeaning(250)}.`}
              </p>
            </section>
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center gap-3 rounded-2xl bg-card px-3 ring-1 ring-border"
            >
              <UserRound className="size-4 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">Your name & account</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
