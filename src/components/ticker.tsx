"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/format";

const DURATION = 600;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Money that counts to its new value (~0.6s, scoreboard-style) instead of jumping. No animation on first render or
 * for reduced motion. `format` defaults to formatCents.
 */
export function Ticker({
  cents,
  format = formatCents,
  className,
}: {
  cents: number;
  format?: (cents: number) => string;
  className?: string;
}) {
  const [shown, setShown] = useState(cents);
  const shownRef = useRef(cents);

  useEffect(() => {
    const from = shownRef.current;
    if (from === cents) return;
    const set = (v: number) => {
      shownRef.current = v;
      setShown(v);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      set(cents);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      set(t === 1 ? cents : Math.round(from + (cents - from) * easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [cents]);

  return (
    <span className={className} aria-label={format(cents)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}
