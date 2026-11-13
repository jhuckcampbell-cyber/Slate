/**
 * Turns an Odds API response into odds_sync_ingest rows. PURE (no Deno/Node APIs) so Vitest
 * covers it and the Edge Function imports it unchanged.
 *
 * One canonical price per outcome: for each (event, market) we take the first bookmaker in
 * priority order that offers a complete, valid market. Partial/malformed markets are skipped
 * whole rather than half-stored.
 */
import type {
  ApiEvent,
  ApiMarket,
  IngestEvent,
  IngestMarket,
  IngestOutcome,
} from "./odds-api.ts";

import { eventStatus } from "./event-status.ts";

const LINE_MARKETS = new Set(["spreads", "totals"]);

export type NormalizeOptions = {
  /** Markets to keep (others in the response are ignored). Empty = keep none (catalog). */
  markets: readonly string[];
  /** Bookmaker priority. Empty = first book offering the market. */
  bookmakers: readonly string[];
};

export type Normalized = {
  events: (IngestEvent & { status?: string; status_reason?: string })[];
  outcomes: IngestOutcome[];
  markets: IngestMarket[];
  /** (event, market) pairs requested but not usable from any book. */
  skippedMarkets: number;
};

export function normalizeOddsResponse(apiEvents: readonly (ApiEvent & { status?: string; status_reason?: string })[], opts: NormalizeOptions): Normalized {
  const out: Normalized = { events: [], outcomes: [], markets: [], skippedMarkets: 0 };

  for (const ev of apiEvents) {
    if (!ev.id || !ev.home_team || !ev.away_team || Number.isNaN(Date.parse(ev.commence_time))) continue;

    out.events.push({
      ...eventStatus(ev.status),
      ...(eventStatus(ev.status) && ev.status_reason ? { status_reason: ev.status_reason } : {}),
      id: ev.id,
      sport_key: ev.sport_key,
      sport_title: ev.sport_title ?? null,
      home_team: ev.home_team,
      away_team: ev.away_team,
      commence_time: ev.commence_time,
    });

    for (const marketKey of opts.markets) {
      const picks = isPropMarket(marketKey)
        ? pickPropBooks(ev, marketKey, opts.bookmakers)
        : [pickBook(ev, marketKey, opts.bookmakers)].filter((p) => p !== null);
      if (picks.length === 0) {
        // A successful per-event response can withdraw an entire requested prop market.
        // Carry an empty snapshot so SQL removes its cached players rather than refreshing them.
        if (isPropMarket(marketKey)) out.markets.push({
          event_id: ev.id, market_key: marketKey, bookmaker: "",
          provider_updated_at: oldestTimestamp(orderedBooks(ev, opts.bookmakers).map((b) =>
            b.markets.find((m) => m.key === marketKey)?.last_update ?? b.last_update)),
        });
        if (ev.bookmakers?.length) out.skippedMarkets++;
        continue;
      }
      // The market row names the book that priced the most (first, on a tie) of it.
      out.markets.push({ event_id: ev.id, market_key: marketKey, provider_updated_at: oldestTimestamp(picks.map((p) => p.market.last_update)), bookmaker: picks[0]!.book });
      for (const pick of picks) {
        for (const o of pick.market.outcomes) {
          out.outcomes.push({
            event_id: ev.id,
            market_key: marketKey,
            outcome_name: o.name,
            participant_name: o.description ?? "",
            point: o.point ?? null,
            price_american: o.price,
            ...(pick.market.last_update && Number.isFinite(Date.parse(pick.market.last_update))
              ? { provider_updated_at: pick.market.last_update } : {}),
            bookmaker: pick.book,
          });
        }
      }
    }
  }
  return out;
}

type Pick = { book: string; market: ApiMarket };

function orderedBooks(ev: ApiEvent, priority: readonly string[]) {
  const books = ev.bookmakers ?? [];
  return priority.length ? priority.flatMap((key) => books.filter((b) => b.key === key)) : books;
}

function pickBook(ev: ApiEvent, marketKey: string, priority: readonly string[]): Pick | null {
  for (const book of orderedBooks(ev, priority)) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (market && isUsableMarket(marketKey, market)) return { book: book.key, market: { ...market, last_update: market.last_update ?? book.last_update } };
  }
  return null;
}

