"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyOddsChange, toBoardRow, type BoardRow, type OddsChange } from "@/lib/core/board";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "./keys";
import { BOARD_COLUMNS } from "./selects";

async function fetchBoard(eventIds: readonly string[]): Promise<BoardRow[]> {
  const { data, error } = await createClient()
    .from("odds_board")
    .select(BOARD_COLUMNS)
    .in("event_id", [...eventIds]);
  if (error) throw error;
  return (data ?? []).map(toBoardRow);
}

/**
 * Odds for a tournament's games. Server-rendered initial data, Realtime patches for line
 * movement (only real price changes hit odds_cache), and a 60s refetch so staleness flags
 * (computed by the DB clock in the odds_board view) stay current.
 */
export function useBoard(tournamentId: string, eventIds: readonly string[], initialData: BoardRow[]) {
  const queryClient = useQueryClient();
  const eventFilter = eventIds.join(",");

  const query = useQuery({
    queryKey: queryKeys.board(tournamentId),
    queryFn: () => fetchBoard(eventIds),
    initialData,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!eventFilter) return;
    const supabase = createClient();
    const key = queryKeys.board(tournamentId);
    const channel = supabase
      .channel(`odds:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "odds_cache", filter: `event_id=in.(${eventFilter})` },
        (payload) => {
          queryClient.setQueryData<BoardRow[]>(key, (rows) =>
            rows ? applyOddsChange(rows, payload as unknown as OddsChange) : rows,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tournamentId, eventFilter, queryClient]);

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
