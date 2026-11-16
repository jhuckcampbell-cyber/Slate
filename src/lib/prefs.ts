"use client";

import { useSyncExternalStore } from "react";
import type { OddsFormat } from "./plain-english";

/**
 * Per-device display preferences (Settings sheet). localStorage, so they survive reloads; storage can be blocked
 * (private mode), so every read/write is guarded and the default always works. Server render = default.
 */
const KEY = "slate:odds-format";
const EVENT = "slate:prefs";

/** American odds are the default (sportsbook layout); % chance is opt-in in Settings. */
export const DEFAULT_ODDS_FORMAT: OddsFormat = "american";

function read(): OddsFormat {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "american" || stored === "percent" ? stored : DEFAULT_ODDS_FORMAT;
  } catch {
    return DEFAULT_ODDS_FORMAT;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useOddsFormat(): OddsFormat {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_ODDS_FORMAT);
}

export function setOddsFormat(format: OddsFormat) {
  try {
    localStorage.setItem(KEY, format);
  } catch {
    // blocked storage: the choice just won't stick
  }
  window.dispatchEvent(new Event(EVENT));
}
