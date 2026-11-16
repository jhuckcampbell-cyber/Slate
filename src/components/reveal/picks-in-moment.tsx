"use client";

import { LockOpen } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
const seenKey = (tournamentId: string) => `slate:revealed:${tournamentId}`;

function hasSeen(tournamentId: string) {
  try {
    return localStorage.getItem(seenKey(tournamentId)) === "1";
  } catch {
    return true; // storage blocked: skip the flourish rather than replay it forever
  }
}

/** First look after lock: a short full-screen "Picks are in!", once per tournament per phone. */
export function PicksInMoment({ tournamentId, summary }: { tournamentId: string; summary: string }) {
  const seen = useSyncExternalStore(noopSubscribe, () => hasSeen(tournamentId), () => true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (seen) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(seenKey(tournamentId), "1");
      } catch {
        // storage blocked: the flourish just plays again next time
      }
      setDone(true);
    }, 2400);
    return () => clearTimeout(t);
  }, [seen, tournamentId]);

  if (seen || done) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/90 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in"
    >
      <div className="text-center">
        <LockOpen className="mx-auto size-16 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:spin-in-12 motion-safe:duration-500" />
        <p className="mt-4 font-display text-5xl font-extrabold motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:delay-200 motion-safe:duration-500">
          Picks are in!
        </p>
        <p className="mt-2 text-sm text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both motion-safe:delay-500">
          {summary}
        </p>
      </div>
    </div>
  );
}
