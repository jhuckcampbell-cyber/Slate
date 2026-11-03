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

const LINE_MARKETS = new Set(["spreads", "totals"]);

export type NormalizeOptions = {
  /** Markets to keep (others in the response are ignored). Empty = keep none (catalog). */
  markets: readonly string[];
  /** Bookmaker priority. Empty = first book offering the market. */
  bookmakers: readonly string[];
};

export type Normalized = {
  events: IngestEvent[];
  outcomes: IngestOutcome[];
  markets: IngestMarket[];
  /** (event, market) pairs requested but not usable from any book. */
  skippedMarkets: number;
};

export function normalizeOddsResponse(apiEvents: readonly ApiEvent[], opts: NormalizeOptions): Normalized {
  const out: Normalized = { events: [], outcomes: [], markets: [], skippedMarkets: 0 };

  for (const ev of apiEvents) {
    if (!ev.id || !ev.home_team || !ev.away_team || Number.isNaN(Date.parse(ev.commence_time))) continue;

    out.events.push({
      id: ev.id,
      sport_key: ev.sport_key,
      sport_title: ev.sport_title ?? null,
      home_team: ev.home_team,
      away_team: ev.away_team,
      commence_time: ev.commence_time,
    });

    for (const marketKey of opts.markets) {
      const pick = pickBook(ev, marketKey, opts.bookmakers);
      if (!pick) {
        if (ev.bookmakers?.length) out.skippedMarkets++;
        continue;
      }
      out.markets.push({ event_id: ev.id, market_key: marketKey, bookmaker: pick.book });
      for (const o of pick.market.outcomes) {
        out.outcomes.push({
          event_id: ev.id,
          market_key: marketKey,
          outcome_name: o.name,
          participant_name: o.description ?? "",
          point: o.point ?? null,
          price_american: o.price,
          bookmaker: pick.book,
        });
      }
    }
  }
  return out;
}

function pickBook(
  ev: ApiEvent,
  marketKey: string,
  priority: readonly string[],
): { book: string; market: ApiMarket } | null {
  const books = ev.bookmakers ?? [];
  const ordered = priority.length
    ? priority.flatMap((key) => books.filter((b) => b.key === key))
    : books;
  for (const book of ordered) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (market && isUsableMarket(marketKey, market)) return { book: book.key, market };
  }
  return null;
}

export function isUsableMarket(marketKey: string, market: ApiMarket): boolean {
  if (market.outcomes.length < 2) return false;
  const names = new Set<string>();
  for (const o of market.outcomes) {
    if (!o.name || names.has(`${o.name}|${o.description ?? ""}`)) return false;
    names.add(`${o.name}|${o.description ?? ""}`);
    if (!Number.isInteger(o.price) || Math.abs(o.price) < 100) return false;
    if (LINE_MARKETS.has(marketKey) && !Number.isFinite(o.point)) return false;
  }
  return true;
}
