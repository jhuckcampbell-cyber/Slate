"use client";

import { useSyncExternalStore } from "react";
import type { OddsFormat } from "./plain-english";

/**
 * Per-device display preferences (Settings sheet). localStorage, so they survive reloads; storage can be blocked
 * (private mode), so every read/write is guarded and the default always works. Server render = default.
 */
const KEY = "slate:odds-format";
const EVENT = "slate:prefs";

function read(): OddsFormat {
  try {
    return localStorage.getItem(KEY) === "percent" ? "percent" : "american";
  } catch {
    return "american";
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
  return useSyncExternalStore(subscribe, read, () => "american");
}

export function setOddsFormat(format: OddsFormat) {
  try {
    localStorage.setItem(KEY, format);
  } catch {
    // blocked storage: the choice just won't stick
  }
  window.dispatchEvent(new Event(EVENT));
}
