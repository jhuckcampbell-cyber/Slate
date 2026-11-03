"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "./keys";
import {
  WAGER_SELECT,
  toMyWager,
  type Bankroll,
  type MyWager,
  type SlipPayload,
  type WagerRow,
} from "./selects";

export type { Bankroll, MyWager, SlipPayload } from "./selects";

export function useMyWagers(participantId: string, initialData: MyWager[]) {
  return useQuery({
    queryKey: queryKeys.myWagers(participantId),
    initialData,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("wagers")
        .select(WAGER_SELECT)
        .eq("participant_id", participantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as WagerRow[]).map(toMyWager);
    },
  });
}

export function useBankroll(participantId: string, initialData: Bankroll) {
  return useQuery({
    queryKey: queryKeys.bankroll(participantId),
    initialData,
    queryFn: async (): Promise<Bankroll> => {
      const { data, error } = await createClient()
        .from("tournament_participants")
        .select("remaining_bankroll_cents, total_potential_payout_cents")
        .eq("id", participantId)
        .single();
      if (error) throw error;
      return {
        remainingCents: Number(data.remaining_bankroll_cents),
        potentialPayoutCents: Number(data.total_potential_payout_cents),
      };
    },
  });
}

type Ctx = { tournamentId: string; participantId: string };

/** Books a whole slip in one RPC (all-or-nothing), optimistically updating picks + bankroll. */
export function usePlaceWagers({ tournamentId, participantId }: Ctx) {
  const qc = useQueryClient();
  const wagersKey = queryKeys.myWagers(participantId);
  const bankrollKey = queryKeys.bankroll(participantId);

  return useMutation({
    mutationFn: async (vars: { slip: SlipPayload; optimistic: MyWager[]; stakeCents: number; returnCents: number }) => {
      const { data, error } = await createClient().rpc("place_wagers", {
        p_tournament_id: tournamentId,
        p_slip: vars.slip,
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (vars) => {
      await Promise.all([qc.cancelQueries({ queryKey: wagersKey }), qc.cancelQueries({ queryKey: bankrollKey })]);
      const prevWagers = qc.getQueryData<MyWager[]>(wagersKey);
      const prevBankroll = qc.getQueryData<Bankroll>(bankrollKey);
      qc.setQueryData<MyWager[]>(wagersKey, (w = []) => [...vars.optimistic, ...w]);
      qc.setQueryData<Bankroll>(bankrollKey, (b) =>
        b && {
          remainingCents: b.remainingCents - vars.stakeCents,
          potentialPayoutCents: b.potentialPayoutCents + vars.returnCents,
        },
      );
      return { prevWagers, prevBankroll };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(wagersKey, ctx?.prevWagers);
      qc.setQueryData(bankrollKey, ctx?.prevBankroll);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: wagersKey });
      void qc.invalidateQueries({ queryKey: bankrollKey });
    },
  });
}

export function useCancelWager({ participantId }: Pick<Ctx, "participantId">) {
  const qc = useQueryClient();
  const wagersKey = queryKeys.myWagers(participantId);
  const bankrollKey = queryKeys.bankroll(participantId);

  return useMutation({
    mutationFn: async (wager: MyWager) => {
      const { error } = await createClient().rpc("cancel_wager", { p_wager_id: wager.id });
      if (error) throw error;
    },
    onMutate: async (wager) => {
      await Promise.all([qc.cancelQueries({ queryKey: wagersKey }), qc.cancelQueries({ queryKey: bankrollKey })]);
      const prevWagers = qc.getQueryData<MyWager[]>(wagersKey);
      const prevBankroll = qc.getQueryData<Bankroll>(bankrollKey);
      qc.setQueryData<MyWager[]>(wagersKey, (w = []) => w.filter((x) => x.id !== wager.id));
      qc.setQueryData<Bankroll>(bankrollKey, (b) =>
        b && {
          remainingCents: b.remainingCents + wager.amount_cents,
          potentialPayoutCents: b.potentialPayoutCents - wager.potential_payout_cents,
        },
      );
      return { prevWagers, prevBankroll };
    },
    onError: (_err, _wager, ctx) => {
      qc.setQueryData(wagersKey, ctx?.prevWagers);
      qc.setQueryData(bankrollKey, ctx?.prevBankroll);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: wagersKey });
      void qc.invalidateQueries({ queryKey: bankrollKey });
    },
  });
}
