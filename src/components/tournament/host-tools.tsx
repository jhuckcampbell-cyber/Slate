"use client";

import { Loader2, LockKeyhole, SlidersHorizontal } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { friendlyError, messageFor } from "@/lib/errors";
import { toDateTimeLocal } from "@/lib/format";
import { draftFromRules, rulesChanges, type EditableRules, type RulesDraft } from "@/lib/host-rules";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Props = {
  tournamentId: string;
  rules: EditableRules;
  firstKickoff: string;
  /** Bankroll can only be re-dealt while the host is alone (and hasn't bet). */
  canEditBankroll: boolean;
  /** Names of players with no picks yet, for the lock confirmation. */
  waitingOn: string[];
  /** This sport has player props (NBA/NFL/college). */
  propsAvailable: boolean;
};

const MARKETS = [
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Over/Under" },
] as const;

export function HostTools({ tournamentId, rules, firstKickoff, canEditBankroll, waitingOn, propsAvailable }: Props) {
  const [lockOpen, setLockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <section aria-label="Host tools" className="mt-6 rounded-2xl border border-warn/30 bg-warn/5 p-4">
      <h2 className="text-xs font-semibold tracking-wide text-warn uppercase">Host tools</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={() => setEditOpen(true)}>
          <SlidersHorizontal /> Edit rules
        </Button>
        <Button variant="secondary" className="h-11 ring-1 ring-warn/40" onClick={() => setLockOpen(true)}>
          <LockKeyhole className="text-warn" /> Lock picks now
        </Button>
      </div>

      <LockNowDrawer tournamentId={tournamentId} open={lockOpen} onOpenChange={setLockOpen} waitingOn={waitingOn} />
      <Drawer open={editOpen} onOpenChange={setEditOpen}>
        <DrawerContent className="mx-auto w-full max-w-md">
          {/* Remount per open so the form starts from the current rules. */}
          {editOpen && (
            <EditRulesForm
              tournamentId={tournamentId}
              rules={rules}
              firstKickoff={firstKickoff}
              canEditBankroll={canEditBankroll}
              propsAvailable={propsAvailable}
              onDone={() => setEditOpen(false)}
            />
          )}
        </DrawerContent>
      </Drawer>
    </section>
  );
}

