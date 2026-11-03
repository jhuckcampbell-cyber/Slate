"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createServerClock } from "@/lib/server-clock";

const TICK_MS = 1000;

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, TICK_MS);
  return () => clearInterval(id);
}

// One clock per DB timestamp, created on first client read (= hydration time). A refresh brings a
// fresh timestamp and so a re-synced clock. Bounded: a lobby refreshes a few dozen times at most.
const clocks = new Map<string, () => number>();
function clockFor(serverNow: string) {
  let clock = clocks.get(serverNow);
  if (!clock) {
    clock = createServerClock(serverNow);
    clocks.set(serverNow, clock);
    if (clocks.size > 16) clocks.delete(clocks.keys().next().value!);
  }
  return clock;
}

// Floor to the tick so repeated snapshot reads within a tick are identical.
function snapshot(serverNow: string | null | undefined) {
  const now = serverNow ? clockFor(serverNow)() : Date.now();
  return Math.floor(now / TICK_MS) * TICK_MS;
}
const getServerSnapshot = () => null;

/**
 * Current time by the DATABASE clock (CLAUDE.md rule 5), ticking every second; `null` during
 * SSR/hydration. `serverNow` is the DB's now() from the page render (tournaments.server_now);
 * without it this falls back to the device clock.
 */
export function useServerNow(serverNow?: string | null): number | null {
  const getSnapshot = useCallback(() => snapshot(serverNow), [serverNow]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
