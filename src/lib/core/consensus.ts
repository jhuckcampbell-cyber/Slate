/**
 * Post-lock reveal math: who's on which side of every line ("6 of 8 on KC -3") and each player's
 * slip. Pure TS; the inputs are wagers the database has already revealed under RLS.
 */

export type RevealLeg = {
  eventId: string;
  marketKey: string;
  selection: string;
  /** Player name for props; "" for game lines. */
  participantName: string;
  line: number | null;
  oddsAmerican: number;
};

export type RevealWager = {
  id: string;
  participantId: string;
  wagerType: "single" | "parlay";
  amountCents: number;
  potentialPayoutCents: number;
  legs: RevealLeg[];
};

/** One player's position on one side of a market. */
export type Backer = {
  participantId: string;
  /** Total staked on this side through singles (parlay stakes aren't attributable to one leg). */
  singleStakeCents: number;
  /** How many of the player's parlays include this side. */
  parlays: number;
  /** Line and price of the player's first pick on this side (a line can move between bets). */
  line: number | null;
  oddsAmerican: number;
};

export type ConsensusSide = {
  selection: string;
  participantName: string;
  /** The most common line among this side's picks (earliest wins a tie). */
  line: number | null;
  backers: Backer[];
  playerCount: number;
  stakeCents: number;
};

export type ConsensusMarket = {
  marketKey: string;
  /** Most players first, then most money, then name. */
  sides: ConsensusSide[];
  /** Players with any pick in this market. */
  playerCount: number;
  /** The side most players are on, or null when the top sides tie. */
  leader: ConsensusSide | null;
};

export type GameConsensus = {
  eventId: string;
  markets: ConsensusMarket[];
  /** Players with any pick on this game. */
  playerCount: number;
};

export type PlayerSlip<W extends RevealWager = RevealWager> = {
  participantId: string;
  wagers: W[];
  riskedCents: number;
  potentialPayoutCents: number;
};

// Same column order as the sportsbook board; unknown markets (props) follow alphabetically.
const MARKET_ORDER = ["spreads", "totals", "h2h"];

function marketRank(key: string): number {
  const i = MARKET_ORDER.indexOf(key);
  return i === -1 ? MARKET_ORDER.length : i;
}

type SideAcc = {
  selection: string;
  participantName: string;
  backers: Map<string, Backer>;
  lineCounts: Map<string, { line: number | null; count: number }>;
  stakeCents: number;
};

function modeLine(counts: SideAcc["lineCounts"]): number | null {
  let best: { line: number | null; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best ? best.line : null;
}

export function buildConsensus(wagers: readonly RevealWager[], eventIds: readonly string[]): GameConsensus[] {
  // eventId → marketKey → side key → accumulator (Maps keep first-seen order for tie-breaks)
  const byGame = new Map<string, Map<string, Map<string, SideAcc>>>();

  for (const w of wagers) {
    for (const leg of w.legs) {
      const markets = byGame.get(leg.eventId) ?? new Map<string, Map<string, SideAcc>>();
      byGame.set(leg.eventId, markets);
      const sides = markets.get(leg.marketKey) ?? new Map<string, SideAcc>();
      markets.set(leg.marketKey, sides);

      const sideKey = `${leg.participantName}\u0000${leg.selection}`;
      let side = sides.get(sideKey);
      if (!side) {
        side = {
          selection: leg.selection,
          participantName: leg.participantName,
          backers: new Map(),
          lineCounts: new Map(),
          stakeCents: 0,
        };
        sides.set(sideKey, side);
      }

      const single = w.wagerType === "single";
      let backer = side.backers.get(w.participantId);
      if (!backer) {
        backer = { participantId: w.participantId, singleStakeCents: 0, parlays: 0, line: leg.line, oddsAmerican: leg.oddsAmerican };
        side.backers.set(w.participantId, backer);
      }
      if (single) {
        backer.singleStakeCents += w.amountCents;
        side.stakeCents += w.amountCents;
      } else {
        backer.parlays += 1;
      }

      const lineKey = String(leg.line);
      const lc = side.lineCounts.get(lineKey) ?? { line: leg.line, count: 0 };
      lc.count += 1;
      side.lineCounts.set(lineKey, lc);
    }
  }

  return eventIds.map((eventId) => {
    const markets = byGame.get(eventId);
    if (!markets) return { eventId, markets: [], playerCount: 0 };

    const gamePlayers = new Set<string>();
    const out: ConsensusMarket[] = [...markets.entries()]
      .sort(([a], [b]) => marketRank(a) - marketRank(b) || a.localeCompare(b))
      .map(([marketKey, sideMap]) => {
        const marketPlayers = new Set<string>();
        const sides: ConsensusSide[] = [...sideMap.values()].map((s) => {
          for (const id of s.backers.keys()) {
            marketPlayers.add(id);
            gamePlayers.add(id);
          }
          return {
            selection: s.selection,
            participantName: s.participantName,
            line: modeLine(s.lineCounts),
            backers: [...s.backers.values()],
            playerCount: s.backers.size,
            stakeCents: s.stakeCents,
          };
        });
        sides.sort(
          (a, b) =>
            b.playerCount - a.playerCount || b.stakeCents - a.stakeCents || a.selection.localeCompare(b.selection),
        );
        const [top, next] = sides;
        const leader = top && (!next || top.playerCount > next.playerCount) ? top : null;
        return { marketKey, sides, playerCount: marketPlayers.size, leader };
      });

    return { eventId, markets: out, playerCount: gamePlayers.size };
  });
}

export function slipsByPlayer<W extends RevealWager>(
  wagers: readonly W[],
  participantIds: readonly string[],
): PlayerSlip<W>[] {
  return participantIds.map((participantId) => {
    const mine = wagers.filter((w) => w.participantId === participantId);
    return {
      participantId,
      wagers: mine,
      riskedCents: mine.reduce((sum, w) => sum + w.amountCents, 0),
      potentialPayoutCents: mine.reduce((sum, w) => sum + w.potentialPayoutCents, 0),
    };
  });
}