function LockNowDrawer({
  tournamentId,
  open,
  onOpenChange,
  waitingOn,
}: {
  tournamentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  waitingOn: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function lock() {
    setPending(true);
    const { error } = await createClient().rpc("lock_tournament_now", { p_tournament_id: tournamentId });
    setPending(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto w-full max-w-md">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-lg font-bold">Lock picks now?</DrawerTitle>
          <DrawerDescription className="text-left">
            Betting closes and everyone&apos;s picks are revealed to the squad right away. This can&apos;t be
            undone.
          </DrawerDescription>
          {waitingOn.length > 0 && (
            <p className="mt-2 rounded-lg bg-warn/10 p-3 text-sm text-warn">
              Still thinking: {waitingOn.join(", ")}
            </p>
          )}
        </DrawerHeader>
        <DrawerFooter className="grid grid-cols-2 gap-2 pt-4 pb-[max(env(safe-area-inset-bottom),16px)]">
          <DrawerClose render={<Button variant="outline" className="h-12" />}>Not yet</DrawerClose>
          <Button className="h-12" disabled={pending} onClick={lock}>
            {pending && <Loader2 className="animate-spin" />}
            Lock &amp; reveal
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function EditRulesForm({
  tournamentId,
  rules,
  firstKickoff,
  canEditBankroll,
  propsAvailable,
  onDone,
}: {
  tournamentId: string;
  rules: EditableRules;
  firstKickoff: string;
  canEditBankroll: boolean;
  propsAvailable: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<RulesDraft>(() => draftFromRules(rules));
  const [pending, setPending] = useState(false);
  const set = <K extends keyof RulesDraft>(key: K, value: RulesDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const result = rulesChanges(rules, draft);
    if (!result.ok) {
      toast.error(messageFor(result.error));
      return;
    }
    if (Object.keys(result.changes).length === 0) {
      onDone();
      return;
    }
    setPending(true);
    const { error } = await createClient().rpc("update_tournament", {
      p_tournament_id: tournamentId,
      p_changes: result.changes,
    });
    setPending(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast("Rules updated. The squad sees them now.");
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader className="text-left">
        <DrawerTitle className="text-lg font-bold">Edit rules</DrawerTitle>
        <DrawerDescription className="text-left">Changes apply to new bets. Bets already placed stand.</DrawerDescription>
      </DrawerHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Tournament name" htmlFor="edit-title">
          <Input
            id="edit-title"
            maxLength={60}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        <Field label="Picks lock at" htmlFor="edit-lock" hint="Any time before the first kickoff.">
          <Input
            id="edit-lock"
            type="datetime-local"
            max={toDateTimeLocal(firstKickoff)}
            value={draft.lockTime}
            onChange={(e) => set("lockTime", e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Max bet ($)" htmlFor="edit-maxbet">
            <Input
              id="edit-maxbet"
              inputMode="decimal"
              placeholder="No limit"
              value={draft.maxBet}
              onChange={(e) => set("maxBet", e.target.value)}
              className="h-11 text-base"
            />
          </Field>
          <Field
            label="Bankroll ($)"
            htmlFor="edit-bankroll"
            hint={canEditBankroll ? undefined : "Fixed once friends join."}
          >
            <Input
              id="edit-bankroll"
              inputMode="decimal"
              disabled={!canEditBankroll}
              value={draft.bankroll}
              onChange={(e) => set("bankroll", e.target.value)}
              className="h-11 text-base"
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Allowed bets</p>
          <div className="flex flex-wrap gap-2">
            {MARKETS.map((m) => {
              const on = draft.markets.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("markets", on ? draft.markets.filter((k) => k !== m.key) : [...draft.markets, m.key])}
                  className={cn(
                    "h-11 rounded-full border px-4 text-sm font-medium",
                    on ? "border-brand bg-brand/15 text-brand" : "border-border text-muted-foreground",
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border p-3">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <label htmlFor="edit-parlays" className="flex-1">
              <span className="block text-sm font-medium">Parlays</span>
              <span className="text-xs text-muted-foreground">
                {draft.sameGameParlays ? "Several picks from one game allowed" : "One pick per game"}
              </span>
            </label>
            <Switch id="edit-parlays" checked={draft.parlays} onCheckedChange={(v) => set("parlays", v)} />
          </div>
          {draft.parlays && (
            <div className="mt-3 flex min-h-10 items-center justify-between gap-3">
              <label htmlFor="edit-sgp" className="flex-1 text-sm">
                Same-game parlays
              </label>
              <Switch id="edit-sgp" checked={draft.sameGameParlays} onCheckedChange={(v) => set("sameGameParlays", v)} />
            </div>
          )}
          {draft.parlays && (
            <select
              aria-label="Max parlay legs"
              value={draft.maxParlayLegs}
              onChange={(e) => set("maxParlayLegs", Number(e.target.value))}
              className="mt-3 h-11 w-full appearance-none rounded-lg border border-input bg-muted px-3 text-base text-foreground [color-scheme:dark]"
            >
              {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  Up to {n} legs
                </option>
              ))}
            </select>
          )}
        </div>

        {propsAvailable && (
          <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border p-3">
            <label htmlFor="edit-props" className="flex-1">
              <span className="block text-sm font-medium">Player props</span>
              <span className="text-xs text-muted-foreground">Over/under on player stats. You enter the stats after.</span>
            </label>
            <Switch id="edit-props" checked={draft.playerProps} onCheckedChange={(v) => set("playerProps", v)} />
          </div>
        )}
      </div>

      <DrawerFooter className="grid grid-cols-2 gap-2 border-t border-border pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
        <DrawerClose render={<Button type="button" variant="outline" className="h-12" />}>Cancel</DrawerClose>
        <Button type="submit" className="h-12" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </DrawerFooter>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
