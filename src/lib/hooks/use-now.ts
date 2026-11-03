"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 1000;

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, TICK_MS);
  return () => clearInterval(id);
}

// Floor to the tick so repeated snapshot reads within a tick are identical.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = () => null;

/** Current time in ms, ticking every second. `null` during SSR/hydration (avoids mismatch). */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
