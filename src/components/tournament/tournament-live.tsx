"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { resilientChannel } from "@/lib/queries/realtime";
import { createClient } from "@/lib/supabase/client";

type Props = {
  tournamentId: string;
  code: string;
  viewerUserId: string;
  /** tournaments.updated_at as rendered; bumped by every lock/rules/status change. */
  renderedVersion: string;
  /** Games are under way: win chances drift with the clock, so re-render every minute. */
  sweating?: boolean;
};

type RosterSignal = { change?: string; user_id?: string };
type TournamentSignal = { status?: string };

// Set right before this device leaves or deletes on purpose, so the "left"/"deleted" signals that follow
// don't send it to the "removed by the host" screen.
const leaving = new Set<string>();
export function markLeaving(tournamentId: string) {
  leaving.add(tournamentId);
}
/** The leave/delete failed: real "removed"/"deleted" signals count again. */
export function unmarkLeaving(tournamentId: string) {
  leaving.delete(tournamentId);
}

const POLL_MS = 20_000;
const SWEAT_REFRESH_MS = 60_000;


/**
 * Keeps an open lobby in sync with the database. The private Realtime channel "tournament:<id>"
 * (participants only, see migration 0006) carries bare signals, never picks:
 *   tournament â†’ lock time / rules / status changed   roster â†’ someone joined, left, or submitted
 *   scores â†’ a game's score changed (bets may have been graded)
 * Each one re-renders the server components (RLS decides what's visible).
 * Sockets aren't guaranteed (phones background tabs, joins race the first render), so:
 *   - every (re)join of the channel triggers one catch-up refresh,
 *   - returning to the tab refreshes,
 *   - a cheap poll of tournaments.updated_at refreshes within ~20s if a signal was missed.
 * The lock countdown separately refreshes at the lock moment.
 */
export function TournamentLive({ tournamentId, code, viewerUserId, renderedVersion, sweating = false }: Props) {
  const router = useRouter();
  // The poll compares against the latest render without re-joining the channel on every refresh.
  const version = useRef(renderedVersion);
  useEffect(() => {
    version.current = renderedVersion;
  }, [renderedVersion]);

  useEffect(() => {
    const supabase = createClient();
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => router.refresh(), 200);
    };

    const stopChannel = resilientChannel(supabase, () => supabase
      .channel(`tournament:${tournamentId}`, { config: { private: true } })
      .on("broadcast", { event: "tournament" }, ({ payload }: { payload: TournamentSignal }) => {
        if (payload.status === "deleted") {
          if (!leaving.has(tournamentId)) router.replace("/?deleted=1");
          return;
        }
        refresh();
      })
      .on("broadcast", { event: "scores" }, refresh)
      .on("broadcast", { event: "roster" }, ({ payload }: { payload: RosterSignal }) => {
        if (payload.change === "left" && payload.user_id === viewerUserId) {
          if (!leaving.has(tournamentId)) router.replace(`/join/${code}?removed=1`);
          return;
        }
        refresh();
      }), refresh);

    const poll = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.from("tournaments").select("updated_at").eq("id", tournamentId).maybeSingle();
      if (!data) {
        if (!leaving.has(tournamentId)) router.replace(`/join/${code}`);
      }
      else if (data.updated_at !== version.current) refresh();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopChannel();
      clearTimeout(debounce);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);

    };
  }, [tournamentId, code, viewerUserId, router]);

  useEffect(() => {
    if (!sweating) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, SWEAT_REFRESH_MS);
    return () => clearInterval(id);
  }, [sweating, router]);

  return null;
}
