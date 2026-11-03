/**
 * Odds board state: rows as the client renders them, plus how Realtime changes are applied.
 * PURE so the "price moved" logic is unit-tested.
 */
import { americanToDecimalE4 } from "./odds";

export type Movement = "up" | "down" | null;

export type BoardRow = {
  id: number;
  eventId: string;
  marketKey: string;
  outcomeName: string;
  participantName: string;
  point: number | null;
  priceAmerican: number;
  updatedAt: string;
  isStale: boolean;
  /** Direction of the last change, from the bettor's point of view (drives the flash). */
  movement: Movement;
};

/** Row shape from the odds_board view (PostgREST types views as all-nullable). */
export type OddsBoardRecord = {
  id: number | null;
  event_id: string | null;
  market_key: string | null;
  outcome_name: string | null;
  participant_name: string | null;
  point: number | null;
  price_american: number | null;
  updated_at: string | null;
  is_stale: boolean | null;
};

export function toBoardRow(r: OddsBoardRecord): BoardRow {
  return {
    id: Number(r.id),
    eventId: String(r.event_id),
    marketKey: String(r.market_key),
    outcomeName: String(r.outcome_name),
    participantName: r.participant_name ?? "",
    point: r.point === null ? null : Number(r.point),
    priceAmerican: Number(r.price_american),
    updatedAt: String(r.updated_at),
    isStale: r.is_stale ?? true,
    movement: null,
  };
}

/** odds_cache record as delivered by Realtime postgres_changes (values may arrive as strings). */
export type OddsCacheRecord = {
  id: number | string;
  event_id: string;
  market_key: string;
  outcome_name: string;
  participant_name: string;
  point: number | string | null;
  price_american: number | string;
  updated_at: string;
  is_live: boolean;
};

export type OddsChange =
  | { eventType: "INSERT" | "UPDATE"; new: OddsCacheRecord }
  | { eventType: "DELETE"; old: { id?: number | string } };

export function applyOddsChange(rows: readonly BoardRow[], change: OddsChange): BoardRow[] {
  if (change.eventType === "DELETE") {
    const id = Number(change.old.id);
    return rows.filter((r) => r.id !== id);
  }
  const rec = change.new;
  if (rec.is_live) return rows as BoardRow[];

  const next: BoardRow = {
    id: Number(rec.id),
    eventId: rec.event_id,
    marketKey: rec.market_key,
    outcomeName: rec.outcome_name,
    participantName: rec.participant_name ?? "",
    point: rec.point === null ? null : Number(rec.point),
    priceAmerican: Number(rec.price_american),
    updatedAt: rec.updated_at,
    isStale: false, // a Realtime write means this market was just synced
    movement: null,
  };

  const i = rows.findIndex((r) => r.id === next.id);
  if (i === -1) return [...rows, next];

  const prev = rows[i]!;
  if (prev.priceAmerican === next.priceAmerican && prev.point === next.point) return rows as BoardRow[];
  next.movement = movementFor(prev, next);
  const copy = rows.slice();
  copy[i] = next;
  return copy;
}

/** Better for the bettor = "up": a longer price, or a friendlier line at the same price. */
export function movementFor(
  prev: Pick<BoardRow, "priceAmerican" | "point">,
  next: Pick<BoardRow, "priceAmerican" | "point" | "marketKey" | "outcomeName">,
): Movement {
  if (prev.point !== null && next.point !== null && prev.point !== next.point) {
    if (next.marketKey === "totals") {
      const lower = next.point < prev.point;
      return next.outcomeName === "Over" ? (lower ? "up" : "down") : lower ? "down" : "up";
    }
    return next.point > prev.point ? "up" : "down"; // spreads: more points is better
  }
  const a = americanToDecimalE4(prev.priceAmerican);
  const b = americanToDecimalE4(next.priceAmerican);
  return b > a ? "up" : b < a ? "down" : null;
}

/** eventId → marketKey → rows */
export function indexBoard(rows: readonly BoardRow[]): Map<string, Map<string, BoardRow[]>> {
  const byEvent = new Map<string, Map<string, BoardRow[]>>();
  for (const r of rows) {
    const markets = byEvent.get(r.eventId) ?? new Map<string, BoardRow[]>();
    markets.set(r.marketKey, [...(markets.get(r.marketKey) ?? []), r]);
    byEvent.set(r.eventId, markets);
  }
  return byEvent;
}
