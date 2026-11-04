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
    const found = book.markets.find((m) => m.key === marketKey);
    const market = found && isPropMarket(marketKey) ? cleanProp(marketKey, found) : found;
    if (market && isUsableMarket(marketKey, market)) return { book: book.key, market };
  }
  return null;
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
