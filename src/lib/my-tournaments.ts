/** "Your tournaments" on the home screen. PURE: the page fetches, this orders and labels. */

export type MyTournament = {
  code: string;
  title: string;
  sportKey: string;
  status: string;
  lockTime: string;
  isHost: boolean;
};

const FINISHED = new Set(["settled"]);

/** Still in play first (soonest lock first), then finished ones (most recent first). */
export function orderMyTournaments(list: readonly MyTournament[]): MyTournament[] {
  const live = list.filter((t) => !FINISHED.has(t.status));
  const done = list.filter((t) => FINISHED.has(t.status));
  const ts = (t: MyTournament) => Date.parse(t.lockTime);
  return [
    ...live.sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1) || ts(a) - ts(b)),
    ...done.sort((a, b) => ts(b) - ts(a)),
  ];
}

/** Where it stands. A tournament past its lock reads "Locked" even before the status job catches up. */
export function tournamentStatusLabel(t: MyTournament, nowMs: number): string {
  if (t.status === "settled") return "Final";
  if (t.status === "live") return "Live";
  if (t.status === "locked" || Date.parse(t.lockTime) <= nowMs) return "Locked";
  return "Open";
}
