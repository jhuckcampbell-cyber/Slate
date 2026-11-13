"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toBoardRow, type BoardRow } from "@/lib/core/board";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "./keys";
import { BOARD_COLUMNS } from "./selects";
import { oddsBatch, resilientChannel } from "./realtime";

async function fetchBoard(eventIds: readonly string[]): Promise<BoardRow[]> {
  const { data, error } = await createClient()
    .from("odds_board")
    .select(BOARD_COLUMNS)
    .in("event_id", [...eventIds]);
  if (error) throw error;
  return (data ?? []).map(toBoardRow);
}

/** Signals carry identifiers only. Every price is read back through odds_board and RLS. */
export function useBoard(tournamentId: string, eventIds: readonly string[], initialData: BoardRow[], sportKeys: readonly string[] = []) {
  const queryClient = useQueryClient();
  const eventFilter = [...eventIds].sort().join(",");
  const sports = [...new Set(sportKeys)].sort().join(",");
  const query = useQuery({
    queryKey: queryKeys.board(tournamentId),
    queryFn: () => fetchBoard(eventIds),
    initialData,
    refetchInterval: 45_000,
  });

  useEffect(() => {
    if (!eventFilter) return;
    const ids = eventFilter.split(",");
    const visible = new Set(ids);
    const supabase = createClient();
    const key = queryKeys.board(tournamentId);
    let stopped = false;
    // Serialize reads so a slower earlier response cannot overwrite newer prices.
    let reads = Promise.resolve();
    const batch = oddsBatch((affected) => {
      reads = reads.then(async () => {
        if (stopped) return;
        try {
          const rows = await fetchBoard(affected);
          if (stopped) return;
          const changed = new Set(affected);
          queryClient.setQueryData<BoardRow[]>(key, (before) => [
            ...(before ?? []).filter((row) => !changed.has(row.eventId)), ...rows,
          ]);
        } catch {
          if (!stopped) void queryClient.invalidateQueries({ queryKey: key });
        }
      });
    });
    const resync = () => batch.add(ids);
    const stop = sports.split(",").filter(Boolean).map((sport) => resilientChannel(supabase, () => supabase
      .channel(`odds:${sport}`, { config: { private: true } })
      .on("broadcast", { event: "odds" }, ({ payload }) => {
        if (!Array.isArray(payload?.event_ids)) return;
        const affected = payload.event_ids.filter((id: unknown): id is string => typeof id === "string" && visible.has(id));
        if (affected.length) batch.add(affected);
      }), resync));
    const onVisible = () => { if (document.visibilityState === "visible") resync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      batch.cancel();
      stop.forEach((close) => close());
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tournamentId, eventFilter, sports, queryClient]);
  return query;
}
/** Apply server-reported prices (from an ODDS_CHANGED error) to the cached board immediately. */
export function patchBoardPrices(
  rows: BoardRow[] | undefined,
  updates: readonly { odds_id: number; price_american: number; point: number | null }[],
): BoardRow[] | undefined {
  if (!rows) return rows;
  const byId = new Map(updates.map((u) => [u.odds_id, u]));
  return rows.map((r) => {
    const u = byId.get(r.id);
    if (!u) return r;
    return { ...r, priceAmerican: u.price_american, point: u.point === null ? null : Number(u.point) };
  });
}