/**
 * Props, player by player: each player comes from the first book in priority order that prices them cleanly.
 * Books post props gradually (early in the week one book may list only the starting QB), so taking one book
 * for the whole market hid everyone else. A player's lines never mix books (one ladder, one book).
 */
function pickPropBooks(ev: ApiEvent, marketKey: string, priority: readonly string[]): Pick[] {
  const taken = new Set<string>();
  const picks: Pick[] = [];
  for (const book of orderedBooks(ev, priority)) {
    const found = book.markets.find((m) => m.key === marketKey);
    if (!found) continue;
    const cleaned = cleanProp(marketKey, found);
    const outcomes = cleaned.outcomes.filter((o) => !taken.has(o.description ?? ""));
    const market = { ...cleaned, outcomes };
    if (outcomes.length === 0 || !isUsableMarket(marketKey, market)) continue;
    for (const o of outcomes) taken.add(o.description ?? "");
    picks.push({ book: book.key, market: { ...market, last_update: market.last_update ?? book.last_update } });
  }
  // Primary book (for odds_markets) = the one that priced the most players.
  return picks.sort((a, b) => b.market.outcomes.length - a.market.outcomes.length);
}

function isPropMarket(marketKey: string): boolean {
  return marketKey.startsWith("player_");
}

/** Alternate ladders ("…_alternate"): an Over-only list of lines per player, one row per line. */
export function isAlternateMarket(marketKey: string): boolean {
  return marketKey.endsWith("_alternate");
}

/** One-sided "Yes" props with no line (anytime TD scorer). */
export function isYesMarket(marketKey: string): boolean {
  return marketKey === "player_anytime_td";
}

/** Props, by shape:
 * - over/under: keep only players priced on BOTH sides at the SAME line (a lone side can't be graded fairly);
 * - alternates: keep each Over line once per player (the book never offers the Under);
 * - yes props: keep the "Yes" prices (there is no line).
 */
function cleanProp(marketKey: string, market: ApiMarket): ApiMarket {
  if (isYesMarket(marketKey)) {
    return { ...market, outcomes: market.outcomes.filter((o) => o.name === "Yes" && o.point === undefined) };
  }
  if (isAlternateMarket(marketKey)) {
    const seen = new Set<string>();
    const outcomes = market.outcomes.filter((o) => {
      const key = `${o.description ?? ""}|${o.point}`;
      if (o.name !== "Over" || !Number.isFinite(o.point) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...market, outcomes };
  }
  const byPlayer = new Map<string, ApiMarket["outcomes"]>();
  for (const o of market.outcomes) {
    const key = o.description ?? "";
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), o]);
  }
  const outcomes = [...byPlayer.values()].flatMap((os) => {
    const over = os.find((o) => o.name === "Over");
    const under = os.find((o) => o.name === "Under");
    return os.length === 2 && over && under && over.point !== undefined && over.point === under.point ? [over, under] : [];
  });
  return { ...market, outcomes };
}

export function isUsableMarket(marketKey: string, market: ApiMarket): boolean {
  const oneSided = isAlternateMarket(marketKey) || isYesMarket(marketKey);
  if (market.outcomes.length < (oneSided ? 1 : 2)) return false;
  const names = new Set<string>();
  for (const o of market.outcomes) {
    // Alternates repeat (Over, player) once per line, so the line is part of the identity.
    const id = `${o.name}|${o.description ?? ""}${isAlternateMarket(marketKey) ? `|${o.point}` : ""}`;
    if (!o.name || names.has(id)) return false;
    names.add(id);
    if (!Number.isInteger(o.price) || Math.abs(o.price) < 100) return false;
    const needsLine = LINE_MARKETS.has(marketKey) || (isPropMarket(marketKey) && !isYesMarket(marketKey));
    if (needsLine && !Number.isFinite(o.point)) return false;
  }
  return true;
}

/** Conservative watermark for markets merged across books. Missing timestamps use fetch time in SQL. */
export function oldestTimestamp(values: readonly (string | undefined)[]): string | null {
  const valid = values.filter((v): v is string => !!v && Number.isFinite(Date.parse(v)));
  return valid.length ? valid.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b) : null;
}
