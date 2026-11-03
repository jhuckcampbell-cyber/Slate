/**
 * The Odds API v4 response shapes (subset we use). Shared by the real client and the fake
 * provider so local dev exercises exactly the production normalization path.
 * Docs: https://the-odds-api.com/liveapi/guides/v4/
 */
export type ApiOutcome = {
  name: string;
  price: number; // American when oddsFormat=american
  point?: number;
  description?: string; // player name for props
};

export type ApiMarket = { key: string; last_update?: string; outcomes: ApiOutcome[] };

export type ApiBookmaker = {
  key: string;
  title: string;
  last_update?: string;
  markets: ApiMarket[];
};

export type ApiEvent = {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: ApiBookmaker[];
};

/** Rows in the shape public.odds_sync_ingest expects. */
export type IngestEvent = {
  id: string;
  sport_key: string;
  sport_title: string | null;
  home_team: string;
  away_team: string;
  commence_time: string;
};

export type IngestOutcome = {
  event_id: string;
  market_key: string;
  outcome_name: string;
  participant_name: string;
  point: number | null;
  price_american: number;
  bookmaker: string;
};

export type IngestMarket = { event_id: string; market_key: string; bookmaker: string };
